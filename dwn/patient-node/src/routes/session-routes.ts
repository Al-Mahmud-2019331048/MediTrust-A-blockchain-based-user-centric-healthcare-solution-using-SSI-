import { Router, Request, Response } from 'express';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { createSessionFromLoginProof, startLogin, sessionPatientDID, endSession, LoginError, testSessionsEnabled, createTestSession } from '../auth/session';
import { checkServiceToken, SERVICE_TOKEN_HEADER } from '../../../../crypto/encryption/src/service-token';
import { isRateLimited } from '../utils/rate-limit';

export const sessionRouter = Router();

// POST /dwn/login/start — Body: { connectionId }
// Asks the Government agent to send the wallet a login proof request and
// returns { proofRecordId, state, loginSecret }. The secret is needed to turn
// the completed proof into a session (POST /dwn/session), which binds the
// login to the browser that started it.
sessionRouter.post('/login/start', async (req: Request, res: Response) => {
  if (isRateLimited(`login-start:${req.ip}`, 20, 60_000)) {
    return res.status(429).json({ error: 'Too many login attempts — try again in a minute.' });
  }
  try {
    res.status(201).json(await startLogin(req.body?.connectionId));
  } catch (err: unknown) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /dwn/session — Body: { proofRecordId, loginSecret }
// Exchanges a completed wallet login proof for a 30-minute session token.
// See src/auth/session.ts for every check applied.
sessionRouter.post('/session', async (req: Request, res: Response) => {
  if (isRateLimited(`session:${req.ip}`, 20, 60_000)) {
    return res.status(429).json({ error: 'Too many login attempts — try again in a minute.' });
  }
  try {
    const session = await createSessionFromLoginProof(req.body?.proofRecordId, req.body?.loginSecret);
    await AuditService.record({
      eventType: 'patient_login',
      actorDid: session.patientDID,
      targetDid: session.patientDID,
      resourceId: session.patientDID,
      resourceType: 'session',
      action: 'login',
      metadata: { method: 'wallet-proof' },
    });
    res.status(201).json(session);
  } catch (err: unknown) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /dwn/test-session — Body: { patientDID }. TEST-ONLY (see
// createTestSession in auth/session.ts): answers 404 unless the DWN was
// started with DWN_ALLOW_TEST_SESSIONS=true, and also requires the SSS
// service token, so it can't be reached by accident or by a normal client.
sessionRouter.post('/test-session', (req: Request, res: Response) => {
  if (!testSessionsEnabled()) return res.status(404).json({ error: 'Not found' });
  if (checkServiceToken(req.header(SERVICE_TOKEN_HEADER)) !== 'ok') {
    return res.status(401).json({ error: 'Test sessions require the service token' });
  }
  try {
    res.status(201).json(createTestSession(req.body?.patientDID));
  } catch (err: unknown) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /dwn/session — which account this token is logged in as.
sessionRouter.get('/session', (req: Request, res: Response) => {
  const patientDID = sessionPatientDID(req);
  if (!patientDID) return res.status(401).json({ error: 'Not logged in' });
  res.json({ patientDID });
});

// DELETE /dwn/session — log out.
sessionRouter.delete('/session', (req: Request, res: Response) => {
  endSession(req);
  res.status(204).end();
});
