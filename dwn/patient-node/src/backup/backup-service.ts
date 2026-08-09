import { LevelDBAdapter } from '../storage/leveldb';
import { encrypt, decrypt } from '../encryption/aes-service';
import { getOrCreateMEK } from '../encryption/mek-store';
import { BackupDestination, BackupEntry } from './backup-destination';
import { LocalBackupDestination } from './local-destination';
import { GoogleDriveBackupDestination } from './google-drive-destination';
import { DWNProviderBackupDestination } from './dwn-provider-destination';
import { isValidPatientDID } from '../utils/validation';

const SEQ_KEY_PREFIX = 'backup-seq:';

// Same per-key async lock pattern used in mek-store.ts/permissions.ts —
// serializes sequence-number allocation per scope so two concurrent writes
// for the same patient can't both grab the same sequence number.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  const tracker = result.then(() => undefined, () => undefined);
  locks.set(key, tracker);
  tracker.finally(() => { if (locks.get(key) === tracker) locks.delete(key); });
  return result;
}

async function nextSequence(scope: string): Promise<number> {
  return withLock(scope, async () => {
    const raw = await LevelDBAdapter.get(SEQ_KEY_PREFIX + scope);
    const current = raw ? parseInt(raw, 10) : 0;
    const next = current + 1;
    await LevelDBAdapter.put(SEQ_KEY_PREFIX + scope, String(next));
    return next;
  });
}

/** Lets a restore re-seed the sequence counter so post-restore writes don't
 * collide with pre-restore history. */
export async function setSequence(scope: string, value: number): Promise<void> {
  await LevelDBAdapter.put(SEQ_KEY_PREFIX + scope, String(value));
}

export type BackupEntityType = 'record' | 'permission' | 'protocol' | 'signing_key';

export interface BackupWriteInput {
  entityType: BackupEntityType;
  // patientDID is required for 'record'/'permission'/'signing_key' (patient-
  // secret, MEK-encrypted); omitted for 'protocol' (non-secret schema
  // metadata, shared across all patients, no MEK to key by — see design
  // notes below).
  patientDID?: string;
  entityKey: string;
  entity: unknown;
}

interface BackupEnvelope {
  version: 1;
  entityType: BackupEntityType;
  entityKey: string;
  sequence: number;
  writtenAt: string;
  encrypted: boolean;
  // Present when encrypted: true (records/permissions).
  encryptedData?: string;
  iv?: string;
  tag?: string;
  // Present when encrypted: false (protocols).
  payload?: string;
}

function getDestination(): BackupDestination {
  const kind = process.env.BACKUP_DESTINATION ?? 'local';
  if (kind === 'google-drive') return new GoogleDriveBackupDestination();
  if (kind === 'dwn-provider') return new DWNProviderBackupDestination();
  return new LocalBackupDestination();
}

// Protocols are structural schema metadata (name/actorRole/allowedFields),
// not patient secrets — no patientDID to key an MEK by, and backing them up
// in plaintext (still multi-copy redundant) keeps the "one recovery process
// protects patient data" property intact for the entities that actually
// need it, rather than quietly reintroducing a second, ungated recovery
// path. Stored under a shared, non-patient-specific bucket.
export const PROTOCOL_BACKUP_BUCKET = '_protocols';

/**
 * Fires on every write (storeRecord/shareRecord/revokeAccess/protocols-
 * define) — encrypts just the one new/changed item with the patient's own
 * MEK (records/permissions) or leaves it plain (protocols), and appends it
 * as one small, sequence-numbered, immutable entry to the configured backup
 * destination. Nothing else gets re-sent — this is what makes it
 * incremental rather than a full-snapshot backup.
 */
