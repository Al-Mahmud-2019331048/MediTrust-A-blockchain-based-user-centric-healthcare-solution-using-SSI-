import { Router, Request, Response } from 'express';
import { splitMEK } from '../key-splitter';
import { reconstructKey } from '../key-reconstructor';
import { initiateRecovery, approveRecovery, getRecoveryStatus, registerApproverKey, attachIssuedShares } from '../mpoa-controller';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { sha256String } from '../../../encryption/src/hash-utils';
import { SSSShare } from '../../../../agents/shared/types';

export const sssRouter = Router();

// POST /sss/mpoa/register-key
// Body: { patientDid, approverRole, publicKeyPem }
// Out-of-band registration step, done once by the patient before any
// recovery request exists (e.g. when they first set up a guardian/hospital
// contact) — the same trust-on-first-use model already used for self-custody
// share setup. approveRecovery() verifies every submitted approval's
// signature against whatever key was registered here. This does NOT prove a
// key really belongs to the real hospital/guardian in the world — that
// binding needs a real institutional DID/credential, out of scope for this
// PoC and accepted as a named limitation, not something this route solves.
sssRouter.post('/mpoa/register-key', (req: Request, res: Response) => {
  try {
    const { patientDid, approverRole, publicKeyPem } = req.body;
    if (!patientDid || !approverRole || !publicKeyPem) {
      return res.status(400).json({ error: 'patientDid, approverRole, and publicKeyPem are required' });
    }
    registerApproverKey(patientDid, approverRole, publicKeyPem);
    res.status(200).json({ success: true });
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /sss/split
// Body: { mek: string }  — hex-encoded 32-byte key
sssRouter.post('/split', async (req: Request, res: Response) => {
  try {
    const { mek } = req.body;
    if (!mek || typeof mek !== 'string') {
      return res.status(400).json({ error: 'mek (hex string) is required' });
    }

    const mekBuffer = Buffer.from(mek, 'hex');
    const result = await splitMEK(mekBuffer);

    await AuditService.record({
      eventType: 'key_split',
      actorDid: req.body.patientDid ?? 'unknown',
      targetDid: req.body.patientDid ?? 'unknown',
      resourceId: result.shares[0].shareId,
      resourceType: 'mek',
      action: 'splitMEK',
      metadata: { splitTimeMs: result.splitTimeMs, total: result.total, threshold: result.threshold },
    });

    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/initiate
// Body: { patientDid: string, expiryHours?: number }
// expiryHours defaults to 24 (initiateRecovery's own default) — exposed here
// mainly so benchmark/attack-simulation testing can exercise real expiry
// behavior without waiting 24 hours, not for normal callers to change.
sssRouter.post('/recovery/initiate', (req: Request, res: Response) => {
  try {
    const { patientDid, expiryHours } = req.body;
    if (!patientDid) return res.status(400).json({ error: 'patientDid is required' });

    const request = typeof expiryHours === 'number' ? initiateRecovery(patientDid, expiryHours) : initiateRecovery(patientDid);
    res.json(request);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/initiate-with-split
// Body: { patientDid: string, mek: string (hex), expiryHours?: number }
// Combines initiateRecovery() + splitMEK() and tags the resulting request
// with the issued shareIds, closing the gap where a recovery request and the
// Shamir shares meant to satisfy it were previously created independently
// (via separate /recovery/initiate and /split calls) with nothing linking
// them — reconstruct() could not tell "these shares belong to this approved
// request" from "these are just 3+ valid-looking shares from anywhere".
// Does not replace /split or /recovery/initiate — both are unchanged and
// still usable standalone (e.g. by attack-simulation tests that only need a
// bare pending/expired request with no real shares behind it).
sssRouter.post('/recovery/initiate-with-split', async (req: Request, res: Response) => {
  try {
    const { patientDid, mek, expiryHours } = req.body;
    if (!patientDid) return res.status(400).json({ error: 'patientDid is required' });
    if (!mek || typeof mek !== 'string') return res.status(400).json({ error: 'mek (hex string) is required' });

    const request = typeof expiryHours === 'number' ? initiateRecovery(patientDid, expiryHours) : initiateRecovery(patientDid);

    const mekBuffer = Buffer.from(mek, 'hex');
    const splitResult = await splitMEK(mekBuffer);
    const taggedRequest = attachIssuedShares(request.requestId, splitResult.shares);

    await AuditService.record({
      eventType: 'key_split',
      actorDid: patientDid,
      targetDid: patientDid,
      resourceId: request.requestId,
      resourceType: 'mek',
      action: 'splitMEK',
      metadata: { splitTimeMs: splitResult.splitTimeMs, total: splitResult.total, threshold: splitResult.threshold },
    });

    res.json({ ...taggedRequest, shares: splitResult.shares });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/approve
// Body: { requestId, approverDid, approverRole, signature }
sssRouter.post('/recovery/approve', (req: Request, res: Response) => {
  try {
    const { requestId, approverDid, approverRole, signature } = req.body;
    if (!requestId || !approverDid || !approverRole || !signature) {
      return res.status(400).json({ error: 'requestId, approverDid, approverRole, and signature are required' });
    }

    const request = approveRecovery(requestId, approverDid, approverRole, signature);
    res.json(request);
  } catch (err: unknown) {
    const message = (err as Error).message;
    // Genuine authorization/verification failures get 403; everything else
    // (bad requestId, expired/already-decided request, invalid role) is a
    // 400 — matches this route's existing convention.
    if (message.startsWith('Signature verification failed') || message.startsWith('No public key registered')) {
      return res.status(403).json({ error: message });
    }
    res.status(400).json({ error: message });
  }
});

// GET /sss/recovery/:requestId/status
sssRouter.get('/recovery/:requestId/status', (req: Request, res: Response) => {
  try {
    const request = getRecoveryStatus(req.params.requestId);
    res.json(request);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/:requestId/reconstruct
// Body: { shares: SSSShare[] }
sssRouter.post('/recovery/:requestId/reconstruct', async (req: Request, res: Response) => {
  try {
    const status = getRecoveryStatus(req.params.requestId);
    if (status.status !== 'approved') {
      return res.status(403).json({ error: `Cannot reconstruct — request status is '${status.status}', must be 'approved'` });
    }

    const shares: SSSShare[] = req.body.shares;
    if (!Array.isArray(shares) || shares.length < 3) {
      return res.status(400).json({ error: 'At least 3 shares required' });
    }

    // Share-to-request provenance check — REQUIRED, not conditional. Without
    // a known share manifest to check against, any 3+ valid-looking Shamir
    // shares (even from a completely unrelated split, or leftovers from a
    // different patient's recovery) would reconstruct successfully once this
    // requestId reached 'approved' — combine() has no way to detect
    // mismatched shares on its own. Requests created via the real recovery
    // path (/recovery/initiate-with-split, via the DWN's /mpoa/initiate-split
    // bridge) always have issuedShareIds attached. Requests created via the
    // bare /recovery/initiate have no manifest and are rejected here — that
    // endpoint stays usable for status/expiry testing (attack-simulation
    // tests only exercise the earlier status check, at line ~158, and never
    // reach this far), but was never meant to support a real reconstruction.
    if (!status.issuedShareIds || status.issuedShareIds.length === 0) {
      return res.status(403).json({
        error: `No share manifest recorded for recovery request ${req.params.requestId} — shares cannot be verified, reconstruction refused.`,
      });
    }
    const issued = new Set(status.issuedShareIds);
    const unrecognized = shares.filter((s) => !issued.has(s.shareId));
    if (unrecognized.length > 0) {
      return res.status(403).json({
        error: `Submitted share(s) do not belong to recovery request ${req.params.requestId}`,
      });
    }

    // Data-integrity check, not just ID membership — shareIds are plaintext
    // in this same router's /recovery/initiate-with-split response, so
    // anyone who's seen that response could submit a real shareId paired
    // with fabricated shareData. combine() would silently interpolate a
    // plausible-but-wrong key from that — it has no way to detect a
    // corrupted/substituted share on its own (it only rejects duplicate
    // x-coordinates). Comparing each submitted share's actual bytes against
    // the fingerprint recorded at split time closes that gap.
    const fingerprints = status.issuedShareFingerprints ?? {};
    const tampered = shares.filter((s) => fingerprints[s.shareId] !== sha256String(s.shareData));
    if (tampered.length > 0) {
      return res.status(403).json({
        error: `Submitted share(s) do not match the data issued for recovery request ${req.params.requestId}`,
      });
    }

    // reconstructKey() itself now validates the output is 32 bytes (see
    // key-reconstructor.ts) — a length mismatch throws and is handled by
    // this handler's outer catch block below.
    const { mek, reconstructTimeMs } = await reconstructKey(shares);

    const keyReconstructedEvent = await AuditService.record({
      eventType: 'key_reconstructed',
      actorDid: status.patientDid,
      targetDid: status.patientDid,
      resourceId: req.params.requestId,
      resourceType: 'mek',
      action: 'reconstructKey',
      metadata: { reconstructTimeMs },
    });
    // Fire-and-forget on-chain anchoring — NOT awaited before responding, so
    // attemptAnchor()'s 5s timeout never adds latency to this request (a
    // live regression run against the sibling permission-routes.ts callers
    // caught the awaited version turning a ~5ms call into a ~5s one).
    attemptAnchor(sha256String(keyReconstructedEvent.eventId + keyReconstructedEvent.signature))
      .then((anchor) => AuditService.markAnchored(keyReconstructedEvent.eventId, anchor))
      .catch(() => {});

    res.json({ mek: mek.toString('hex'), reconstructTimeMs });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
