import { LevelDBAdapter } from '../storage/leveldb';
import { generateDataKey, wrapKey, unwrapKey } from './aes-service';

const MEK_KEY_PREFIX = 'mek:';

interface StoredMEK {
  patientDID: string;
  wrappedMEK: string;
  createdAt: string;
}

/**
 * Reads the 32-byte device-level key used to wrap each patient's own MEK at
 * rest. Same env var and format as the old getPlaceholderKEK() in records.ts
 * — its role changes here from "wraps every record's data key directly" to
 * "wraps one MEK per patient" (Operation Fullbring). Still a single,
 * un-split secret — a known, separately-flagged limitation (see CLAUDE.md).
 */
function getDeviceKey(): Buffer {
  const raw = process.env.DWN_MASTER_KEK;
  if (!raw) {
    throw new Error(
      'DWN_MASTER_KEK is not set. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" ` +
        'and set it in .env'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`DWN_MASTER_KEK must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

// Per-patientDID async lock — same pattern as permissions.ts's private
// withLock, duplicated here rather than imported since it isn't exported.
// Prevents two concurrent first-writes for a brand-new patientDID from each
// generating and persisting a different MEK.
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  const tracker = result.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, tracker);
  tracker.finally(() => {
    if (locks.get(key) === tracker) locks.delete(key);
  });
  return result;
}

async function readStoredMEK(patientDID: string): Promise<StoredMEK | null> {
  const raw = await LevelDBAdapter.get(MEK_KEY_PREFIX + patientDID);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredMEK;
  } catch {
    throw new Error(`MEK for patient ${patientDID} exists but its stored data is corrupted (invalid JSON)`);
  }
}

/**
 * Returns this patient's real MEK, generating and persisting a fresh one the
 * first time this patientDID is ever seen (this generation-on-first-use *is*
 * onboarding — no separate onboarding step exists or is needed). Guarded by
 * a per-patientDID lock so two concurrent first-writes can't mint two
 * different MEKs for the same patient.
 */
export async function getOrCreateMEK(patientDID: string): Promise<{ mek: Buffer; isNewPatient: boolean }> {
  const existing = await readStoredMEK(patientDID);
  if (existing) {
    const { dataKey } = unwrapKey(existing.wrappedMEK, getDeviceKey());
    return { mek: dataKey, isNewPatient: false };
  }

  return withLock(patientDID, async () => {
    // Re-check inside the lock — another concurrent call may have already
    // created it while this call was waiting for the lock.
    const existingInLock = await readStoredMEK(patientDID);
    if (existingInLock) {
      const { dataKey } = unwrapKey(existingInLock.wrappedMEK, getDeviceKey());
      return { mek: dataKey, isNewPatient: false };
    }

    const mek = generateDataKey();
    const { encryptedKey: wrappedMEK } = wrapKey(mek, getDeviceKey());
    const stored: StoredMEK = { patientDID, wrappedMEK, createdAt: new Date().toISOString() };
    await LevelDBAdapter.put(MEK_KEY_PREFIX + patientDID, JSON.stringify(stored));
    return { mek, isNewPatient: true };
  });
}

/**
 * Strict read-path lookup for decrypting an existing record — throws a
 * clear, actionable error rather than silently minting a wrong new key if
 * this patient has no MEK on record (a record existing implies its MEK must
 * already exist; if it doesn't, that's real data loss, not a fresh patient).
 */
export async function getExistingMEK(patientDID: string): Promise<Buffer> {
  const existing = await readStoredMEK(patientDID);
  if (!existing) {
    throw new Error(
      `No MEK found for patient ${patientDID} — this patient's key may need to be restored ` +
        `(see Operation Fullbring's recovery paths) rather than a fresh one generated.`
    );
  }
  const { dataKey } = unwrapKey(existing.wrappedMEK, getDeviceKey());
  return dataKey;
}

/**
 * Persists a MEK that was reconstructed via SSS self-custody or MPOA
 * recovery back into normal-operation storage, so the patient's device
 * re-enters normal operation immediately without needing to re-run recovery
 * on every subsequent read/write.
 */
export async function restoreMEK(patientDID: string, mek: Buffer): Promise<void> {
  const { encryptedKey: wrappedMEK } = wrapKey(mek, getDeviceKey());
  const stored: StoredMEK = { patientDID, wrappedMEK, createdAt: new Date().toISOString() };
  await LevelDBAdapter.put(MEK_KEY_PREFIX + patientDID, JSON.stringify(stored));
}

/** True if this patientDID already has a MEK on record — used by recovery
 * routes to decide whether a "restore" would be overwriting an existing key
 * (worth a warning) versus populating a genuinely missing one. */
export async function hasMEK(patientDID: string): Promise<boolean> {
  return (await readStoredMEK(patientDID)) !== null;
}
