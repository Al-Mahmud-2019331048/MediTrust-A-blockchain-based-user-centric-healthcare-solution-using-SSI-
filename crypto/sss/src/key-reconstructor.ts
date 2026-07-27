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

  // Asymmetric with splitMEK()'s own 32-byte check on the way in — combine()
  // doesn't validate its output length, so a mismatched/corrupted share set
  // could otherwise hand back a wrong-length "key" with no error here.
  if (reconstructed.length !== 32) {
    throw new Error(`Reconstructed key has unexpected length (${reconstructed.length} bytes, expected 32)`);
  }

  return { mek: Buffer.from(reconstructed), reconstructTimeMs };
}
