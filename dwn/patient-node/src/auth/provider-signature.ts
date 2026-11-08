import { Request, Response, NextFunction } from 'express';
import {
  SIGNATURE_HEADERS,
  verifyRequestSignature,
  verkeyMatchesIndyDid,
} from '../../../../crypto/encryption/src/request-signing';

// Checks provider (doctor/pharmacy agent) request signatures — added
// 2026-11-07. Before this, the DWN believed whatever requesterDID/authorDID a
// request claimed, so anyone could write records into a patient's vault and
// any caller could read under another provider's grant.
//
// A request carrying signature headers must be signed by a DID on the trusted
// list, within MAX_CLOCK_SKEW_MS of now, over this exact method + path +
// body — otherwise it's rejected with 401. On success the verified DID is put
// on res.locals.providerDID; routes use that, never the request's own claim.
// A request with no signature headers passes through with no providerDID
// (routes decide what an unsigned caller may do).

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

// DWN_TRUSTED_PROVIDERS: comma-separated "did=verkey" pairs (public keys only).
// Each pair is checked locally (an Indy DID is derived from its verkey), so a
// typo or a key pasted under the wrong DID is dropped at boot instead of
// silently trusting the wrong party.
function loadTrustedProviders(): Map<string, string> {
  const trusted = new Map<string, string>();
  const raw = process.env.DWN_TRUSTED_PROVIDERS ?? '';
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const separator = entry.lastIndexOf('=');
    const did = entry.slice(0, separator).trim();
    const verkey = entry.slice(separator + 1).trim();
    if (separator <= 0 || !did || !verkey) {
      console.warn(`DWN_TRUSTED_PROVIDERS: skipping malformed entry "${entry}"`);
      continue;
    }
    if (!verkeyMatchesIndyDid(verkey, did)) {
      console.warn(`DWN_TRUSTED_PROVIDERS: verkey does not match DID ${did} — skipped`);
      continue;
    }
    trusted.set(did, verkey);
  }
  console.log(`Trusted providers loaded: ${trusted.size}`);
  return trusted;
}

// Loaded on first use, not at import time, so it always sees .env values
// regardless of module evaluation order.
let trustedProviderCache: Map<string, string> | null = null;
function trusted(): Map<string, string> {
  if (!trustedProviderCache) trustedProviderCache = loadTrustedProviders();
  return trustedProviderCache;
}

export function isTrustedProvider(did: string): boolean {
  return trusted().has(did);
}

export function providerSignatureMiddleware(req: Request, res: Response, next: NextFunction) {
  const did = req.header(SIGNATURE_HEADERS.did);
  const timestamp = req.header(SIGNATURE_HEADERS.timestamp);
  const signature = req.header(SIGNATURE_HEADERS.signature);

  if (!did && !timestamp && !signature) return next();

  if (!did || !timestamp || !signature) {
    return res.status(401).json({ error: 'Incomplete request signature headers' });
  }
  const verkey = trusted().get(did);
  if (!verkey) {
    return res.status(401).json({ error: 'Request signed by an unknown provider' });
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).json({ error: 'Request signature timestamp is missing or outside the allowed window' });
  }
  const valid = verifyRequestSignature(verkey, req.method, req.originalUrl, timestamp, req.rawBody ?? '', signature);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid request signature' });
  }

  res.locals.providerDID = did;
  next();
}
