import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import { recordRouter } from './src/routes/record-routes';
import { permissionRouter } from './src/routes/permission-routes';
import { protocolRouter } from './src/routes/protocol-routes';
import { LevelDBAdapter } from './src/storage/leveldb';

const app = express();
// Default Express JSON limit (100kb) is too small for base64-encoded
// images/PDFs that storeRecord accepts inline in the request body.
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// recordRouter/permissionRouter define full leaf paths (e.g. /storeRecord),
// protocolRouter defines relative sub-paths (e.g. /define) — mount prefixes
// match each router file's own documented intent.
app.use('/dwn', recordRouter);
app.use('/dwn', permissionRouter);
app.use('/dwn/protocols', protocolRouter);

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

// 5050, not 5000 — macOS's AirPlay Receiver squats on 5000 by default on some
// machines (System Settings > General > AirDrop & Handoff), so this project
// avoids that port entirely rather than asking every dev to change a system
// setting. See CLAUDE.md Known Constraints.
const port = parseInt(process.env.DWN_PORT || '5050');

const server = app.listen(port, () => {
  console.log(`DWN patient node listening on http://localhost:${port}`);
});

async function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close();
  await LevelDBAdapter.close();
  console.log('Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
