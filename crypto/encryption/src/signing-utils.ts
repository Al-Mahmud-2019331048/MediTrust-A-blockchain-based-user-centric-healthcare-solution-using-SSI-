import * as jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Keep signing secrets for documents and audit logs separate
const DOCUMENT_SIGNING_SECRET = process.env.DOCUMENT_SIGNING_SECRET;
const AUDIT_SIGNING_SECRET = process.env.AUDIT_SIGNING_SECRET;
const CONSENT_SIGNING_SECRET = process.env.CONSENT_SIGNING_SECRET;

if (!DOCUMENT_SIGNING_SECRET || !AUDIT_SIGNING_SECRET || !CONSENT_SIGNING_SECRET) {
  console.warn('⚠️  One or more signing secrets are not set in environment variables. Set DOCUMENT_SIGNING_SECRET, AUDIT_SIGNING_SECRET, CONSENT_SIGNING_SECRET.');
}

export function signDocumentMetadata(payload: Record<string, unknown>): string {
  if (!DOCUMENT_SIGNING_SECRET) throw new Error('DOCUMENT_SIGNING_SECRET is not set');
  return jwt.sign(payload, DOCUMENT_SIGNING_SECRET, { expiresIn: '10y' });
}

export function verifyDocumentSignature(token: string): Record<string, unknown> {
  if (!DOCUMENT_SIGNING_SECRET) throw new Error('DOCUMENT_SIGNING_SECRET is not set');
  return jwt.verify(token, DOCUMENT_SIGNING_SECRET) as Record<string, unknown>;
}

export function signAuditEvent(payload: Record<string, unknown>): string {
  if (!AUDIT_SIGNING_SECRET) throw new Error('AUDIT_SIGNING_SECRET is not set');
  return jwt.sign(payload, AUDIT_SIGNING_SECRET, { expiresIn: '10y' });
}

export function verifyAuditEventSignature(token: string): Record<string, unknown> {
  if (!AUDIT_SIGNING_SECRET) throw new Error('AUDIT_SIGNING_SECRET is not set');
  return jwt.verify(token, AUDIT_SIGNING_SECRET) as Record<string, unknown>;
}

export function signConsentReceipt(payload: Record<string, unknown>): string {
  if (!CONSENT_SIGNING_SECRET) throw new Error('CONSENT_SIGNING_SECRET is not set');
  return jwt.sign(payload, CONSENT_SIGNING_SECRET, { expiresIn: '10y' });
}

export function verifyConsentSignature(token: string): Record<string, unknown> {
  if (!CONSENT_SIGNING_SECRET) throw new Error('CONSENT_SIGNING_SECRET is not set');
  return jwt.verify(token, CONSENT_SIGNING_SECRET) as Record<string, unknown>;
}
