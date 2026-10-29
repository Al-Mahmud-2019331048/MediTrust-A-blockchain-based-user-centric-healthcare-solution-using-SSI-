// In-memory replay guard for DWN writes: every storeRecord/shareRecord call
// must include a nonce the caller freshly generated, and a nonce can only
// ever be consumed once — a captured-and-replayed request is rejected
// instead of silently repeating the write.
//
// In-memory only, same tradeoff as rate-limit.ts in this same directory —
// correct for this PoC's single-process DWN; a shared store (Redis etc.)
// would be needed behind a load balancer, out of scope here.
//
// Tracks a fingerprint of the rest of the request alongside each nonce, not
// just the bare nonce string. A bare nonce check can't tell a benign
// resubmission of the exact same request apart from someone reusing a
// captured nonce with different, tampered content — both looked identical
// ("nonce already used"). This doesn't stop a fully capable forger who mints
// their own fresh nonce for a tampered body (that needs real request
// signing, out of scope for this PoC) — it only closes the narrower gap of a
// captured (nonce, body) pair being replayed with the body swapped.
const seenNonces = new Map<string, string>(); // nonce -> fingerprint of the request that first consumed it

// Bounds memory growth in a long-running process. Map iteration order is
// insertion order, so this evicts the oldest entries first once the tracked
// map gets large.
const MAX_TRACKED_NONCES = 100_000;

export interface ConsumeNonceResult {
  accepted: boolean;
  // Only meaningful when accepted is false: true if this nonce was
  // previously consumed by a request with a DIFFERENT fingerprint (a
  // captured nonce reused with tampered content) rather than an identical
  // resubmission of the same request.
  mismatchedReplay: boolean;
}

// Returns accepted: true the first time a given nonce is seen (and records
// its fingerprint); accepted: false on every subsequent call with the same
// nonce, with mismatchedReplay distinguishing why.
export function consumeNonce(nonce: string, requestFingerprint: string): ConsumeNonceResult {
  const existingFingerprint = seenNonces.get(nonce);
  if (existingFingerprint === undefined) {
    seenNonces.set(nonce, requestFingerprint);

    if (seenNonces.size > MAX_TRACKED_NONCES) {
      const toDrop = seenNonces.size - MAX_TRACKED_NONCES / 2;
      let dropped = 0;
      for (const key of seenNonces.keys()) {
        if (dropped >= toDrop) break;
        seenNonces.delete(key);
        dropped += 1;
      }
    }

    return { accepted: true, mismatchedReplay: false };
  }

  return { accepted: false, mismatchedReplay: existingFingerprint !== requestFingerprint };
}
