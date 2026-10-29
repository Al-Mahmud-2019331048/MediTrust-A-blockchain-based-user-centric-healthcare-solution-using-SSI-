import { split, combine } from 'shamir-secret-sharing';
import { generateId } from '../../encryption/src/hash-utils';

// Operation Fullbring's self-custody recovery path — for "I lost my own
// device," the ordinary case. Splits a patient's real MEK 5 ways (threshold
// 3) across things ONLY the patient owns (their primary device, a printed
// paper backup, a second device, their own encrypted cloud backup, and a
// safe deposit box / other secure physical location) — no hospital, no
// family member, no outside party ever holds a piece or approves anything.
// This is a separate, independent split of the SAME underlying MEK from the
// existing institutional MPOA path (key-splitter.ts/mpoa-controller.ts,
// unchanged) — mathematically sound, since Shamir shares reveal nothing
// below the threshold regardless of which independent share-set they belong
// to.
//
// Deliberately does NOT persist these shares anywhere on the server — the
// whole point of self-custody is that the server never retains a usable
// piece. Callers (the patient's own app) are responsible for saving each
// share to wherever the patient chooses (their own device storage, a
// printed QR code, etc.).

export type SelfCustodyHolder =
  | 'primary_device'
  | 'paper_backup'
  | 'secondary_device'
  | 'cloud_backup'
  | 'safe_deposit_box';

const SELF_CUSTODY_HOLDERS: SelfCustodyHolder[] = [
  'primary_device',
  'paper_backup',
  'secondary_device',
  'cloud_backup',
  'safe_deposit_box',
];

export interface SelfCustodyShare {
  shareId: string;
  shareIndex: number;
  holder: SelfCustodyHolder;
  shareData: string; // base64
  // Which account this share belongs to — carried on the share itself so a
  // patient who only has their paper backup (having lost the device that
  // remembered their account ID) still has enough to identify which account
  // to restore. Without this, the ID exists nowhere but browser localStorage
  // and the patient's own memory — a real "not patient-centric" gap found
  // 2026-08-10 during live recovery testing (pasting one account's shares
  // into a different account's restore correctly failed verification, but
  // with a confusing error — this field lets the UI catch it with a clear
  // one instead, see self-custody-routes.ts's restore route).
  patientDID: string;
}

export interface SelfCustodySplitResult {
  shares: SelfCustodyShare[];
  splitTimeMs: number;
  threshold: number;
  total: number;
}

export async function splitMEKSelfCustody(mek: Buffer, patientDID: string): Promise<SelfCustodySplitResult> {
  if (mek.length !== 32) {
    throw new Error(`MEK must be 32 bytes for AES-256, got ${mek.length}`);
  }

  const start = performance.now();
  const rawShares = await split(new Uint8Array(mek), 5, 3);
  const splitTimeMs = performance.now() - start;

  const shares: SelfCustodyShare[] = rawShares.map((shareBytes, i) => ({
    shareId: generateId(),
    shareIndex: i + 1,
    holder: SELF_CUSTODY_HOLDERS[i],
    shareData: Buffer.from(shareBytes).toString('base64'),
    patientDID,
  }));

  return { shares, splitTimeMs, threshold: 3, total: 5 };
}

export interface SelfCustodyReconstructResult {
  mek: Buffer;
  reconstructTimeMs: number;
}

export async function reconstructMEKSelfCustody(shares: SelfCustodyShare[]): Promise<SelfCustodyReconstructResult> {
  if (shares.length < 3) {
    throw new Error(`At least 3 shares required to reconstruct via self-custody, got ${shares.length}`);
  }

  const shareArrays = shares.map((s) => new Uint8Array(Buffer.from(s.shareData, 'base64')));

  const start = performance.now();
  const reconstructed = await combine(shareArrays);
  const reconstructTimeMs = performance.now() - start;

  // Asymmetric with splitMEKSelfCustody()'s own 32-byte check on the way in
  // — combine() doesn't validate its output length.
  if (reconstructed.length !== 32) {
    throw new Error(`Reconstructed key has unexpected length (${reconstructed.length} bytes, expected 32)`);
  }

  return { mek: Buffer.from(reconstructed), reconstructTimeMs };
}