export async function backupWrite(input: BackupWriteInput): Promise<{ sequence: number }> {
  const destination = getDestination();
  const scope = input.entityType === 'protocol' ? PROTOCOL_BACKUP_BUCKET : input.patientDID!;
  if (input.entityType !== 'protocol' && !input.patientDID) {
    throw new Error('patientDID is required for record/permission backup entries');
  }
  // Defense in depth (callers should already validate at the route layer):
  // scope is used directly as a filesystem folder name / URL path segment /
  // query filter value by the configured backup destination. An invalid
  // patientDID here would either collide with the reserved PROTOCOL_BACKUP_BUCKET
  // name or escape the intended per-patient location.
  if (input.entityType !== 'protocol' && !isValidPatientDID(input.patientDID)) {
    throw new Error(`Invalid patientDID for backup: ${input.patientDID}`);
  }

  const sequence = await nextSequence(scope);
  const writtenAt = new Date().toISOString();

  let envelope: BackupEnvelope;
  if (input.entityType === 'protocol') {
    envelope = {
      version: 1,
      entityType: input.entityType,
      entityKey: input.entityKey,
      sequence,
      writtenAt,
      encrypted: false,
      payload: JSON.stringify(input.entity),
    };
  } else {
    const { mek } = await getOrCreateMEK(input.patientDID!);
    const { encryptedData, iv, tag } = encrypt(JSON.stringify(input.entity), mek);
    envelope = {
      version: 1,
      entityType: input.entityType,
      entityKey: input.entityKey,
      sequence,
      writtenAt,
      encrypted: true,
      encryptedData,
      iv,
      tag,
    };
  }

  const fileName = `${String(sequence).padStart(12, '0')}.json`;
  const entry: BackupEntry = { fileName, content: JSON.stringify(envelope) };

  try {
    await destination.putEntry(scope, entry);
  } catch (err) {
    // A backup destination being unreachable must never fail the actual
    // DWN write that triggered it — same non-fatal-surfacing pattern already
    // used by writeIssuedDocumentToDWN() for DWN write failures during
    // credential issuance. The caller can inspect the returned warning.
    console.warn(`backupWrite: failed to write backup entry for ${scope}/${fileName}: ${(err as Error).message}`);
  }

  return { sequence };
}

export interface RestoredEntity {
  entityType: BackupEntityType;
  entityKey: string;
  sequence: number;
  entity: unknown;
}

/**
 * Gathers every backup entry for a patient (plus the shared protocol
 * bucket), keeps only the highest-sequence envelope per entityKey (so a
 * later revoke naturally supersedes an earlier grant), decrypts the
 * patient-secret ones with the given MEK, and returns them ready to be
 * written into a fresh store. Does not touch any live store itself.
 */
export async function gatherForRestore(patientDID: string, mek: Buffer): Promise<RestoredEntity[]> {
  // Defense in depth — see backupWrite()'s identical check.
  if (!isValidPatientDID(patientDID)) {
    throw new Error(`Invalid patientDID for restore: ${patientDID}`);
  }
  const destination = getDestination();
  const [patientEntries, protocolEntries] = await Promise.all([
    destination.listEntries(patientDID),
    destination.listEntries(PROTOCOL_BACKUP_BUCKET),
  ]);

  const latestByKey = new Map<string, BackupEnvelope>();
  for (const raw of [...patientEntries, ...protocolEntries]) {
    let envelope: BackupEnvelope;
    try {
      envelope = JSON.parse(raw.content) as BackupEnvelope;
    } catch {
      console.warn(`gatherForRestore: skipping corrupted backup entry "${raw.fileName}"`);
      continue;
    }
    const existing = latestByKey.get(envelope.entityKey);
    if (!existing || envelope.sequence > existing.sequence) {
      latestByKey.set(envelope.entityKey, envelope);
    }
  }

  const restored: RestoredEntity[] = [];
  let maxPatientSequence = 0;
  for (const envelope of latestByKey.values()) {
    let entity: unknown;
    if (envelope.encrypted) {
      const { plaintext } = decrypt(
        { encryptedData: envelope.encryptedData!, iv: envelope.iv!, tag: envelope.tag! },
        mek
      );
      entity = JSON.parse(plaintext.toString('utf8'));
      if (envelope.sequence > maxPatientSequence) maxPatientSequence = envelope.sequence;
    } else {
      entity = JSON.parse(envelope.payload!);
    }
    restored.push({ entityType: envelope.entityType, entityKey: envelope.entityKey, sequence: envelope.sequence, entity });
  }

  // Re-seed the patient's own sequence counter so post-restore writes don't
  // collide with pre-restore history — the shared protocol bucket's counter
  // is untouched since it isn't patient-scoped.
  if (maxPatientSequence > 0) {
    await setSequence(patientDID, maxPatientSequence);
  }

  return restored;
}

