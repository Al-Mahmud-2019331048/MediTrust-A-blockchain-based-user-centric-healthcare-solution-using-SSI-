import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { sssRouter } from './src/routes/sss-routes';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/sss', sssRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Catches errors express.json() itself throws on malformed request bodies,
// so a bad request gets a clean JSON error instead of Express's default HTML
// error page. Route-level errors are already handled by each route's own
// try/catch — this is a safety net, not the primary error-handling path.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: err.message });
});

// 4008 — not 4006, which apps/web's stale config already references as a
// fallback "healthcare-authority" URL that nothing real backs; picked to
// avoid any confusion with that, not because 4006 is actually taken.
const port = parseInt(process.env.SSS_PORT || '4008');

const server = app.listen(port, () => {
  console.log(`SSS/MPOA key recovery service listening on http://localhost:${port}`);
});

function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => {
    console.log('Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
