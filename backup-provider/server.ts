import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { backupRouter } from './src/routes/backup-routes';
import { LevelDBAdapter } from './src/storage/leveldb';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/backup', backupRouter);

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

const port = parseInt(process.env.BACKUP_PROVIDER_PORT || '4010');

const server = app.listen(port, () => {
  console.log(`Backup provider service listening on http://localhost:${port}`);
});

function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(async () => {
    await LevelDBAdapter.close();
    console.log('Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
