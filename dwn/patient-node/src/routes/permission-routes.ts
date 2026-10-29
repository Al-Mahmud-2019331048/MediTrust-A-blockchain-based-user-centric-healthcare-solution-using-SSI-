import { Router, Request, Response } from 'express';
import { PermissionsInterface } from '../interfaces/permissions';
import { backupWrite } from '../backup/backup-service';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { sha256String } from '../../../../crypto/encryption/src/hash-utils';
import { getOrCreateSigningKey } from '../encryption/patient-signing-key';
import { isValidPatientDID, isValidRecordType } from '../utils/validation';
import { consumeNonce } from '../utils/nonce-guard';
import { isRateLimited } from '../utils/rate-limit';

export const permissionRouter = Router();

// POST /shareRecord — mounted at /dwn/shareRecord by server.ts (Day 13)
// Body: { patientDID, grantedToDID, recordType, purpose, expiresAt?, allowedFields?,
//         actorRole?, roleProofRecordId?, verifierAgentBaseUrl?, nonce }
// actorRole and roleProofRecordId must be supplied together — see permissions.ts.
// nonce must be a fresh, caller-generated value never sent before — guards
// against a captured grant request being replayed.
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
      nonce,
    } = req.body;

    if (!patientDID || !grantedToDID || !recordType || !purpose || !nonce) {
      return res.status(400).json({
        error: 'patientDID, grantedToDID, recordType, purpose, and nonce are required',
      });
    }
    // See record-routes.ts's storeRecord for why this matters — patientDID
    // becomes a backup-destination scope key.
    if (!isValidPatientDID(patientDID)) {
      return res.status(400).json({ error: 'patientDID must be a valid UUID' });
    }
    // Same class of bug as storeRecord's identical guard in record-routes.ts
    // (found via fuzz testing, 2026-08-12): a non-string recordType passed
    // the bare truthiness check above, got persisted into the permission,
    // and only then crashed this route's own audit-log write with an
    // unhandled 500 — after the malformed grant had already been created.
    if (!isValidRecordType(recordType)) {
      return res.status(400).json({ error: "recordType must be one of 'medical', 'prescription', 'lab_report'" });
    }
    if (typeof grantedToDID !== 'string' || !grantedToDID) {
      return res.status(400).json({ error: 'grantedToDID must be a non-empty string' });
    }
    if (typeof purpose !== 'string' || !purpose) {
      return res.status(400).json({ error: 'purpose must be a non-empty string' });
    }
    if (allowedFields !== undefined && (!Array.isArray(allowedFields) || !allowedFields.every((f) => typeof f === 'string'))) {
      return res.status(400).json({ error: 'allowedFields must be an array of strings' });
    }
    if (typeof nonce !== 'string') {
      return res.status(400).json({ error: 'nonce must be a string' });
    }
    // Same unauthenticated write-throttling gap as storeRecord (see its
    // identical guard in record-routes.ts) — found 2026-08-12 stress testing.
    if (isRateLimited(`shareRecord:${patientDID}`, 30, 60_000)) {
      return res.status(429).json({ error: 'Too many grants for this patient — try again in a minute.' });
    }
    const requestFingerprint = sha256String(
      JSON.stringify({ patientDID, grantedToDID, recordType, purpose, expiresAt, allowedFields, actorRole, roleProofRecordId, verifierAgentBaseUrl })
    );
    const { accepted, mismatchedReplay } = consumeNonce(nonce, requestFingerprint);
    if (!accepted) {
      return res.status(409).json({
        error: mismatchedReplay
          ? 'This nonce was already used for a different request — possible tampering, grant rejected'
          : 'This nonce has already been used — possible replay, grant rejected',
      });
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
      // Found via fuzz testing (2026-08-12): an actorRole grant with no
      // verifierAgentBaseUrl AND no VERIFIER_AGENT_BASE_URL env var configured
      // fell through to the generic 500 catch below. It already failed
      // closed (no permission is created either way — role-verification.ts
      // throws before grantPermission() ever persists anything), just with
      // a confusing status code instead of a clear "not configured" one.
      if ((err as Error).message.includes('VERIFIER_AGENT_BASE_URL is not set')) {
        return res.status(503).json({ error: (err as Error).message });
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
