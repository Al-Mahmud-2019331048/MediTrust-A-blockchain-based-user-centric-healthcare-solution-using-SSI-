import { Router, Request, Response } from 'express';
import { PermissionsInterface } from '../interfaces/permissions';
import { backupWrite } from '../backup/backup-service';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { sha256String } from '../../../../crypto/encryption/src/hash-utils';
import { getOrCreateSigningKey } from '../encryption/patient-signing-key';
import { isValidPatientDID } from '../utils/validation';

export const permissionRouter = Router();

// POST /shareRecord — mounted at /dwn/shareRecord by server.ts (Day 13)
// Body: { patientDID, grantedToDID, recordType, purpose, expiresAt?, allowedFields?,
//         actorRole?, roleProofRecordId?, verifierAgentBaseUrl? }
// actorRole and roleProofRecordId must be supplied together — see permissions.ts.
permissionRouter.post('/shareRecord', async (req: Request, res: Response) => {
  try {
    const {
      patientDID,
      grantedToDID,
      recordType,
      purpose,
      expiresAt,
      allowedFields,
      actorRole,
      roleProofRecordId,
      verifierAgentBaseUrl,
    } = req.body;

    if (!patientDID || !grantedToDID || !recordType || !purpose) {
      return res.status(400).json({
        error: 'patientDID, grantedToDID, recordType, and purpose are required',
      });
    }
    // See record-routes.ts's storeRecord for why this matters — patientDID
    // becomes a backup-destination scope key.
    if (!isValidPatientDID(patientDID)) {
      return res.status(400).json({ error: 'patientDID must be a valid UUID' });
    }

    if (actorRole && !roleProofRecordId) {
      return res.status(400).json({
        error: 'actorRole requires an accompanying roleProofRecordId',
      });
    }

    let permission;
    try {
      permission = await PermissionsInterface.grantPermission({
        patientDID,
        grantedToDID,
        recordType,
        purpose,
        expiresAt: expiresAt ?? null,
        allowedFields,
        actorRole,
        roleProofRecordId,
        verifierAgentBaseUrl,
      });
    } catch (err: unknown) {
      if ((err as Error).message.startsWith('Role proof verification failed')) {
        return res.status(403).json({ error: (err as Error).message });
      }
      if ((err as Error).message.startsWith('expiresAt is not a valid date')) {
        return res.status(400).json({ error: (err as Error).message });
      }
      throw err;
    }

    // Consent is the patient's own action — signed with the patient's own
    // key (Operation Fullbring gap-closure), not the shared audit secret.
    // grantPermission() already minted/used this same key for consentVCId.
    const { privateKeyPem, publicKeyPem } = await getOrCreateSigningKey(patientDID);
    const consentGrantedEvent = await AuditService.record({
      eventType: 'consent_granted',
      actorDid: patientDID,
      targetDid: grantedToDID,
      resourceId: permission.permissionId,
      resourceType: recordType,
      action: 'grantPermission',
      metadata: { purpose, expiresAt: permission.expiresAt, consentVCId: permission.consentVCId, actorRole },
      patientSigningKey: { privateKeyPem, publicKeyPem },
    });
    // On-chain anchoring: best-effort, fire-and-forget — NOT awaited before
    // responding. attemptAnchor()'s own 5s timeout, if awaited here, would
    // make this request as slow as the (currently blocked) ledger's own
    // timeout — confirmed live: awaiting this turned a ~5ms revokeAccess
    // call into a ~5s one during regression testing. The audit trail itself
    // (AuditService.record() above) already succeeded; anchoring status is
    // recorded whenever it resolves, without the caller ever waiting on it.
    attemptAnchor(sha256String(consentGrantedEvent.eventId + consentGrantedEvent.signature))
      .then((anchor) => AuditService.markAnchored(consentGrantedEvent.eventId, anchor))
      .catch(() => {});

    await backupWrite({
      entityType: 'permission',
      patientDID,
      entityKey: `permission:${permission.permissionId}`,
      entity: permission,
    });

    res.status(201).json(permission);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /revokeAccess — mounted at /dwn/revokeAccess by server.ts (Day 13)
// Body: { permissionId } OR { patientDID, grantedToDID, recordType }
permissionRouter.delete('/revokeAccess', async (req: Request, res: Response) => {
  try {
    const { permissionId, patientDID, grantedToDID, recordType } = req.body;

    if (!permissionId && !(patientDID && grantedToDID && recordType)) {
      return res.status(400).json({
        error: 'Either permissionId or {patientDID, grantedToDID, recordType} is required',
      });
    }

    let result;
    try {
      result = await PermissionsInterface.revokePermission({ permissionId, patientDID, grantedToDID, recordType });
    } catch (err: unknown) {
      return res.status(404).json({ error: (err as Error).message });
    }

    // Only audit-log permissions this call actually transitioned to revoked —
    // not idempotent no-ops (an already-revoked permission re-revoked, or the
    // losing side of a concurrent double-revoke), which would otherwise log
    // the same revocation twice for one logical action.
    for (const permission of result.freshlyRevoked) {
      const { privateKeyPem, publicKeyPem } = await getOrCreateSigningKey(permission.patientDID);
      const consentRevokedEvent = await AuditService.record({
        eventType: 'consent_revoked',
        actorDid: permission.patientDID,
        targetDid: permission.grantedToDID,
        resourceId: permission.permissionId,
        resourceType: permission.recordType,
        action: 'revokePermission',
        metadata: {},
        patientSigningKey: { privateKeyPem, publicKeyPem },
      });
      // Fire-and-forget — see the identical note on the consent_granted path above.
      attemptAnchor(sha256String(consentRevokedEvent.eventId + consentRevokedEvent.signature))
        .then((anchor) => AuditService.markAnchored(consentRevokedEvent.eventId, anchor))
        .catch(() => {});

      // Same idempotency guard as audit logging above — only genuinely
      // freshly-revoked permissions get a new backup entry, so an idempotent
      // re-revoke doesn't produce a duplicate entry for one logical action.
      await backupWrite({
        entityType: 'permission',
        patientDID: permission.patientDID,
        entityKey: `permission:${permission.permissionId}`,
        entity: permission,
      });
    }

    res.json(result.permissions.length === 1 ? result.permissions[0] : result.permissions);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
