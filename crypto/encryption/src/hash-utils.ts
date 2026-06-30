import crypto from 'crypto';

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256String(str: string): string {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

export function verifyHash(buffer: Buffer, expectedHash: string): boolean {
  return sha256(buffer) === expectedHash;
}

export function generateId(): string {
  return crypto.randomUUID();
}
