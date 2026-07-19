import { ProofStatusCache, ProofStatusCacheEntry } from "./types";

export function createProofStatusCache() {
  const cache: ProofStatusCache = {};

  const update = (
    proofId: string,
    state: string,
    isVerified: boolean = false,
    connectionId?: string
  ) => {
    cache[proofId] = { state, isVerified, timestamp: Date.now(), connectionId };
    console.log(`Proof cache updated for ${proofId}: ${state}, verified: ${isVerified}`);
  };

  const get = (proofId: string): ProofStatusCacheEntry | undefined => cache[proofId];

  const clear = (): number => {
    const count = Object.keys(cache).length;
    Object.keys(cache).forEach((key) => delete cache[key]);
    console.log(`Proof cache cleared (${count} entries)`);
    return count;
  };

  // Only "done" (RFC 0037's actual completion state) means a presentation was
  // received AND cryptographically validated. The legacy PoC's list also
  // included "request-received"/"presentation-sent"/"presentation-received" —
  // all pre-verification protocol states reachable before any proof is ever
  // checked — which let an unanswered or unvalidated proof request report as
  // verified. Confirmed live: a proof request nobody ever responded to sat at
  // "request-received" and was reported isVerified:true under the old list.
  const VERIFIED_STATES = ["done"];

  const isVerifiedState = (state: string): boolean =>
    VERIFIED_STATES.includes(state);

  return { update, get, clear, isVerifiedState };
}

export type ProofStatusCacheInstance = ReturnType<typeof createProofStatusCache>;
