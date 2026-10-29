import { Router, Request, Response } from 'express';
import { getOrCreateMEK, restoreMEK, hasMEK } from '../encryption/mek-store';
import { splitMEKSelfCustody, reconstructMEKSelfCustody, SelfCustodyShare } from '../../../../crypto/sss/src/self-custody';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { getOrCreateSigningKey, hasSigningKey, getPublicKey } from '../encryption/patient-signing-key';
import { sha256String } from '../../../../crypto/encryption/src/hash-utils';
import { verifyMEKAgainstBackup } from '../backup/backup-service';
import { isValidPatientDID } from '../utils/validation';
import { isRateLimited } from '../utils/rate-limit';

export const selfCustodyRouter = Router();

// Applies to every route below with a :patientDID param — patientDID is
// used directly as a backup-destination scope key (folder name / URL
// segment / query value). An unvalidated value like "_protocols" (the
// reserved shared-bucket name) or ".."/"." would poison shared backup state
// or write outside the intended per-patient location.
selfCustodyRouter.param('patientDID', (req: Request, res: Response, next, value: string) => {
  if (!isValidPatientDID(value)) {
    return res.status(400).json({ error: 'patientDID must be a valid UUID' });
  }
  next();
});

// POST /dwn/patients/:patientDID/self-custody/initiate
// Fetches (or creates, on first use) this patient's real MEK and splits it
// 5 ways (threshold 3) across things only the patient owns. The 5 shares are
// returned in the response and NOT persisted anywhere on the server — the
// caller (the patient's own app) is responsible for saving each one wherever
// the patient chooses (phone storage, a printed paper backup, a second
// device, an encrypted cloud backup, a safe-deposit box). This is what makes
// it self-custody rather than institutional.
selfCustodyRouter.post('/patients/:patientDID/self-custody/initiate', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    if (!patientDID) return res.status(400).json({ error: 'patientDID is required' });

    const { mek, isNewPatient } = await getOrCreateMEK(patientDID);
    const { shares, splitTimeMs, threshold, total } = await splitMEKSelfCustody(mek, patientDID);

    // Self-custody is the patient's own action — signed with the patient's
    // own key (Operation Fullbring gap-closure), not the shared audit secret.
    const { privateKeyPem, publicKeyPem } = await getOrCreateSigningKey(patientDID);
    const keySplitEvent = await AuditService.record({
      eventType: 'key_split',
      actorDid: patientDID,
      targetDid: patientDID,
      resourceId: shares[0].shareId,
      resourceType: 'mek',
      action: 'splitMEKSelfCustody',
      metadata: { splitTimeMs, total, threshold, selfCustody: true, isNewPatient },
      patientSigningKey: { privateKeyPem, publicKeyPem },
    });
    // Fire-and-forget on-chain anchoring — NOT awaited before responding, so
    // attemptAnchor()'s 5s timeout never adds latency to this request. See
    // dwn/patient-node/src/routes/permission-routes.ts for the full
    // rationale (a live regression run caught the awaited version turning a
    // ~5ms call into a ~5s one).
    attemptAnchor(sha256String(keySplitEvent.eventId + keySplitEvent.signature))
      .then((anchor) => AuditService.markAnchored(keySplitEvent.eventId, anchor))
      .catch(() => {});

    res.status(200).json({ shares, splitTimeMs, threshold, total, isNewPatient });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /dwn/patients/:patientDID/self-custody/restore
// Body: { shares: SelfCustodyShare[] } — at least 3 of the patient's 5
// self-held shares. Reconstructs the original MEK and persists it back into
// normal-operation storage so the patient's (new or existing) device
// resumes normal operation immediately, without needing to repeat recovery
// on every subsequent read/write.
selfCustodyRouter.post('/patients/:patientDID/self-custody/restore', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    if (!patientDID) return res.status(400).json({ error: 'patientDID is required' });

    const shares: SelfCustodyShare[] = req.body.shares;
    if (!Array.isArray(shares) || shares.length < 3) {
      return res.status(400).json({ error: 'At least 3 self-custody shares are required' });
    }
    // Found via fuzz testing (2026-08-12): malformed share shapes (wrong
    // element type, non-string shareId/shareData) reached reconstructMEKSelfCustody()
    // unchecked and threw raw internal errors from the shamir-secret-sharing
    // library/Buffer APIs ("each share must be at least 2 bytes", "the first
    // argument must be of type string...") as an unhandled 500, instead of a
    // clean 400 for what is straightforwardly bad client input.
    if (!shares.every((s) => s && typeof s === 'object' && typeof s.shareId === 'string' && typeof s.shareData === 'string')) {
      return res.status(400).json({ error: 'Each share must be an object with string shareId and shareData fields' });
    }

    // Catches the single most likely real-world mistake with a clear
    // message before spending any crypto work on it: pasting shares that
    // belong to a DIFFERENT account. Older shares (minted before this field
    // existed) have no patientDID to check — silently skipped rather than
    // rejected, so previously-issued shares don't stop working.
    const mismatched = shares.find((s) => s.patientDID && s.patientDID !== patientDID);
    if (mismatched) {
      return res.status(400).json({
        error: `This share belongs to a different account (${mismatched.patientDID}), not ${patientDID}. Open that account instead, or use shares generated for this one.`,
      });
    }

    // Each attempt triggers a real verifyMEKAgainstBackup() call, which
    // hits backup-provider's own (unbounded, unpaginated) entry-listing
    // endpoint — without this, an attacker who knows/guesses a patientDID
    // could probe repeatedly with bogus shares to trigger unlimited
    // full-history scans. Bounds the actual abuse vector (many attempts
    // against the same patientDID) without needing to change
    // backup-provider's own listing behavior.
    if (isRateLimited(`self-custody-restore:${patientDID}`, 5, 60_000)) {
      return res.status(429).json({ error: 'Too many recovery attempts for this patient — try again in a minute.' });
    }

    const alreadyHadMEK = await hasMEK(patientDID);
    let mek: Buffer;
    let reconstructTimeMs: number;
    try {
      ({ mek, reconstructTimeMs } = await reconstructMEKSelfCustody(shares));
    } catch (err) {
      // Any remaining library-level rejection (e.g. too many shares, a
      // corrupted-but-string shareData blob) is still bad client input, not
      // a server fault — see the shape-validation comment above.
      return res.status(400).json({ error: `Invalid shares: ${(err as Error).message}` });
    }

    // Verify the reconstructed key is actually correct before persisting it.
    // combine() mathematically produces SOME 32-byte output from any shares
    // of the right shape — it cannot detect bogus/mismatched shares on its
    // own, so without this check any 2 syntactically-valid share blobs would
    // silently overwrite (and destroy access to) this patient's real key.
    // verifyMEKAgainstBackup() only rejects on a genuine decrypt failure
    // (wrong key) — it does NOT reject just because the backup destination
    // is unreachable or empty (see its own doc comment for why that
    // distinction matters; conflating the two was tried and confirmed live
    // to break legitimate recovery whenever backup-provider was down).
    try {
      const result = await verifyMEKAgainstBackup(patientDID, mek);
      if (result === 'unreachable') {
        return res.status(503).json({
          error: 'Cannot verify the reconstructed key right now — the backup destination is unreachable. Try again once it is reachable.',
        });
      }
    } catch {
      return res.status(400).json({
        error:
          'The provided shares reconstructed a key that failed verification against this patient\'s backed-up data — recovery aborted, nothing was changed.',
      });
    }

    await restoreMEK(patientDID, mek);

    // Same patient-key signing as initiate above — but ONLY if a signing key
    // already exists locally. On a brand-new device (the whole point of
    // restore), no local signing key exists yet — that's restored moments
    // later via POST /restore-data. Minting one here to sign THIS event would
    // silently create a second, divergent keypair that then gets treated as
    // the device's real local key: every subsequent restore-data call would
    // verify incoming backup entries against this wrong key instead of
    // bootstrapping the real one, and the real signing_key entity would keep
    // failing verification and never actually get restored — a real,
    // confirmed-live bug (not a hypothetical), specifically exposed by
    // DWNProviderBackupDestination depending on signing-key consistency
    // across devices in a way the older Local/GoogleDrive destinations never
    // needed to. System-signed here instead — same treatment already used
    // for MPOA's institutional-recovery events, since the patient's own
    // device genuinely doesn't have its key back yet at this exact moment.
    const hasKeyAlready = await hasSigningKey(patientDID);
    let keyReconstructedEvent;
    if (hasKeyAlready) {
      const { privateKeyPem, publicKeyPem } = await getOrCreateSigningKey(patientDID);
      keyReconstructedEvent = await AuditService.record({
        eventType: 'key_reconstructed',
        actorDid: patientDID,
        targetDid: patientDID,
        resourceId: patientDID,
        resourceType: 'mek',
        action: 'reconstructMEKSelfCustody',
        metadata: { reconstructTimeMs, selfCustody: true, overwroteExisting: alreadyHadMEK },
        patientSigningKey: { privateKeyPem, publicKeyPem },
      });
    } else {
      keyReconstructedEvent = await AuditService.record({
        eventType: 'key_reconstructed',
        actorDid: patientDID,
        targetDid: patientDID,
        resourceId: patientDID,
        resourceType: 'mek',
        action: 'reconstructMEKSelfCustody',
        metadata: { reconstructTimeMs, selfCustody: true, overwroteExisting: alreadyHadMEK, signingKeyNotYetRestored: true },
      });
    }
    // Fire-and-forget — see the identical note on the key_split path above.
    attemptAnchor(sha256String(keyReconstructedEvent.eventId + keyReconstructedEvent.signature))
      .then((anchor) => AuditService.markAnchored(keyReconstructedEvent.eventId, anchor))
      .catch(() => {});

    res.status(200).json({ success: true, reconstructTimeMs });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /dwn/patients/:patientDID/mek-status — lightweight check, no secrets
// returned, just whether a MEK currently exists locally for this patient
// (useful for a "recover on this device" UI to decide what to show).
selfCustodyRouter.get('/patients/:patientDID/mek-status', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    res.status(200).json({ hasMEK: await hasMEK(patientDID) });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /dwn/patients/:patientDID/signing-key-status — lets the frontend show
// that a patient-owned signing key exists and give some real, visible proof
// of it, without ever exposing the private half. The "fingerprint" is just a
// SHA-256 hash of the public key (itself not secret) truncated for display —
// public keys aren't sensitive, so this is safe to return unauthenticated,
// same trust boundary as the rest of this PoC's read paths.
selfCustodyRouter.get('/patients/:patientDID/signing-key-status', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    const publicKeyPem = await getPublicKey(patientDID);
    res.status(200).json({
      hasKey: publicKeyPem !== null,
      publicKeyFingerprint: publicKeyPem ? sha256String(publicKeyPem).slice(0, 32) : null,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
