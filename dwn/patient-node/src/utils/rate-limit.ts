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

export function isRateLimited(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > maxAttempts;
}
