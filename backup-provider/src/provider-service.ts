import { LevelDBAdapter } from './storage/leveldb';
import { verifyWithPatientKey } from '../../crypto/encryption/src/signing-utils';
import { consumeDeleteNonce } from './nonce-guard';

// The backup provider is deliberately "dumb": it stores and returns opaque
// signed tokens, never encryption keys, never plaintext, and never anything
// it originated itself. Every write it accepts must already be signed by the
// patient's own key (registered up front, out-of-band — the same
// trust-on-first-use-with-proof-of-possession model already proven by
// crypto/sss/src/mpoa-controller.ts's registerApproverKey()), so "this
// server can't write anything, it can only store data" is a property the
// protocol enforces, not just an access-control policy this code happens to
// follow.

const REGISTERED_KEY_PREFIX = 'registered-key:';
const ENTRY_PREFIX = 'entry:';

export class ProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

function scopeKey(patientDID: string): string {
  return REGISTERED_KEY_PREFIX + encodeURIComponent(patientDID);
}

function entryPrefix(patientDID: string): string {
  return ENTRY_PREFIX + encodeURIComponent(patientDID) + ':';
}

async function getRegisteredKey(patientDID: string): Promise<string | null> {
  return LevelDBAdapter.get(scopeKey(patientDID));
}

/**
 * Exposes the registered public key for a patient — deliberately
 * unauthenticated, same trust boundary as listEntries() below. This exists
 * specifically for restore-time bootstrap: a genuinely fresh device (the
 * whole point of restoring) has no locally-known public key yet to verify
 * anything against. That's a necessarily weaker trust step than ongoing
 * operation (where a device already has its own locally-known key and never
 * needs to ask the provider what to trust) — an accepted, named limitation
 * of this PoC, the same class as the first-registration TOFU race already
 * documented for registerKey() above: a fully malicious provider colluding
 * from a device's very first-ever contact could still hand back a
 * self-consistent fabricated identity, since there is no external root of
 * trust available here. Ongoing operation is fully protected regardless,
 * since it never calls this path once a local key exists.
 */
export async function getRegisteredPublicKey(patientDID: string): Promise<string | null> {
  return getRegisteredKey(patientDID);
}

/**
 * Registers a patient's public key before anything signed by it will be
 * trusted. `proof` must be a JWT signed by the corresponding private key
 * over exactly `{ patientDID, publicKeyPem }` — proof-of-possession, so an
 * attacker can't register a public key it doesn't hold the private half of.
 * Idempotent for a resubmission of the same key; rejects an attempt to
 * silently swap an already-registered identity's key out from under it.
 */
export async function registerKey(
  patientDID: string,
  publicKeyPem: string,
  proof: string
): Promise<{ status: 'registered' | 'already-registered' }> {
  let decoded: Record<string, unknown>;
  try {
    decoded = verifyWithPatientKey(proof, publicKeyPem);
  } catch (err) {
    throw new ProviderError(400, `Registration proof does not verify against the submitted public key: ${(err as Error).message}`);
  }
  if (decoded.patientDID !== patientDID || decoded.publicKeyPem !== publicKeyPem) {
    throw new ProviderError(400, 'Registration proof payload does not match patientDID/publicKeyPem in the request');
  }

  const existing = await getRegisteredKey(patientDID);
  if (existing === publicKeyPem) return { status: 'already-registered' };
  if (existing !== null) {
    throw new ProviderError(409, `A different key is already registered for patient ${patientDID}`);
  }

  await LevelDBAdapter.put(scopeKey(patientDID), publicKeyPem);
  return { status: 'registered' };
}

/**
 * Stores one signed backup entry verbatim (the raw token string) — this
 * server never inspects, re-derives, or modifies the signed payload beyond
 * reading the fileName it's keyed under, and that fileName is taken only
 * from the VERIFIED, decoded token, never from an unverified request field.
 */
