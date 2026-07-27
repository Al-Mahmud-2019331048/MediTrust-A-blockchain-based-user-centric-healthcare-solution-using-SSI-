import { Router, Request, Response } from 'express';
import { LevelDBAdapter } from '../storage/leveldb';
import { getExistingMEK } from '../encryption/mek-store';
import { gatherForRestore } from '../backup/backup-service';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { sha256String } from '../../../../crypto/encryption/src/hash-utils';
import { restoreSigningKey, getOrCreateSigningKey } from '../encryption/patient-signing-key';
import { isValidPatientDID } from '../utils/validation';

export const restoreRouter = Router();

// See self-custody-routes.ts's identical guard for why this matters —
// patientDID is used directly as a backup-destination scope key.
restoreRouter.param('patientDID', (req: Request, res: Response, next, value: string) => {
  if (!isValidPatientDID(value)) {
    return res.status(400).json({ error: 'patientDID must be a valid UUID' });
  }
  next();
});

// POST /dwn/patients/:patientDID/restore-data
// Run AFTER the patient's key has already been restored onto this device
// (via either /self-custody/restore or /mpoa/complete-restore — both
// persist the reconstructed MEK into this instance's mek-store first).
// Pulls every incremental backup entry for this patient (plus the shared,
// ungated protocol bucket), keeps only the highest-sequence entry per
// entityKey, decrypts, and writes everything into the LIVE local store
// under each entity's original key — entityKey ("record:{id}",
// "permission:{id}", "protocol:{name}") is deliberately the exact same
// prefix+id format the records/permissions/protocols interfaces already use,
// so no translation is needed.
restoreRouter.post('/patients/:patientDID/restore-data', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    if (!patientDID) return res.status(400).json({ error: 'patientDID is required' });

    let mek: Buffer;
    try {
      mek = await getExistingMEK(patientDID);
    } catch (err: unknown) {
      return res.status(400).json({
        error: `No MEK available locally for ${patientDID} — restore the key first via /self-custody/restore or /mpoa/complete-restore. (${(err as Error).message})`,
      });
    }

    const restored = await gatherForRestore(patientDID, mek);

    let recordsRestored = 0;
    let permissionsRestored = 0;
    let protocolsRestored = 0;
    let signingKeysRestored = 0;
    for (const item of restored) {
      if (item.entityType === 'signing_key') {
        // Different local storage shape than records/permissions/protocols
        // (device-key-wrapped, not stored directly under its own key) — goes
        // through restoreSigningKey() instead of a raw LevelDB put.
        const { publicKeyPem, privateKeyPem } = item.entity as { publicKeyPem: string; privateKeyPem: string };
        await restoreSigningKey(patientDID, privateKeyPem, publicKeyPem);
        signingKeysRestored++;
        continue;
      }
      await LevelDBAdapter.put(item.entityKey, JSON.stringify(item.entity));
      if (item.entityType === 'record') recordsRestored++;
      else if (item.entityType === 'permission') permissionsRestored++;
      else if (item.entityType === 'protocol') protocolsRestored++;
    }

    // The restore itself is the patient reasserting control over their own
    // vault — signed with the patient's own key (Operation Fullbring
    // gap-closure). getOrCreateSigningKey() here will normally find the key
    // restoreSigningKey() just re-established above; it only falls back to
    // minting a fresh one if this patient somehow never had a signing key at all.
    const { privateKeyPem, publicKeyPem } = await getOrCreateSigningKey(patientDID);
    const dwnRestoredEvent = await AuditService.record({
      eventType: 'dwn_restored',
      actorDid: patientDID,
      targetDid: patientDID,
      resourceId: patientDID,
      resourceType: 'dwn',
      action: 'restoreData',
      metadata: { recordsRestored, permissionsRestored, protocolsRestored, signingKeysRestored },
      patientSigningKey: { privateKeyPem, publicKeyPem },
    });
    // Fire-and-forget on-chain anchoring — see permission-routes.ts for the
    // full rationale (awaiting attemptAnchor()'s 5s timeout here would make
    // this request as slow as the blocked ledger's own timeout).
    attemptAnchor(sha256String(dwnRestoredEvent.eventId + dwnRestoredEvent.signature))
      .then((anchor) => AuditService.markAnchored(dwnRestoredEvent.eventId, anchor))
      .catch(() => {});

    res.status(200).json({ success: true, recordsRestored, permissionsRestored, protocolsRestored, signingKeysRestored });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
