import { Router, Request, Response } from 'express';
import { getOrCreateMEK, restoreMEK, hasMEK } from '../encryption/mek-store';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { sha256String } from '../../../../crypto/encryption/src/hash-utils';
import { verifyMEKAgainstBackup } from '../backup/backup-service';
import { isValidPatientDID } from '../utils/validation';
import { isRateLimited } from '../utils/rate-limit';

export const mpoaBridgeRouter = Router();

const SSS_SERVICE_URL = process.env.SSS_SERVICE_URL || 'http://localhost:4008';

// See self-custody-routes.ts's identical guard for why this matters —
// patientDID is used directly as a backup-destination scope key.
mpoaBridgeRouter.param('patientDID', (req: Request, res: Response, next, value: string) => {
  if (!isValidPatientDID(value)) {
    return res.status(400).json({ error: 'patientDID must be a valid UUID' });
  }
  next();
});

// POST /dwn/patients/:patientDID/mpoa/initiate-split
// Bridges the DWN's real per-patient MEK to the EXISTING, unchanged
// crypto/sss institutional MPOA module (patient + hospital + guardian,
// 3-of-5 threshold) — for "the patient can't act for themselves" emergency
// scenarios, a genuinely different problem from ordinary self-custody
// recovery. Fetches this patient's real MEK and calls crypto/sss's
// POST /sss/recovery/initiate-with-split with it — this creates the
// RecoveryRequest and the 5 institutional shares together, tagged to each
// other, instead of the previous approach of calling POST /sss/split alone
// (which never created a RecoveryRequest at all, meaning this bridge's own
// splits had no requestId and reconstruct() could not verify submitted
// shares actually belonged to any specific approved request). The response
// now includes both requestId (hand this to the existing, unchanged
// /sss/recovery/approve flow) and the shares (tagged to that requestId).
mpoaBridgeRouter.post('/patients/:patientDID/mpoa/initiate-split', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    if (!patientDID) return res.status(400).json({ error: 'patientDID is required' });

    const { mek, isNewPatient } = await getOrCreateMEK(patientDID);

    const sssRes = await fetch(`${SSS_SERVICE_URL}/sss/recovery/initiate-with-split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mek: mek.toString('hex'), patientDid: patientDID }),
    });
    if (!sssRes.ok) {
      const errBody = await sssRes.json().catch(() => ({}));
      return res.status(502).json({ error: `SSS service split failed: ${errBody.error ?? sssRes.status}` });
    }
    const splitResult = await sssRes.json();

    res.status(200).json({ ...splitResult, isNewPatient });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /dwn/patients/:patientDID/mpoa/complete-restore
// Body: { mek: string } — the hex-encoded MEK already reconstructed via
// crypto/sss's existing POST /sss/recovery/:requestId/reconstruct (which
// itself already enforces the 3-of-5 approved-MPOA-request gate — not
// re-checked here, this route only persists the result). Writes the
// reconstructed key back into normal-operation storage so the patient's
// device (new or existing) resumes normal operation immediately.
mpoaBridgeRouter.post('/patients/:patientDID/mpoa/complete-restore', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    if (!patientDID) return res.status(400).json({ error: 'patientDID is required' });

    const { mek: mekHex } = req.body;
    if (!mekHex || typeof mekHex !== 'string') {
      return res.status(400).json({ error: 'mek (hex string, from a completed MPOA reconstruct) is required' });
    }
    const mek = Buffer.from(mekHex, 'hex');
    if (mek.length !== 32) {
      return res.status(400).json({ error: `mek must decode to 32 bytes, got ${mek.length}` });
    }

    // See self-custody-routes.ts's identical guard for why this matters.
    if (isRateLimited(`mpoa-complete-restore:${patientDID}`, 5, 60_000)) {
      return res.status(429).json({ error: 'Too many recovery attempts for this patient — try again in a minute.' });
    }

    const alreadyHadMEK = await hasMEK(patientDID);

    // Verify the submitted key is actually correct before persisting it.
    // This route has no way to confirm the caller genuinely went through
    // crypto/sss's gated reconstruct endpoint (see route comment above) —
    // without this check, anyone could POST an arbitrary 32-byte hex value
    // directly here and silently overwrite this patient's real key.
    // verifyMEKAgainstBackup() only rejects on a genuine decrypt failure
    // (wrong key) — it does NOT reject just because the backup destination
    // is unreachable or empty (see its own doc comment).
    try {
      const result = await verifyMEKAgainstBackup(patientDID, mek);
      if (result === 'unreachable') {
        return res.status(503).json({
          error: 'Cannot verify the submitted key right now — the backup destination is unreachable. Try again once it is reachable.',
        });
      }
    } catch {
      return res.status(400).json({
        error: 'The provided key failed verification against this patient\'s backed-up data — recovery aborted, nothing was changed.',
      });
    }

    await restoreMEK(patientDID, mek);

    const keyReconstructedEvent = await AuditService.record({
      eventType: 'key_reconstructed',
      actorDid: patientDID,
      targetDid: patientDID,
      resourceId: patientDID,
      resourceType: 'mek',
      action: 'completeMPOARestore',
      metadata: { selfCustody: false, overwroteExisting: alreadyHadMEK },
    });
    // Fire-and-forget on-chain anchoring — see permission-routes.ts for the
    // full rationale (awaiting attemptAnchor()'s 5s timeout here would make
    // this request as slow as the blocked ledger's own timeout).
    attemptAnchor(sha256String(keyReconstructedEvent.eventId + keyReconstructedEvent.signature))
      .then((anchor) => AuditService.markAnchored(keyReconstructedEvent.eventId, anchor))
      .catch(() => {});

    res.status(200).json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
