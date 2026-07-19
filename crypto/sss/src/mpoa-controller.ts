import crypto from 'crypto';
import { generateId } from '../../encryption/src/hash-utils';
import { AuditService } from '../../../audit/src/services/audit-service';
import { MPOAApproval, RecoveryRequest } from '../../../agents/shared/types';

const REQUIRED_APPROVER_ROLES: MPOAApproval['approverRole'][] = [
  'patient',
  'hospital',
  'guardian',
];

const EXPIRY_HOURS = 24;

const recoveryRequests = new Map<string, RecoveryRequest>();

// Registered out-of-band, once, by the patient, before any recovery request
// exists — the patient enters each guardian/hospital contact's own public
// key at MPOA setup time, the same trust-on-first-use model already used for
// self-custody's 3 shares. This is what approveRecovery() verifies signatures
// against, closing the "any non-empty string passes as a signature" gap. It
// deliberately does NOT prove a key really belongs to the real-world
// hospital/guardian it claims to — that binding needs a real institutional
// DID/credential, which doesn't exist in this PoC and is an accepted, named
// limitation rather than something this mechanism claims to solve.
const registeredApproverKeys = new Map<string, Partial<Record<MPOAApproval['approverRole'], string>>>();

function assertValidRole(approverRole: string): asserts approverRole is MPOAApproval['approverRole'] {
  if (!REQUIRED_APPROVER_ROLES.includes(approverRole as MPOAApproval['approverRole'])) {
    throw new Error(`Invalid approverRole '${approverRole}' — must be one of: ${REQUIRED_APPROVER_ROLES.join(', ')}`);
  }
}

export function registerApproverKey(
  patientDid: string,
  approverRole: MPOAApproval['approverRole'],
  publicKeyPem: string
): void {
  assertValidRole(approverRole);
  const existing = registeredApproverKeys.get(patientDid) ?? {};
  existing[approverRole] = publicKeyPem;
  registeredApproverKeys.set(patientDid, existing);
}

export function getRegisteredApproverKeys(patientDid: string): Partial<Record<MPOAApproval['approverRole'], string>> {
  return { ...(registeredApproverKeys.get(patientDid) ?? {}) };
}

// What an approver actually signs — binds the signature to this specific
// request, role, and approver DID, so a signature captured from one request
// can't be replayed against a different one.
function canonicalApprovalPayload(requestId: string, approverRole: string, approverDid: string): Buffer {
  return Buffer.from(`${requestId}:${approverRole}:${approverDid}`, 'utf8');
}

function isExpired(request: RecoveryRequest): boolean {
  return new Date() > new Date(request.expiresAt);
}

export function initiateRecovery(patientDid: string, expiryHours: number = EXPIRY_HOURS): RecoveryRequest {
  const requestId = generateId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);

  const request: RecoveryRequest = {
    requestId,
    patientDid,
    initiatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    approvals: [],
    status: 'pending',
  };

  recoveryRequests.set(requestId, request);

  AuditService.record({
    eventType: 'key_recovery_initiated',
    actorDid: patientDid,
    targetDid: patientDid,
    resourceId: requestId,
    resourceType: 'recovery_request',
    action: 'initiateRecovery',
    metadata: { expiresAt: request.expiresAt },
  });

  return { ...request };
}

export function approveRecovery(
  requestId: string,
  approverDid: string,
  approverRole: MPOAApproval['approverRole'],
  signature: string,
): RecoveryRequest {
  const request = recoveryRequests.get(requestId);

  if (!request) throw new Error(`Recovery request ${requestId} not found`);
  // approverRole arrives over HTTP as a plain string — TypeScript's union type
  // only guards compile-time callers, not a raw JSON body. Reject anything
  // outside the real role set before it can be silently stored as a
  // structurally-useless approval that can never contribute to the threshold.
  if (!REQUIRED_APPROVER_ROLES.includes(approverRole)) {
    throw new Error(
      `Invalid approverRole '${approverRole}' — must be one of: ${REQUIRED_APPROVER_ROLES.join(', ')}`
    );
  }
  if (isExpired(request)) {
    request.status = 'expired';
    recoveryRequests.set(requestId, request);
    throw new Error(`Recovery request ${requestId} has expired`);
  }
  if (request.status !== 'pending') {
    throw new Error(`Recovery request ${requestId} is already ${request.status}`);
  }

  const alreadyApproved = request.approvals.some((a) => a.approverRole === approverRole);
  if (alreadyApproved) {
    throw new Error(`Role '${approverRole}' has already approved this request`);
  }

  // Real cryptographic verification (previously: signature was only checked
  // for non-empty presence, so ANY string passed — confirmed live via
  // adversarial testing that a single caller could forge all 3 role
  // approvals unaided). The registered key comes from registerApproverKey(),
  // set up out-of-band by the patient before this request existed.
  const registeredKey = registeredApproverKeys.get(request.patientDid)?.[approverRole];
  if (!registeredKey) {
    throw new Error(
      `No public key registered for role '${approverRole}' on patient ${request.patientDid} — ` +
        `register one first via registerApproverKey (POST /sss/mpoa/register-key)`
    );
  }
  let signatureValid: boolean;
  try {
    signatureValid = crypto.verify(
      null,
      canonicalApprovalPayload(requestId, approverRole, approverDid),
      registeredKey,
      Buffer.from(signature, 'base64')
    );
  } catch {
    // Malformed base64/signature bytes — treat as a failed verification, not
    // a crash.
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new Error(`Signature verification failed for role '${approverRole}' on request ${requestId}`);
  }

  const approval: MPOAApproval = {
    approverDid,
    approverRole,
    approvedAt: new Date().toISOString(),
    signature,
  };

  request.approvals.push(approval);

  const approvedRoles = request.approvals.map((a) => a.approverRole);
  const allApproved = REQUIRED_APPROVER_ROLES.every((role) => approvedRoles.includes(role));
  if (allApproved) request.status = 'approved';

  recoveryRequests.set(requestId, request);

  AuditService.record({
    eventType: 'key_recovery_approved',
    actorDid: approverDid,
    targetDid: request.patientDid,
    resourceId: requestId,
    resourceType: 'recovery_request',
    action: 'approveRecovery',
    metadata: { approverRole, status: request.status },
  });

  return { ...request };
}

// Tags a request with the shareIds of the specific split issued for it, so
// reconstruct() can later verify submitted shares actually belong to THIS
// request rather than any other valid-looking Shamir share set (e.g. a
// different patient's split, or an older split for the same patient).
export function attachIssuedShares(requestId: string, shareIds: string[]): RecoveryRequest {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error(`Recovery request ${requestId} not found`);

  request.issuedShareIds = shareIds;
  recoveryRequests.set(requestId, request);

  return { ...request };
}

export function getRecoveryStatus(requestId: string): RecoveryRequest {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error(`Recovery request ${requestId} not found`);

  if (request.status === 'pending' && isExpired(request)) {
    request.status = 'expired';
    recoveryRequests.set(requestId, request);
  }

  return { ...request };
}
