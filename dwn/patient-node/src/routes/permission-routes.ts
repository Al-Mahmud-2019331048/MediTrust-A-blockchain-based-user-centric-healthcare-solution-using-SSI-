import { Router, Request, Response } from 'express';
import { PermissionsInterface } from '../interfaces/permissions';
import { AuditService } from '../../../../audit/src/services/audit-service';

export const permissionRouter = Router();

// POST /shareRecord — mounted at /dwn/shareRecord by server.ts (Day 13)
// Body: { patientDID, grantedToDID, recordType, purpose, expiresAt?, allowedFields? }
permissionRouter.post('/shareRecord', async (req: Request, res: Response) => {
  try {
    const { patientDID, grantedToDID, recordType, purpose, expiresAt, allowedFields } = req.body;

    if (!patientDID || !grantedToDID || !recordType || !purpose) {
      return res.status(400).json({
        error: 'patientDID, grantedToDID, recordType, and purpose are required',
      });
    }

    const permission = await PermissionsInterface.grantPermission({
      patientDID,
      grantedToDID,
      recordType,
      purpose,
      expiresAt: expiresAt ?? null,
      allowedFields,
    });

    await AuditService.record({
      eventType: 'consent_granted',
      actorDid: patientDID,
      targetDid: grantedToDID,
      resourceId: permission.permissionId,
      resourceType: recordType,
      action: 'grantPermission',
      metadata: { purpose, expiresAt: permission.expiresAt, consentVCId: permission.consentVCId },
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
      await AuditService.record({
        eventType: 'consent_revoked',
        actorDid: permission.patientDID,
        targetDid: permission.grantedToDID,
        resourceId: permission.permissionId,
        resourceType: permission.recordType,
        action: 'revokePermission',
        metadata: {},
      });
    }

    res.json(result.permissions.length === 1 ? result.permissions[0] : result.permissions);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