export type MEKVerificationResult = 'verified' | 'no-data' | 'unreachable';

/**
 * Checks whether `mek` is genuinely this patient's real key by attempting to
 * decrypt one real backed-up entry with it. Used by the key-recovery routes
 * to reject bogus/mismatched recovery input before it can overwrite (and
 * permanently destroy access to) the patient's real MEK — Shamir
 * reconstruction mathematically produces SOME 32-byte output from any
 * shares of the right shape, so it can't detect wrong/mismatched shares on
 * its own.
 *
 * Three distinct outcomes, deliberately NOT collapsed into one boolean
 * (confirmed live — collapsing them was tried twice and broke something
 * different each time):
 *  - 'verified': an encrypted entry decrypted successfully — `mek` is
 *    definitely correct.
 *  - 'no-data': the backup destination was reachable, but this patient has
 *    zero encrypted entries — nothing real to verify against, and nothing
 *    real to lose either, so safe to proceed.
 *  - 'unreachable': the backup destination itself could not be reached.
 *    Unlike backupWrite()'s writes (where a destination being down is
 *    explicitly non-fatal to the primary operation), key recovery is
 *    security-critical and irreversible — silently treating "couldn't
 *    verify" the same as "verified" here would let an attacker bypass
 *    verification entirely just by making the backup destination
 *    unreachable (confirmed live: this is exactly what happened when this
 *    case was first folded into a generic "skip verification" path). The
 *    caller must fail closed on this outcome, not proceed.
 * A genuine decrypt failure (wrong key, real entries existed) throws —
 * callers must treat that as "this is not the real key" and reject.
 */
export async function verifyMEKAgainstBackup(patientDID: string, mek: Buffer): Promise<MEKVerificationResult> {
  // Defense in depth — see backupWrite()'s identical check.
  if (!isValidPatientDID(patientDID)) {
    throw new Error(`Invalid patientDID for verification: ${patientDID}`);
  }
  const destination = getDestination();

  // Every patient-scoped entry (record/permission/signing_key) is always
  // encrypted (only the shared, non-patient _protocols bucket ever has
  // encrypted: false) — so the loop below always accepts the very first
  // entry it's given. Asking the destination for just 1 turns what used to
  // be an unbounded full-history scan on every recovery attempt into a
  // single-entry lookup, closing the resource-exhaustion angle at its
  // source rather than only rate-limiting how often it can be triggered
  // (see isRateLimited() calls in self-custody-routes.ts/mpoa-bridge-
  // routes.ts, which bound attempt frequency but not the cost per attempt).
  let patientEntries: BackupEntry[];
  try {
    patientEntries = await destination.listEntries(patientDID, 1);
  } catch (err) {
    console.warn(`verifyMEKAgainstBackup: backup destination unreachable for ${patientDID}: ${(err as Error).message}`);
    return 'unreachable';
  }

  let encryptedEnvelope: BackupEnvelope | undefined;
  for (const raw of patientEntries) {
    let envelope: BackupEnvelope;
    try {
      envelope = JSON.parse(raw.content) as BackupEnvelope;
    } catch {
      continue;
    }
    // Only patient-scoped, MEK-encrypted entries (records/permissions/
    // signing_key) can verify a key — protocols are unencrypted and shared
    // across all patients, not something a MEK could ever decrypt.
    if (envelope.encrypted) {
      encryptedEnvelope = envelope;
      break;
    }
  }

  if (!encryptedEnvelope) {
    // No encrypted entries exist for this patient yet — nothing real to
    // verify against (and nothing real to lose either, if so).
    return 'no-data';
  }

  // Let this throw on a genuine auth-tag mismatch — the caller must treat
  // that as "this is not the real key" and reject the recovery attempt.
  decrypt(
    { encryptedData: encryptedEnvelope.encryptedData!, iv: encryptedEnvelope.iv!, tag: encryptedEnvelope.tag! },
    mek
  );
  return 'verified';
}
