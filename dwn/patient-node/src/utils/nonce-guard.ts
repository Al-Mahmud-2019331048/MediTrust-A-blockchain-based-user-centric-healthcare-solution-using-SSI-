// In-memory replay guard for DWN writes: every storeRecord/shareRecord call
// must include a nonce the caller freshly generated, and a nonce can only
// ever be consumed once — a captured-and-replayed request is rejected
// instead of silently repeating the write.
//
// In-memory only, same tradeoff as rate-limit.ts in this same directory —
// correct for this PoC's single-process DWN; a shared store (Redis etc.)
// would be needed behind a load balancer, out of scope here.
const seenNonces = new Set<string>();

// Bounds memory growth in a long-running process. Set iteration order is
// insertion order, so this evicts the oldest entries first once the tracked
// set gets large.
const MAX_TRACKED_NONCES = 100_000;

// Returns true the first time a given nonce is seen (and marks it consumed),
// false on every subsequent call with the same nonce.
export function consumeNonce(nonce: string): boolean {
  if (seenNonces.has(nonce)) return false;
  seenNonces.add(nonce);

  if (seenNonces.size > MAX_TRACKED_NONCES) {
    const toDrop = seenNonces.size - MAX_TRACKED_NONCES / 2;
    let dropped = 0;
    for (const value of seenNonces) {
      if (dropped >= toDrop) break;
      seenNonces.delete(value);
      dropped += 1;
    }
  }

  return true;
}
