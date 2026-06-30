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

  // States that count as "verified" in the legacy PoC — kept here for reference
  const VERIFIED_STATES = [
    "done",
    "presentation-received",
    "request-received",
    "presentation-sent",
  ];

  const isVerifiedState = (state: string): boolean =>
    VERIFIED_STATES.includes(state);

  return { update, get, clear, isVerifiedState };
}

export type ProofStatusCacheInstance = ReturnType<typeof createProofStatusCache>;
