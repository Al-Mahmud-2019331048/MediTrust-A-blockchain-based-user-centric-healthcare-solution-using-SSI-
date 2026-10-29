import { Router, Request, Response } from 'express';
import { AuditService, AuditEvent } from '../../../../audit/src/services/audit-service';
import { isValidPatientDID } from '../utils/validation';

export const notificationRouter = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function toMessage(event: AuditEvent): string {
  const metadata = event.metadata ?? {};
  switch (event.eventType) {
    case 'document_written':
      return `A new ${event.resourceType} record was added to your DWN.`;
    case 'document_read':
      return `${event.actorDid} read ${metadata.resultCount ?? 'one of'} your ${event.resourceType} record(s).`;
    case 'access_denied':
      return `${event.actorDid} tried to read your records without an active permission grant — denied.`;
    case 'consent_granted':
      return `You granted ${event.targetDid} access to your ${event.resourceType} records${metadata.purpose ? ` for "${metadata.purpose}"` : ''}.`;
    case 'consent_revoked':
      return `You revoked ${event.targetDid}'s access to your ${event.resourceType} records.`;
    case 'key_split':
      return 'Your recovery key was split into new self-custody shares.';
    case 'key_reconstructed':
      return 'Your recovery key was reconstructed on a device.';
    case 'dwn_restored':
      return `Your data was restored from backup (${metadata.recordsRestored ?? 0} records, ${metadata.permissionsRestored ?? 0} permissions).`;
    case 'backup_integrity_check_failed':
      return 'A backup entry failed integrity verification — possible tampering detected.';
    case 'document_integrity_check_failed':
      return `One of your ${event.resourceType} records failed its integrity check on read — possible tampering or corruption detected.`;
    default:
      return `${event.eventType.replace(/_/g, ' ')} event recorded.`;
  }
}

// GET /patients/:patientDID/notifications?requesterDID=...&limit=20
// Surfaces every audit event where this patient appears as either the actor
// (things the patient did themselves — granting/revoking access, splitting
// or reconstructing their key) or the target (things done TO their data — a
// document written or read, an access attempt denied). consent_granted/
// consent_revoked in particular only ever set targetDid to the *grantee*
// (see permission-routes.ts), so a target-only query would silently miss
// them — AuditService has no combined actor-or-target query, so both are
// fetched and merged here rather than adding a new method to a shared,
// already-relied-upon service for this one caller.
//
// Self-only: this feed exposes the patient's full consent/access graph
// (every grantee, every denied-access attempt), so requesterDID must match
// patientDID — the same self-only rule already applied to queryRecord's
// accessPolicy field. Found missing entirely in the 2026-08-09 re-audit.
notificationRouter.get('/patients/:patientDID/notifications', async (req: Request, res: Response) => {
  try {
    const { patientDID } = req.params;
    if (!isValidPatientDID(patientDID)) {
      return res.status(400).json({ error: 'patientDID must be a valid UUID' });
    }

    const requesterDID = req.query.requesterDID as string | undefined;
    if (!requesterDID) {
      return res.status(400).json({ error: 'requesterDID is required' });
    }
    if (requesterDID !== patientDID) {
      return res.status(403).json({ error: 'Only the patient may view their own notifications' });
    }

    const parsedLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : parsedLimit));

    const [asActor, asTarget] = await Promise.all([
      AuditService.getByActor(patientDID),
      AuditService.getByTarget(patientDID),
    ]);

    const byEventId = new Map<string, AuditEvent>();
    for (const event of [...asActor, ...asTarget]) {
      byEventId.set(event.eventId, event);
    }

    const merged = Array.from(byEventId.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    res.json({
      notifications: merged.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        message: toMessage(event),
        actorDid: event.actorDid,
        timestamp: event.timestamp,
      })),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
