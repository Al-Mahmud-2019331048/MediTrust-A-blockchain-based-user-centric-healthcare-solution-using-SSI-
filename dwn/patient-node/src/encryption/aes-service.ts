import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptResult {
  encryptedData: string;
  iv: string;
  tag: string;
  encryptTimeMs: number;
}

export interface DecryptResult {
  plaintext: Buffer;
  decryptTimeMs: number;
}

export interface WrapKeyResult {
  encryptedKey: string;
  wrapTimeMs: number;
}

export interface UnwrapKeyResult {
  dataKey: Buffer;
  unwrapTimeMs: number;
}

export function generateDataKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Encrypts plaintext with AES-256-GCM. Accepts both Buffer (binary files:
 * PDFs/images) and string (JSON records) — string input is UTF-8 encoded to
 * bytes before encryption; the cipher operates on bytes either way.
 */
export function encrypt(plaintext: Buffer | string, key: Buffer): EncryptResult {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');

  const start = performance.now();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptTimeMs = performance.now() - start;

  return {
    encryptedData: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    encryptTimeMs,
  };
}

/**
 * Decrypts an AES-256-GCM payload. Always returns raw bytes (Buffer) — the
 * caller knows from record metadata (contentType) whether to further
 * .toString('utf8') the result or treat it as binary.
 */
export function decrypt(
  encrypted: { encryptedData: string; iv: string; tag: string },
  key: Buffer
): DecryptResult {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const iv = Buffer.from(encrypted.iv, 'base64');
  const tag = Buffer.from(encrypted.tag, 'base64');
  const ciphertext = Buffer.from(encrypted.encryptedData, 'base64');
  if (iv.length !== IV_LENGTH) {
    throw new Error(`GCM IV must be ${IV_LENGTH} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`GCM auth tag must be ${TAG_LENGTH} bytes, got ${tag.length}`);
  }

  const start = performance.now();
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const decryptTimeMs = performance.now() - start;
    return { plaintext, decryptTimeMs };
  } catch {
    throw new Error('Decryption failed: authentication tag mismatch or corrupted ciphertext');
  }
}

/**
 * Wraps a per-record data key with a caller-supplied key-encryption-key (KEK).
 * KEK provenance is intentionally out of scope here — until patient DID/wallet
 * work lands, the caller supplies whatever 32-byte KEK is appropriate for the
 * current build stage. Packs iv(12) || tag(16) || ciphertext into one base64 blob.
 */
export function wrapKey(dataKey: Buffer, kek: Buffer): WrapKeyResult {
  if (dataKey.length !== KEY_LENGTH) {
    throw new Error(`Data key must be ${KEY_LENGTH} bytes, got ${dataKey.length}`);
  }
  if (kek.length !== KEY_LENGTH) {
    throw new Error(`KEK must be ${KEY_LENGTH} bytes, got ${kek.length}`);
  }

  const start = performance.now();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapTimeMs = performance.now() - start;

  const encryptedKey = Buffer.concat([iv, tag, wrapped]).toString('base64');
  return { encryptedKey, wrapTimeMs };
}

/** Unwraps a data key previously produced by wrapKey(). */
export function unwrapKey(encryptedKey: string, kek: Buffer): UnwrapKeyResult {
  if (kek.length !== KEY_LENGTH) {
    throw new Error(`KEK must be ${KEY_LENGTH} bytes, got ${kek.length}`);
  }
  const blob = Buffer.from(encryptedKey, 'base64');
  if (blob.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error(
      `encryptedKey blob too short: expected at least ${IV_LENGTH + TAG_LENGTH + 1} bytes, got ${blob.length}`
    );
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const wrapped = blob.subarray(IV_LENGTH + TAG_LENGTH);

  const start = performance.now();
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv);
    decipher.setAuthTag(tag);
    const dataKey = Buffer.concat([decipher.update(wrapped), decipher.final()]);
    const unwrapTimeMs = performance.now() - start;
    return { dataKey, unwrapTimeMs };
  } catch {
    throw new Error('Key unwrap failed: authentication tag mismatch or corrupted key blob');
  }
}
