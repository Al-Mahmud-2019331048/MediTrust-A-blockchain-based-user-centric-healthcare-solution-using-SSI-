import { split } from 'shamir-secret-sharing';
import { generateId } from '../../encryption/src/hash-utils';
import { SSSShare } from '../../../agents/shared/types';

const SHARE_HOLDERS: SSSShare['holder'][] = [
  'patient',
  'hospital',
  'trusted_family',
  'backup_server',
  'recovery_agent',
];

export interface SplitResult {
  shares: SSSShare[];
  splitTimeMs: number;
  threshold: number;
  total: number;
}

export async function splitMEK(mek: Buffer): Promise<SplitResult> {
  if (mek.length !== 32) {
    throw new Error(`MEK must be 32 bytes for AES-256, got ${mek.length}`);
  }

  const start = performance.now();
  const rawShares = await split(new Uint8Array(mek), 5, 3);
  const splitTimeMs = performance.now() - start;

  const shares: SSSShare[] = rawShares.map((shareBytes, i) => ({
    shareId: generateId(),
    shareIndex: i + 1,
    holder: SHARE_HOLDERS[i],
    shareData: Buffer.from(shareBytes).toString('base64'),
  }));

  return { shares, splitTimeMs, threshold: 3, total: 5 };
}
