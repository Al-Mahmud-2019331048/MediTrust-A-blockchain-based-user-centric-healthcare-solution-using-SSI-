import fs from 'fs/promises';
import path from 'path';
import { BackupDestination, BackupEntry } from './backup-destination';

// A real, working backup destination that needs no external account — used
// as the default so the whole backup/restore mechanism is provably testable
// without depending on live Google Drive credentials. Not a simulation of
// Google Drive; a genuinely separate, self-contained option. Swap
// BACKUP_DESTINATION=google-drive (see google-drive-destination.ts) once
// real OAuth credentials exist.
export class LocalBackupDestination implements BackupDestination {
  private root: string;

  constructor(root?: string) {
    this.root = root ?? process.env.BACKUP_LOCAL_DIR ?? path.resolve(__dirname, '../../backup-storage');
  }

  private patientDir(patientDID: string): string {
    return path.join(this.root, encodeURIComponent(patientDID));
  }

  async putEntry(patientDID: string, entry: BackupEntry): Promise<void> {
    const dir = this.patientDir(patientDID);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, entry.fileName), entry.content, 'utf8');
  }

  async listEntries(patientDID: string, limit?: number): Promise<BackupEntry[]> {
    const dir = this.patientDir(patientDID);
    try {
      const fileNames = await fs.readdir(dir);
      const sorted = fileNames.sort();
      // Slicing before reading (not after) means a limited caller only pays
      // for the files it actually needs, not a full directory read.
      const toRead = limit ? sorted.slice(0, limit) : sorted;
      const entries: BackupEntry[] = [];
      for (const fileName of toRead) {
        try {
          const content = await fs.readFile(path.join(dir, fileName), 'utf8');
          entries.push({ fileName, content });
        } catch {
          console.warn(`LocalBackupDestination.listEntries: skipping unreadable file "${fileName}"`);
        }
      }
      return entries;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}
