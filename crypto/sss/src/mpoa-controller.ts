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

function isExpired(request: RecoveryRequest): boolean {
  return new Date() > new Date(request.expiresAt);
}

export function initiateRecovery(patientDid: string): RecoveryRequest {
  const requestId = generateId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 60 * 60 * 1000);

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

export function getRecoveryStatus(requestId: string): RecoveryRequest {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error(`Recovery request ${requestId} not found`);

  if (request.status === 'pending' && isExpired(request)) {
    request.status = 'expired';
    recoveryRequests.set(requestId, request);
  }

  return { ...request };
}
