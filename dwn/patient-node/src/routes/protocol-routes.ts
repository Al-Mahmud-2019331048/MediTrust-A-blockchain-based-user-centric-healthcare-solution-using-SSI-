import { Router, Request, Response } from 'express';
import { ProtocolsInterface } from '../interfaces/protocols';
import { backupWrite } from '../backup/backup-service';
import { AuditService } from '../../../../audit/src/services/audit-service';

export const protocolRouter = Router();

// Protocol.allowedFields is the system-wide, role-based field-redaction cap
// intersected against every patient's individual grants (see
// record-routes.ts's queryRecord) — e.g. the real "Prescription"/
// "pharmacist" entry currently limits every pharmacist, for every patient,
// to seeing only the "drug" field. /define had no auth check at all before
// this: found via 2026-08-12 stress testing that ANY caller could silently
// widen or overwrite that system-wide policy with a single unauthenticated
// POST — no patient consent, no role proof, nothing. There is no admin/
// operator auth system in this PoC, so this uses the same shared-secret
// pattern already established for signing secrets (DOCUMENT_SIGNING_SECRET
// etc. in .env) rather than inventing a new one. Unset env var fails closed
// (503), matching this codebase's existing convention for security-critical
// config (see common-routes.ts's credDef checks) — never silently
// unauthenticated.
function requireAdminSecret(req: Request, res: Response): boolean {
  const configured = process.env.PROTOCOL_ADMIN_SECRET;
  if (!configured) {
    res.status(503).json({ error: 'Protocol administration is not configured (PROTOCOL_ADMIN_SECRET is unset) — refusing to allow an unauthenticated policy change.' });
    return false;
  }
  const provided = req.header('x-admin-secret');
  if (provided !== configured) {
    res.status(401).json({ error: 'Missing or incorrect x-admin-secret header' });
    return false;
  }
  return true;
}

// POST /dwn/protocols/define — mounted at /dwn/protocols/* by server.ts (Day 13)
// Body: { name, actorRole, allowedFields }
// Header: x-admin-secret (must match PROTOCOL_ADMIN_SECRET) — see
// requireAdminSecret() above.
protocolRouter.post('/define', async (req: Request, res: Response) => {
  try {
    if (!requireAdminSecret(req, res)) return;

    const { name, actorRole, allowedFields } = req.body;

    if (!name || !actorRole || !allowedFields) {
      return res.status(400).json({
        error: 'name, actorRole, and allowedFields are required',
      });
    }
    // Found alongside the auth gap above: a non-string name/actorRole passed
    // this bare truthiness check, got persisted, and then crashed the
    // audit-log write with an unhandled 500 (Prisma's schema requires a
    // String column) — same bug pattern as storeRecord/shareRecord, see
    // their identical fixes in record-routes.ts/permission-routes.ts.
    if (typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    if (typeof actorRole !== 'string') {
      return res.status(400).json({ error: 'actorRole must be a string' });
    }
    if (!Array.isArray(allowedFields) || !allowedFields.every((f) => typeof f === 'string')) {
      return res.status(400).json({ error: 'allowedFields must be an array of strings' });
    }

    // A corrupted existing entry at this name must not block re-registering
    // it — this lookup only decides the audit event type / status code, not
    // whether the write may proceed (defineProtocol() itself self-heals).
    let existing;
    try {
      existing = await ProtocolsInterface.getProtocol(name);
    } catch {
      existing = null;
    }
    const protocol = await ProtocolsInterface.defineProtocol({ name, actorRole, allowedFields });

    await AuditService.record({
      eventType: existing ? 'protocol_updated' : 'protocol_registered',
      actorDid: actorRole,
      targetDid: name,
      resourceId: name,
      resourceType: 'protocol',
      action: 'defineProtocol',
      metadata: { actorRole, allowedFields },
    });

    // Protocols are non-secret schema metadata, backed up in plaintext,
    // deliberately outside the MEK/MPOA-gated path (see backup-service.ts).
    await backupWrite({
      entityType: 'protocol',
      entityKey: `protocol:${name}`,
      entity: protocol,
    });

    res.status(existing ? 200 : 201).json(protocol);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /dwn/protocols/query — mounted at /dwn/protocols/* by server.ts (Day 13)
// Query params: name?, actorRole?
protocolRouter.get('/query', async (req: Request, res: Response) => {
  try {
    const name = req.query.name as string | undefined;
    const actorRole = req.query.actorRole as string | undefined;

    const protocols = await ProtocolsInterface.listProtocols({ name, actorRole });
    res.json(protocols);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /dwn/protocols/generate-vp — mounted at /dwn/protocols/* by server.ts (Day 13)
// Body: { anoncredsProof, holderDID, protocolName? }
// anoncredsProof is the raw proof object already obtained by the caller from an
// agent's GET /proof-data/:id (presentation.anoncreds) — this route does not talk
// to any agent itself, it only transforms an already-verified proof into a VP.
protocolRouter.post('/generate-vp', async (req: Request, res: Response) => {
  try {
    const { anoncredsProof, holderDID, protocolName } = req.body;

    if (!anoncredsProof || !holderDID) {
      return res.status(400).json({
        error: 'anoncredsProof and holderDID are required',
      });
    }

    const { vpJwt, vp } = ProtocolsInterface.generateVerifiablePresentation({
      anoncredsProof,
      holderDID,
      protocolName,
    });

    await AuditService.record({
      eventType: 'vp_generated',
      actorDid: holderDID,
      targetDid: holderDID,
      resourceId: protocolName ?? 'unknown',
      resourceType: 'verifiable_presentation',
      action: 'generateVerifiablePresentation',
      metadata: { protocolName },
    });

    res.status(201).json({ vpJwt, vp });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