export async function pushEntry(patientDID: string, token: string): Promise<void> {
  const registeredKey = await getRegisteredKey(patientDID);
  if (!registeredKey) {
    throw new ProviderError(400, `No key registered for patient ${patientDID} — register-key first`);
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = verifyWithPatientKey(token, registeredKey);
  } catch (err) {
    throw new ProviderError(401, `Entry token failed verification: ${(err as Error).message}`);
  }
  if (decoded.patientDID !== patientDID) {
    throw new ProviderError(400, 'Entry token patientDID does not match the request URL');
  }
  const fileName = decoded.fileName;
  if (typeof fileName !== 'string' || !fileName) {
    throw new ProviderError(400, 'Entry token is missing a valid fileName');
  }

  await LevelDBAdapter.put(entryPrefix(patientDID) + fileName, token);
}

/**
 * Returns stored tokens for a patient, raw and unverified — this server is
 * not the trust boundary for reads (deliberately unauthenticated, same PoC
 * trust boundary as GET /dwn/queryRecord); the caller (the patient's own
 * DWN) re-verifies every token against the public key it already knows
 * locally before trusting any of it. Naturally comes back in write order
 * since fileName is a zero-padded sequence number.
 *
 * `limit`, when given, is passed straight to the LevelDB iterator (which
 * stops reading as soon as it's satisfied) rather than truncating an
 * already-fetched full list — a genuine bound on the scan itself, not just
 * on the response size. Added so a caller that only needs to confirm "does
 * at least one entry exist" (e.g. key-recovery verification, see
 * dwn/patient-node/src/backup/backup-service.ts's verifyMEKAgainstBackup)
 * doesn't force a full-history scan on every attempt — previously the only
 * bound on that cost was a rate limiter on the DWN side capping how often
 * an attempt could be made at all, not the cost of any single attempt.
 */
export async function listEntries(patientDID: string, limit?: number): Promise<string[]> {
  const entries = await LevelDBAdapter.scan({ prefix: entryPrefix(patientDID), limit });
  return entries.map((e) => e.value);
}

/**
 * Deletes every stored entry for a patient plus their registered key —
 * genuine, provable deletion (not append-only), which is exactly the
 * property an immutable-ledger-style backend (e.g. BigchainDB, considered
 * and rejected earlier) could not offer.
 *
 * Requires a fresh `nonce` inside the signed token, consumed exactly once
 * (see nonce-guard.ts) — a signature alone only proves the patient's key
 * produced this token at some point, not that it's being presented for the
 * first time. Found live during 2026-08-12 stress testing: without this, a
 * delete-all token captured once (valid 10 years, per signing-utils.ts)
 * remained a standing "wipe this patient's backups" capability forever,
 * replayable even after new legitimate entries were pushed post-deletion.
 */
export async function deleteAll(patientDID: string, token: string): Promise<{ deleted: number }> {
  const registeredKey = await getRegisteredKey(patientDID);
  if (!registeredKey) {
    throw new ProviderError(400, `No key registered for patient ${patientDID}`);
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = verifyWithPatientKey(token, registeredKey);
  } catch (err) {
    throw new ProviderError(401, `Delete token failed verification: ${(err as Error).message}`);
  }
  if (decoded.patientDID !== patientDID || decoded.action !== 'delete-all') {
    throw new ProviderError(400, 'Delete token payload does not authorize deleting this patient');
  }
  if (typeof decoded.nonce !== 'string' || !decoded.nonce) {
    throw new ProviderError(400, 'Delete token is missing a nonce — refusing to authorize a replayable delete');
  }
  if (!consumeDeleteNonce(decoded.nonce)) {
    throw new ProviderError(401, 'This delete-all token has already been used — possible replay, delete refused');
  }

  const entries = await LevelDBAdapter.scan({ prefix: entryPrefix(patientDID) });
  for (const entry of entries) {
    await LevelDBAdapter.del(entry.key);
  }
  await LevelDBAdapter.del(scopeKey(patientDID));

  return { deleted: entries.length };
}
