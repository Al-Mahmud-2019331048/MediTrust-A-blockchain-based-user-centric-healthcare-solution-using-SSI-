import { sha256, verifyHash } from './hash-utils';
import { verifyDocumentSignature } from './signing-utils';

export interface StoredDocument {
  documentId: string;
  patientDid: string;
  sha256: string;
  docType: string;
  issuedBy: string;
  issuedAt: string;
  content: Buffer;
  signature: string;
}

export interface VerificationResult {
  verified: boolean;
  reason?: string;
}

export function verifyDocumentIntegrity(
  document: StoredDocument,
  expectedHash: string
): VerificationResult {
  // 1. Hash check — does the provided hash match what's stored?
  if (document.sha256 !== expectedHash) {
    return { verified: false, reason: 'Document hash mismatch' };
  }

  // 2. Signature check — does the JWT match the stored metadata?
  try {
    const decoded = verifyDocumentSignature(document.signature) as any;
    if (
      decoded.documentId !== document.documentId ||
      decoded.patientDid !== document.patientDid ||
      decoded.sha256 !== document.sha256
    ) {
      return { verified: false, reason: 'Signature validation failed — metadata mismatch' };
    }
  } catch (error) {
    return { verified: false, reason: `Signature validation failed: ${error.message}` };
  }

  // 3. Content integrity check — recompute hash from raw bytes
  if (!verifyHash(document.content, expectedHash)) {
    return { verified: false, reason: 'Content hash mismatch — document may have been tampered with' };
  }

  return { verified: true };
}

export function computeDocumentHash(buffer: Buffer): string {
  return sha256(buffer);
}
