// In-memory one-time-use guard for backup-provider's destructive delete-all
// tokens. Added 2026-08-12 after stress testing showed a real, live-provable
// gap: deleteAllProviderBackups() signs { patientDID, action: 'delete-all',
// timestamp } with the patient's own key, but the server never checked
// anything beyond the signature and patientDID/action match. A signature is
// proof the patient's key produced this token once — it is NOT proof the
// token is being presented for the first time. Since verifyWithPatientKey()
// tokens are valid for 10 years (see crypto/encryption/src/signing-utils.ts),
// a delete-all token captured once (a network log, a compromised old device,
// browser devtools) remained a standing "wipe this patient's entire backup
// history" capability forever — reproduced live: replayed a captured token
// after new, legitimate backup entries had since been pushed, and it deleted
// them too.
//
// Fix: deleteAllProviderBackups() now includes a fresh `nonce` in the signed
// payload (same pattern as dwn/patient-node/src/utils/nonce-guard.ts's
// storeRecord/shareRecord protection); consumeDeleteNonce() below rejects any
// nonce it has already seen. No separate fingerprint-binding needed here
// (unlike the DWN's nonce-guard) because the nonce lives INSIDE the signed
// JWT itself — an attacker can't swap it without breaking the signature.
//
// In-memory only, same tradeoff as every other in-memory guard in this
// codebase (rate-limit.ts, dwn's nonce-guard.ts) — correct for this PoC's
// single-process backup-provider.
const seenDeleteNonces = new Set<string>();

// Bounds memory growth in a long-running process, same pattern as
// dwn/patient-node/src/utils/nonce-guard.ts's MAX_TRACKED_NONCES. Set
// iteration order is insertion order, so this evicts the oldest first.
const MAX_TRACKED_NONCES = 10_000;

export function consumeDeleteNonce(nonce: string): boolean {
  if (seenDeleteNonces.has(nonce)) return false;

  seenDeleteNonces.add(nonce);
  if (seenDeleteNonces.size > MAX_TRACKED_NONCES) {
    const toDrop = seenDeleteNonces.size - MAX_TRACKED_NONCES / 2;
    let dropped = 0;
    for (const tracked of seenDeleteNonces) {
      if (dropped >= toDrop) break;
      seenDeleteNonces.delete(tracked);
      dropped += 1;
    }
  }
  return true;
}
