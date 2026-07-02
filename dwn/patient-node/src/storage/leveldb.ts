import path from 'path';
import { Level } from 'level';

export interface ScanOptions {
  prefix?: string;
  limit?: number;
}

export interface ScanEntry {
  key: string;
  value: string;
}

// Resolved relative to this file's own location (not process.cwd()), so the
// data directory lands in the same place regardless of where the process
// that imports this module is launched from. DWN_DATA_DIR, if set, is
// resolved relative to process.cwd() (standard env-var-path behavior).
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data/patient-dwn');
const DATA_DIR = process.env.DWN_DATA_DIR ? path.resolve(process.env.DWN_DATA_DIR) : DEFAULT_DATA_DIR;

export class LevelDBAdapter {
  private static db: Level<string, string> = new Level(DATA_DIR, { valueEncoding: 'utf8' });

  static async get(key: string): Promise<string | null> {
    const value = await LevelDBAdapter.db.get(key);
    return value === undefined ? null : value;
  }

  static async put(key: string, value: string): Promise<void> {
    await LevelDBAdapter.db.put(key, value);
  }

  static async del(key: string): Promise<void> {
    await LevelDBAdapter.db.del(key);
  }

  static async scan(options: ScanOptions = {}): Promise<ScanEntry[]> {
    const { prefix, limit } = options;
    const iteratorOptions = prefix ? { gte: prefix, lte: prefix + '￿' } : {};
    const results: ScanEntry[] = [];
    for await (const [key, value] of LevelDBAdapter.db.iterator(iteratorOptions)) {
      results.push({ key, value });
      if (limit && results.length >= limit) break;
    }
    return results;
  }

  static async close(): Promise<void> {
    await LevelDBAdapter.db.close();
  }
}
