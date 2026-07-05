import { Router, Request, Response } from 'express';
import { ProtocolsInterface } from '../interfaces/protocols';
import { AuditService } from '../../../../audit/src/services/audit-service';

export const protocolRouter = Router();

// POST /dwn/protocols/define — mounted at /dwn/protocols/* by server.ts (Day 13)
// Body: { name, actorRole, allowedFields }
protocolRouter.post('/define', async (req: Request, res: Response) => {
  try {
    const { name, actorRole, allowedFields } = req.body;

    if (!name || !actorRole || !allowedFields) {
      return res.status(400).json({
        error: 'name, actorRole, and allowedFields are required',
      });
    }
    if (!Array.isArray(allowedFields)) {
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
