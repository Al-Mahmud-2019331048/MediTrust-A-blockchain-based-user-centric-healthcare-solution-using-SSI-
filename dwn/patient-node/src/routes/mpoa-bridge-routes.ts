import { Router, Request, Response } from 'express';
import { getOrCreateMEK, restoreMEK, hasMEK } from '../encryption/mek-store';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { sha256String } from '../../../../crypto/encryption/src/hash-utils';

export const mpoaBridgeRouter = Router();

const SSS_SERVICE_URL = process.env.SSS_SERVICE_URL || 'http://localhost:4008';

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

    const alreadyHadMEK = await hasMEK(patientDID);
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
