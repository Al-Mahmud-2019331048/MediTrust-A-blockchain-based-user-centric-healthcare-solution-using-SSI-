import * as jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Keep signing secrets for documents and audit logs separate
const DOCUMENT_SIGNING_SECRET = process.env.DOCUMENT_SIGNING_SECRET;
const AUDIT_SIGNING_SECRET = process.env.AUDIT_SIGNING_SECRET;
const VP_SIGNING_SECRET = process.env.VP_SIGNING_SECRET;

if (!DOCUMENT_SIGNING_SECRET || !AUDIT_SIGNING_SECRET || !VP_SIGNING_SECRET) {
  console.warn('⚠️  One or more signing secrets are not set in environment variables. Set DOCUMENT_SIGNING_SECRET, AUDIT_SIGNING_SECRET, VP_SIGNING_SECRET.');
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

// Patient-owned-key signing (Operation Fullbring gap-closure) — used for
// consent receipts and for audit events that represent an action the
// patient (or their own device, acting immediately on self-custody) took
// themselves, replacing what used to be a single shared CONSENT_SIGNING_SECRET
// every patient's receipts were signed with. ES256 (ECDSA P-256), not Ed25519
// — the installed jsonwebtoken@9's SUPPORTED_ALGS has no EdDSA entry.
export function signWithPatientKey(payload: Record<string, unknown>, privateKeyPem: string): string {
  return jwt.sign(payload, privateKeyPem, { algorithm: 'ES256', expiresIn: '10y' });
}

export function verifyWithPatientKey(token: string, publicKeyPem: string): Record<string, unknown> {
  return jwt.verify(token, publicKeyPem, { algorithms: ['ES256'] }) as Record<string, unknown>;
}

export function signVerifiablePresentation(payload: Record<string, unknown>): string {
  if (!VP_SIGNING_SECRET) throw new Error('VP_SIGNING_SECRET is not set');
  return jwt.sign(payload, VP_SIGNING_SECRET, { expiresIn: '10y' });
}

export function verifyVerifiablePresentation(token: string): Record<string, unknown> {
  if (!VP_SIGNING_SECRET) throw new Error('VP_SIGNING_SECRET is not set');
  return jwt.verify(token, VP_SIGNING_SECRET) as Record<string, unknown>;
}
