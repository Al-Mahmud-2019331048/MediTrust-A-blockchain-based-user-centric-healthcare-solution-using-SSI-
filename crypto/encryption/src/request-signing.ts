import crypto from 'crypto';

// Provider request signing for the patient DWN (added 2026-11-07).
//
// Doctor and pharmacy agents sign every DWN request with the Ed25519 key
// behind their ledger DID (the same 32-character seed they already import
// into their Credo wallet). The DWN checks the signature against a short list
// of trusted providers and then uses the signed DID as the requester/author,
// ignoring any requesterDID/authorDID the request itself claims.
//
// What is signed (one line each, joined with "\n"):
//   METHOD            e.g. GET / POST
//   path + query      exactly as sent, e.g. /dwn/queryRecord?requesterDID=...
//   timestamp         milliseconds since epoch, as a decimal string
//   sha256(body)      hex digest of the raw request body ("" for GET)

export const SIGNATURE_HEADERS = {
  did: 'x-did',
  timestamp: 'x-timestamp',
  signature: 'x-signature',
} as const;

// PKCS#8 DER prefix for a raw 32-byte Ed25519 private seed — lets Node's
// built-in crypto load the same seed Credo imports, with no extra library.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
// SPKI DER prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(buf: Buffer): string {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function base58Decode(str: string): Buffer {
  let n = 0n;
  for (const ch of str) {
    const value = BASE58_ALPHABET.indexOf(ch);
    if (value < 0) throw new Error('Invalid base58 character');
    n = n * 58n + BigInt(value);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const leadingZeros = str.length - str.replace(/^1+/, '').length;
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(hex, 'hex')]);
}

function privateKeyFromSeed(seed: string): crypto.KeyObject {
  const seedBytes = Buffer.from(seed, 'utf8');
  if (seedBytes.length !== 32) throw new Error('Signing seed must be exactly 32 bytes');
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seedBytes]),
    format: 'der',
    type: 'pkcs8',
  });
}

// Indy "verkey": the base58-encoded raw 32-byte Ed25519 public key.
export function verkeyFromSeed(seed: string): string {
  const spki = crypto.createPublicKey(privateKeyFromSeed(seed)).export({ format: 'der', type: 'spki' });
  return base58Encode(spki.subarray(ED25519_SPKI_PREFIX.length));
}

// An Indy DID's unqualified identifier is the base58 encoding of the first
// 16 bytes of its verkey — so a (DID, verkey) pair can be checked for
// consistency locally, without asking the ledger.
export function verkeyMatchesIndyDid(verkey: string, did: string): boolean {
  try {
    const raw = base58Decode(verkey);
    if (raw.length !== 32) return false;
    const unqualified = did.split(':').pop() ?? '';
    return base58Encode(raw.subarray(0, 16)) === unqualified;
  } catch {
    return false;
  }
}

export function canonicalRequestString(method: string, pathWithQuery: string, timestamp: string, body: Buffer | string): string {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  return [method.toUpperCase(), pathWithQuery, timestamp, bodyHash].join('\n');
}

export function signRequest(
  seed: string,
  did: string,
  method: string,
  pathWithQuery: string,
  body: Buffer | string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const message = canonicalRequestString(method, pathWithQuery, timestamp, body);
  const signature = crypto.sign(null, Buffer.from(message, 'utf8'), privateKeyFromSeed(seed)).toString('base64');
  return {
    [SIGNATURE_HEADERS.did]: did,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.signature]: signature,
  };
}

export function verifyRequestSignature(
  verkey: string,
  method: string,
  pathWithQuery: string,
  timestamp: string,
  body: Buffer | string,
  signatureBase64: string
): boolean {
  try {
    const raw = base58Decode(verkey);
    if (raw.length !== 32) return false;
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    const message = canonicalRequestString(method, pathWithQuery, timestamp, body);
    return crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
