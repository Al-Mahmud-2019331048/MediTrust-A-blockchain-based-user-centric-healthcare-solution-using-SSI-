import { Router, Request, Response } from 'express';
import { registerKey, pushEntry, listEntries, deleteAll, getRegisteredPublicKey, ProviderError } from '../provider-service';

export const backupRouter = Router();

function handleError(err: unknown, res: Response) {
  if (err instanceof ProviderError) {
    return res.status(err.status).json({ error: err.message });
  }
  res.status(500).json({ error: (err as Error).message });
}

// POST /backup/patients/:patientDID/register-key
// Body: { publicKeyPem, proof }
// One-time, out-of-band, done before any push is trusted — mirrors
// crypto/sss's POST /sss/mpoa/register-key.
backupRouter.post('/patients/:patientDID/register-key', async (req: Request, res: Response) => {
  const { patientDID } = req.params;
  const { publicKeyPem, proof } = req.body;
  if (!publicKeyPem || !proof) {
    return res.status(400).json({ error: 'publicKeyPem and proof are required' });
  }
  try {
    const result = await registerKey(patientDID, publicKeyPem, proof);
    res.status(result.status === 'registered' ? 201 : 200).json({ success: true, ...result });
  } catch (err) {
    handleError(err, res);
  }
});

// POST /backup/patients/:patientDID/entries
// Body: { token }
backupRouter.post('/patients/:patientDID/entries', async (req: Request, res: Response) => {
  const { patientDID } = req.params;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    await pushEntry(patientDID, token);
    res.status(200).json({ success: true });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /backup/patients/:patientDID/public-key
// Restore-time bootstrap only — see getRegisteredPublicKey()'s doc comment
// for why this is a necessarily weaker, accepted-limitation trust step.
backupRouter.get('/patients/:patientDID/public-key', async (req: Request, res: Response) => {
  try {
    const publicKeyPem = await getRegisteredPublicKey(req.params.patientDID);
    res.status(200).json({ publicKeyPem });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /backup/patients/:patientDID/entries?limit=N
// Deliberately unauthenticated (confirmed decision) — content is always
// already ciphertext by the time it reaches this server, same PoC trust
// boundary as GET /dwn/queryRecord elsewhere in this project.
// limit is optional — omitted, this returns full history (what a real
// restore needs); a caller that only needs to check "does anything exist"
// can pass a small limit to avoid forcing a full scan (see
// provider-service.ts's listEntries doc comment).
backupRouter.get('/patients/:patientDID/entries', async (req: Request, res: Response) => {
  try {
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Number.isNaN(rawLimit) || rawLimit <= 0 ? undefined : rawLimit;
    const tokens = await listEntries(req.params.patientDID, limit);
    res.status(200).json({ tokens });
  } catch (err) {
    handleError(err, res);
  }
});

// DELETE /backup/patients/:patientDID
// Body: { token }
backupRouter.delete('/patients/:patientDID', async (req: Request, res: Response) => {
  const { patientDID } = req.params;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const result = await deleteAll(patientDID, token);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    handleError(err, res);
  }
});
