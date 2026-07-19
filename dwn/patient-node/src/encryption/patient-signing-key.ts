import crypto from 'crypto';
import { LevelDBAdapter } from '../storage/leveldb';
import { encrypt, decrypt } from './aes-service';
import { backupWrite } from '../backup/backup-service';

const SIGNING_KEY_PREFIX = 'signing-key:';

interface StoredSigningKey {
  patientDID: string;
  publicKeyPem: string;
  wrappedPrivateKey: { encryptedData: string; iv: string; tag: string };
  createdAt: string;
}

// Same device-level secret that wraps each patient's MEK at rest
// (mek-store.ts's getDeviceKey) — duplicated here rather than imported since
// mek-store.ts doesn't export it, matching this codebase's existing
// convention of small private helpers being copied rather than shared.
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

async function readStoredKey(patientDID: string): Promise<StoredSigningKey | null> {
  const raw = await LevelDBAdapter.get(SIGNING_KEY_PREFIX + patientDID);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredSigningKey;
  } catch {
    throw new Error(`Signing key for patient ${patientDID} exists but its stored data is corrupted (invalid JSON)`);
  }
}

function unwrapPrivateKey(stored: StoredSigningKey): string {
  const { plaintext } = decrypt(stored.wrappedPrivateKey, getDeviceKey());
  return plaintext.toString('utf8');
}

async function persist(patientDID: string, publicKeyPem: string, privateKeyPem: string): Promise<void> {
  const wrapped = encrypt(privateKeyPem, getDeviceKey());
  const stored: StoredSigningKey = {
    patientDID,
    publicKeyPem,
    wrappedPrivateKey: { encryptedData: wrapped.encryptedData, iv: wrapped.iv, tag: wrapped.tag },
    createdAt: new Date().toISOString(),
  };
  await LevelDBAdapter.put(SIGNING_KEY_PREFIX + patientDID, JSON.stringify(stored));
}

/**
 * Returns this patient's own signing keypair (ECDSA P-256 — chosen over
 * Ed25519 solely because the installed jsonwebtoken@9 has no EdDSA support;
 * confirmed by inspecting its SUPPORTED_ALGS list), generating one the first
 * time this patientDID is seen. This is what closes the "consent receipts
 * and audit entries are signed by the server, not the patient" trust gap —
 * signatures now prove the patient's own key produced them, not merely that
 * the DWN process did. The private key is wrapped at rest by the same
 * device-level secret that wraps the MEK, and is also pushed through the
 * existing incremental backup pipeline (encrypted with the patient's own
 * MEK) so it survives device loss exactly like the MEK does — no separate
 * Shamir-split/self-custody share set was added for it.
 */
export async function getOrCreateSigningKey(
  patientDID: string
): Promise<{ privateKeyPem: string; publicKeyPem: string; isNewPatient: boolean }> {
  const existing = await readStoredKey(patientDID);
  if (existing) {
    return { privateKeyPem: unwrapPrivateKey(existing), publicKeyPem: existing.publicKeyPem, isNewPatient: false };
  }

  return withLock(patientDID, async () => {
    const existingInLock = await readStoredKey(patientDID);
    if (existingInLock) {
      return {
        privateKeyPem: unwrapPrivateKey(existingInLock),
        publicKeyPem: existingInLock.publicKeyPem,
        isNewPatient: false,
      };
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await persist(patientDID, publicKey as unknown as string, privateKey as unknown as string);

    // Back up the new key the same way records/permissions are — encrypted
    // with the patient's own MEK, restored automatically once the MEK is
    // restored via self-custody or MPOA. A backup-destination outage must
    // never block key creation, matching backupWrite()'s own non-fatal
    // failure handling elsewhere.
    await backupWrite({
      entityType: 'signing_key',
      patientDID,
      entityKey: `signing-key:${patientDID}`,
      entity: { publicKeyPem: publicKey, privateKeyPem: privateKey },
    });

    return { privateKeyPem: privateKey as unknown as string, publicKeyPem: publicKey as unknown as string, isNewPatient: true };
  });
}

/** Strict read-path lookup — throws rather than silently minting a new
 * keypair if one is expected to already exist. */
export async function getExistingSigningKey(
  patientDID: string
): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const existing = await readStoredKey(patientDID);
  if (!existing) {
    throw new Error(`No signing key found for patient ${patientDID}`);
  }
  return { privateKeyPem: unwrapPrivateKey(existing), publicKeyPem: existing.publicKeyPem };
}

/** Public key only — cheap, no device-key unwrap needed. Public keys aren't
 * secret, so this can be exposed freely for verification purposes. */
export async function getPublicKey(patientDID: string): Promise<string | null> {
  const existing = await readStoredKey(patientDID);
  return existing?.publicKeyPem ?? null;
}

/** Persists a signing keypair recovered via the backup/restore pipeline
 * back into normal local (device-key-wrapped) storage. */
export async function restoreSigningKey(patientDID: string, privateKeyPem: string, publicKeyPem: string): Promise<void> {
  await persist(patientDID, publicKeyPem, privateKeyPem);
}

export async function hasSigningKey(patientDID: string): Promise<boolean> {
  return (await readStoredKey(patientDID)) !== null;
}
