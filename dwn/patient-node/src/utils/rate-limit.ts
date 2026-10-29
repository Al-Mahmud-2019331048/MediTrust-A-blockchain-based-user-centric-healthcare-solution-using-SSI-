// Simple in-memory, per-key fixed-window rate limiter. Added 2026-07-25 to
// close a resource-exhaustion gap: the key-recovery routes' verification
// step (verifyMEKAgainstBackup, see backup-service.ts) calls out to
// backup-provider's unpaginated, unbounded entry-listing endpoint on every
// attempt — with no limit on attempts, a caller probing repeatedly with
// bogus recovery data could trigger unlimited full-history scans. This
// doesn't fix backup-provider's own listing endpoint (a separate, larger
// change), but it closes the actual abuse vector: an attacker's leverage
// requires many attempts against the SAME patientDID, which this bounds.
//
// In-memory only — correct for this PoC's single-process DWN, would need a
// shared store (Redis etc.) behind a load balancer, out of scope here.
const attempts = new Map<string, { count: number; windowStart: number }>();

// Bounds memory growth in a long-running process, same pattern (and same
// reasoning) as nonce-guard.ts's MAX_TRACKED_NONCES in this same directory.
// Without this, an attacker cycling through many distinct valid-UUID
// patientDIDs (isValidPatientDID only checks shape, not that the patient is
// real) against a rate-limited route grows this Map forever, one entry per
// DID ever tried — found during 2026-08-12 stress testing. Map iteration
// order is insertion order, so this evicts the oldest entries first.
const MAX_TRACKED_KEYS = 100_000;

export function isRateLimited(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    attempts.set(key, { count: 1, windowStart: now });

    if (attempts.size > MAX_TRACKED_KEYS) {
      const toDrop = attempts.size - MAX_TRACKED_KEYS / 2;
      let dropped = 0;
      for (const trackedKey of attempts.keys()) {
        if (dropped >= toDrop) break;
        attempts.delete(trackedKey);
        dropped += 1;
      }
    }

    return false;
  }

  entry.count += 1;
  return entry.count > maxAttempts;
}
