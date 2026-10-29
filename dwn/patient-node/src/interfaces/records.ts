import { LevelDBAdapter } from '../storage/leveldb';
import { generateDataKey, encrypt, decrypt, wrapKey, unwrapKey } from '../encryption/aes-service';
import { getOrCreateMEK, getExistingMEK } from '../encryption/mek-store';
import { sha256, generateId } from '../../../../crypto/encryption/src/hash-utils';
import { DWNRecord } from '../../../../agents/shared/types';

const RECORD_KEY_PREFIX = 'record:';

export interface CreateRecordInput {
  patientDID: string;
  recordType: DWNRecord['recordType'];
  protocol: string;
  contentType: DWNRecord['contentType'];
  fileName: string | null;
  data: Buffer | string;
}

export interface CreateRecordResult {
  record: DWNRecord;
  encryptTimeMs: number;
  wrapTimeMs: number;
}

export interface RecordQueryFilter {
  patientDID?: string;
  recordType?: string;
}

export interface DecryptRecordResult {
  plaintext: Buffer;
  unwrapTimeMs: number;
  decryptTimeMs: number;
}

export class RecordsInterface {
  static async createRecord(input: CreateRecordInput): Promise<CreateRecordResult> {
    if (!input.patientDID) throw new Error('patientDID is required');
    if (!input.recordType) throw new Error('recordType is required');
    if (!input.protocol) throw new Error('protocol is required');
    if (!input.contentType) throw new Error('contentType is required');
    if (input.data === undefined || input.data === null) throw new Error('data is required');

    const plaintext = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data, 'utf8');
    const fileSize = plaintext.length;
    const hash = sha256(plaintext);

    const dataKey = generateDataKey();
    const { encryptedData, iv, tag, encryptTimeMs } = encrypt(plaintext, dataKey);

    // Operation Fullbring: each patient gets their own real MEK (not one
    // shared system-wide secret) — generated the first time this patientDID
    // is ever seen, which is also this patient's onboarding moment.
    const { mek } = await getOrCreateMEK(input.patientDID);
    const { encryptedKey, wrapTimeMs } = wrapKey(dataKey, mek);

    const recordId = generateId();
    const now = new Date().toISOString();
    // Placeholder until markRecordAnchored() (below) replaces it with a real
    // ledger transaction reference — record-routes.ts fires a best-effort,
    // fire-and-forget attemptAnchor(hash) call right after this record is
    // created and stays a placeholder if that anchor attempt is blocked or
    // never attempted (e.g. GOVERNMENT_AGENT_BASE_URL unset), same fail-soft
    // behavior as every other on-chain anchoring call site in this codebase.
    const integrityVCId = `local-placeholder-${generateId()}`;

    const record: DWNRecord = {
      recordId,
      patientDID: input.patientDID,
      recordType: input.recordType,
      protocol: input.protocol,
      contentType: input.contentType,
      fileName: input.fileName,
      fileSize,
      encryptedData,
      encryptedKey,
      iv,
      tag,
      hash,
      integrityVCId,
      createdAt: now,
      updatedAt: now,
    };

    await LevelDBAdapter.put(RECORD_KEY_PREFIX + recordId, JSON.stringify(record));

    return { record, encryptTimeMs, wrapTimeMs };
  }

  // Called by record-routes.ts once its fire-and-forget attemptAnchor(hash)
  // resolves (well after the storeRecord response has already been sent —
  // same "never block the caller on a ledger write" reasoning as every
  // other anchoring call site, see anchor-client.ts). A 'blocked' or
  // 'not_attempted' result deliberately leaves the existing
  // local-placeholder-* integrityVCId in place rather than erroring —
  // anchoring is a best-effort bonus on top of the AES-256/SHA-256
  // protection that already exists, never a dependency for the write to be
  // considered successful.
  //
  // Returns the updated record (or null if there was nothing to update) so
  // the caller can re-push it to backup — found live 2026-08-31 during a
  // device-loss recovery drill that a record's real on-chain anchor was
  // silently lost on restore: backupWrite() only ever fires once, at
  // storeRecord time, with the pre-anchor placeholder still in place. This
  // method used to return void and only patch the live LevelDB copy, so
  // that placeholder stayed permanently frozen in backup even after the
  // anchor resolved — recovering the record afterward would always bring
  // the placeholder back, never the real anchor, with no error or warning.
  static async markRecordAnchored(
    recordId: string,
    anchor: { anchorStatus: 'anchored' | 'blocked' | 'not_attempted'; ledgerTxnSeqNo?: number }
  ): Promise<DWNRecord | null> {
    if (anchor.anchorStatus !== 'anchored' || anchor.ledgerTxnSeqNo === undefined) return null;
    // The record may have been deleted or overwritten (e.g. a restore) in
    // the time between the write and this resolving — nothing to update in
    // that case, and silently skipping is correct for a best-effort bonus.
    const record = await this.readRecord(recordId);
    if (!record) return null;
    record.integrityVCId = `indy-anchor-txn-${anchor.ledgerTxnSeqNo}`;
    record.updatedAt = new Date().toISOString();
    await LevelDBAdapter.put(RECORD_KEY_PREFIX + recordId, JSON.stringify(record));
    return record;
  }

  static async readRecord(recordId: string): Promise<DWNRecord | null> {
    const raw = await LevelDBAdapter.get(RECORD_KEY_PREFIX + recordId);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as DWNRecord;
    } catch {
      throw new Error(`Record ${recordId} exists but its stored data is corrupted (invalid JSON)`);
    }
  }

  // Skips (rather than throws on) any individual corrupted entry, so one bad
  // record anywhere in the node cannot break list/query reads for every other
  // patient — a single malformed write is isolated to itself, not node-wide.
  static async queryRecords(filter: RecordQueryFilter = {}): Promise<DWNRecord[]> {
    const entries = await LevelDBAdapter.scan({ prefix: RECORD_KEY_PREFIX });
    const records: DWNRecord[] = [];
    for (const entry of entries) {
      let record: DWNRecord;
      try {
        record = JSON.parse(entry.value) as DWNRecord;
      } catch {
        console.warn(`RecordsInterface.queryRecords: skipping corrupted entry at key "${entry.key}" (invalid JSON)`);
        continue;
      }
      if (filter.patientDID && record.patientDID !== filter.patientDID) continue;
      if (filter.recordType && record.recordType !== filter.recordType) continue;
      records.push(record);
    }
    return records;
  }

  static async decryptRecord(record: DWNRecord): Promise<DecryptRecordResult> {
    const mek = await getExistingMEK(record.patientDID);
    const { dataKey, unwrapTimeMs } = unwrapKey(record.encryptedKey, mek);
    const { plaintext, decryptTimeMs } = decrypt(
      { encryptedData: record.encryptedData, iv: record.iv, tag: record.tag },
      dataKey
    );
    return { plaintext, unwrapTimeMs, decryptTimeMs };
  }
}
