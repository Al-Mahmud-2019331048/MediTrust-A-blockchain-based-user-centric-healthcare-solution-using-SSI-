import { Router, Request, Response } from 'express';
import { splitMEK } from '../key-splitter';
import { reconstructKey } from '../key-reconstructor';
import { initiateRecovery, approveRecovery, getRecoveryStatus } from '../mpoa-controller';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { SSSShare } from '../../../../agents/shared/types';

export const sssRouter = Router();

// POST /sss/split
// Body: { mek: string }  — hex-encoded 32-byte key
sssRouter.post('/split', async (req: Request, res: Response) => {
  try {
    const { mek } = req.body;
    if (!mek || typeof mek !== 'string') {
      return res.status(400).json({ error: 'mek (hex string) is required' });
    }

    const mekBuffer = Buffer.from(mek, 'hex');
    const result = await splitMEK(mekBuffer);

    await AuditService.record({
      eventType: 'key_split',
      actorDid: req.body.patientDid ?? 'unknown',
      targetDid: req.body.patientDid ?? 'unknown',
      resourceId: result.shares[0].shareId,
      resourceType: 'mek',
      action: 'splitMEK',
      metadata: { splitTimeMs: result.splitTimeMs, total: result.total, threshold: result.threshold },
    });

    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/initiate
// Body: { patientDid: string }
sssRouter.post('/recovery/initiate', (req: Request, res: Response) => {
  try {
    const { patientDid } = req.body;
    if (!patientDid) return res.status(400).json({ error: 'patientDid is required' });

    const request = initiateRecovery(patientDid);
    res.json(request);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/approve
// Body: { requestId, approverDid, approverRole, signature }
sssRouter.post('/recovery/approve', (req: Request, res: Response) => {
  try {
    const { requestId, approverDid, approverRole, signature } = req.body;
    if (!requestId || !approverDid || !approverRole || !signature) {
      return res.status(400).json({ error: 'requestId, approverDid, approverRole, and signature are required' });
    }

    const request = approveRecovery(requestId, approverDid, approverRole, signature);
    res.json(request);
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /sss/recovery/:requestId/status
sssRouter.get('/recovery/:requestId/status', (req: Request, res: Response) => {
  try {
    const request = getRecoveryStatus(req.params.requestId);
    res.json(request);
  } catch (err: unknown) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// POST /sss/recovery/:requestId/reconstruct
// Body: { shares: SSSShare[] }
sssRouter.post('/recovery/:requestId/reconstruct', async (req: Request, res: Response) => {
  try {
    const status = getRecoveryStatus(req.params.requestId);
    if (status.status !== 'approved') {
      return res.status(403).json({ error: `Cannot reconstruct — request status is '${status.status}', must be 'approved'` });
    }

    const shares: SSSShare[] = req.body.shares;
    if (!Array.isArray(shares) || shares.length < 3) {
      return res.status(400).json({ error: 'At least 3 shares required' });
    }

    const { mek, reconstructTimeMs } = await reconstructKey(shares);

    await AuditService.record({
      eventType: 'key_reconstructed',
      actorDid: status.patientDid,
      targetDid: status.patientDid,
      resourceId: req.params.requestId,
      resourceType: 'mek',
      action: 'reconstructKey',
      metadata: { reconstructTimeMs },
    });

    res.json({ mek: mek.toString('hex'), reconstructTimeMs });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
