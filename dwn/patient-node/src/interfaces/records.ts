import { LevelDBAdapter } from '../storage/leveldb';
import { generateDataKey, encrypt, decrypt, wrapKey, unwrapKey } from '../encryption/aes-service';
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

/**
 * Reads a 32-byte base64-encoded key-encryption-key from DWN_MASTER_KEK.
 * Placeholder until patient wallet/DID work lands and a real per-patient
 * public key exists to wrap against (see CLAUDE.md Known Constraints) —
 * mirrors the throw-if-missing pattern used by signing-utils.ts's secrets.
 */
function getPlaceholderKEK(): Buffer {
  const raw = process.env.DWN_MASTER_KEK;
  if (!raw) {
    throw new Error(
      'DWN_MASTER_KEK is not set. This is a placeholder key-encryption-key until ' +
        'patient wallet/DID work lands. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" ` +
        'and set it in .env'
    );
  }
  const kek = Buffer.from(raw, 'base64');
  if (kek.length !== 32) {
    throw new Error(`DWN_MASTER_KEK must decode to 32 bytes, got ${kek.length}`);
  }
  return kek;
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

    const kek = getPlaceholderKEK();
    const { encryptedKey, wrapTimeMs } = wrapKey(dataKey, kek);

    const recordId = generateId();
    const now = new Date().toISOString();
    // TODO (Days 16-17): replace with a real Indy VC ID once the doctor agent
    // can call back into the DWN with an on-chain integrity anchor.
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
    const kek = getPlaceholderKEK();
    const { dataKey, unwrapTimeMs } = unwrapKey(record.encryptedKey, kek);
    const { plaintext, decryptTimeMs } = decrypt(
      { encryptedData: record.encryptedData, iv: record.iv, tag: record.tag },
      dataKey
    );
    return { plaintext, unwrapTimeMs, decryptTimeMs };
  }
}
