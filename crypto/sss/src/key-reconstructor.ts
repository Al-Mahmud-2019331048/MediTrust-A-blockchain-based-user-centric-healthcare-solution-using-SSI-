import { combine } from 'shamir-secret-sharing';
import { SSSShare } from '../../../agents/shared/types';

export interface ReconstructResult {
  mek: Buffer;
  reconstructTimeMs: number;
}

export async function reconstructKey(shares: SSSShare[]): Promise<ReconstructResult> {
  if (shares.length < 3) {
    throw new Error(`At least 3 shares required to reconstruct the MEK, got ${shares.length}`);
  }

  const shareArrays = shares.map((s) => new Uint8Array(Buffer.from(s.shareData, 'base64')));

  const start = performance.now();
  const reconstructed = await combine(shareArrays);
  const reconstructTimeMs = performance.now() - start;

  return { mek: Buffer.from(reconstructed), reconstructTimeMs };
}
