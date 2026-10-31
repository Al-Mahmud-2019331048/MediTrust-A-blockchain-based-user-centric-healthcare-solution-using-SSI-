// HTTP client for communicating with the three SSI agent backends.
// Agent base URLs come from env vars — set NEXT_PUBLIC_GOVERNMENT_URL etc in .env.local

import type { DWNRecordSummary } from './dwnService';

export type AgentType = 'government' | 'doctor' | 'pharmacist' | 'healthcare-authority';

const AGENT_ENDPOINTS: Record<AgentType, string> = {
  government: process.env.NEXT_PUBLIC_GOVERNMENT_URL || 'http://localhost:4000',
  doctor:     process.env.NEXT_PUBLIC_DOCTOR_URL     || 'http://localhost:4002',
  pharmacist: process.env.NEXT_PUBLIC_PHARMACIST_URL || 'http://localhost:4004',
  'healthcare-authority': process.env.NEXT_PUBLIC_HEALTHCARE_AUTHORITY_URL || 'http://localhost:4006',
};

async function checkAgentAvailability(agentType: AgentType): Promise<boolean> {
  try {
    const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/connections`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function createInvitation(agentType: AgentType, label: string, alias: string) {
  const isAvailable = await checkAgentAvailability(agentType);
  if (!isAvailable) throw new Error(`Agent ${agentType} is not available`);

  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/create-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, alias }),
    mode: 'cors',
  });

  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function getConnections(agentType: AgentType, connectionId?: string | null) {
  const isAvailable = await checkAgentAvailability(agentType);
  if (!isAvailable) return [];

  const url = connectionId
    ? `${AGENT_ENDPOINTS[agentType]}/connections?connectionId=${connectionId}`
    : `${AGENT_ENDPOINTS[agentType]}/connections`;

  const response = await fetch(url);
  if (!response.ok) return [];
  return response.json();
}

export interface IssuePatientCredentialResult {
  success: boolean;
  message?: string;
  isW3C?: boolean;
  credentialId?: string;
  // Set when the second, independent extended-profile credential
  // (medicalCondition/bloodType/emergencyContact) was also issued —
  // undefined if that credDef wasn't registered this boot (best-effort, see
  // government-agent's credential-routes.ts).
  extendedProfileCredentialId?: string;
  // Stable identifier for this patient, independent of any DIDComm
  // connection — see government-agent's credential-routes.ts.
  patientAccountId?: string;
}

// Agent routes return { error } on failure — surface that message rather
// than the raw response body.
async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return JSON.parse(text).error ?? text;
  } catch {
    return text || `Server responded with ${response.status}`;
  }
}

export interface VerifiedCitizen {
  nationalId: string;
  name: string;
  age: number;
}

// Step 1 of identity verification: the government checks the phone is a SIM
// registered to this NID and sends it a one-time code.
export async function startIdentityVerification(connectionId: string, nationalId: string, phoneNumber: string): Promise<{
  verificationId: string; maskedPhone: string; expiresInSeconds: number;
}> {
  const response = await fetch(`${AGENT_ENDPOINTS.government}/identity-verification/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, nationalId, phoneNumber }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

// Step 2: the patient enters the code they received.
export async function confirmIdentityVerification(verificationId: string, code: string): Promise<VerifiedCitizen> {
  const response = await fetch(`${AGENT_ENDPOINTS.government}/identity-verification/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId, code }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()).citizen;
}

// SIMULATED SMS inbox — stands in for the patient's phone (no real SMS gateway).
export async function getSimulatedSms(phoneNumber: string): Promise<{
  phoneNumber: string; messages: { message: string; sentAt: string }[];
}> {
  const response = await fetch(`${AGENT_ENDPOINTS.government}/simulated-sms/${encodeURIComponent(phoneNumber)}`);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

// Name, age and NID are not sent — the government takes them from its own
// records for the verified person. Only self-declared fields go here.
export async function issuePatientCredential(connectionId: string, verificationId: string, profile: {
  email: string; medicalCondition: string; bloodType: string; emergencyContact: string;
}): Promise<IssuePatientCredentialResult> {
  const isAvailable = await checkAgentAvailability('government');
  if (!isAvailable) throw new Error('Government agent is not available');

  const response = await fetch(`${AGENT_ENDPOINTS.government}/issue-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, verificationId, ...profile }),
  });

  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export interface DocumentAttachment {
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  fileName: string;
  data: string; // base64
}

// The patient's stable identity, as established by the Doctor Portal's
// verification step. patientDID, when supplied, becomes the DWN's
// patientDID for this write — replacing the ephemeral connection-derived
// DID doctor-agent otherwise falls back to. identityVerified distinguishes
// a cryptographically-verified proof from a manually-typed fallback ID.
export interface VerifiedPatientIdentity {
  patientDID?: string;
  identityVerified?: boolean;
  // Required for identityVerified to actually be honored server-side —
  // doctor-agent independently re-verifies this against its own proof
  // records rather than trusting identityVerified as sent.
  proofRecordId?: string;
}

export async function issueMedicalCredential(connectionId: string, doc: {
  documentId: string; documentType: string; patientName: string; patientId: string;
  diagnosis: string; prescription: string; issuedBy: string;
}, attachment?: DocumentAttachment, identity?: VerifiedPatientIdentity) {
  const response = await fetch(`${AGENT_ENDPOINTS.doctor}/issue-medical-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, ...doc, issuedAt: new Date().toISOString(), attachment, ...identity }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  return response.json();
}

// Reads a patient's records directly from their DWN, using the doctor
// agent's own DID as the requester — the DWN-selective-sharing pathway,
// independent of issuance. Requires the patient to have already granted the
// doctor's DID access via the Patient Portal's Consent Manager; omitting
// recordType returns every type the doctor currently holds a grant for.
export async function readPatientRecords(
  patientDID: string,
  recordType?: 'medical' | 'prescription' | 'lab_report'
): Promise<DWNRecordSummary[]> {
  const response = await fetch(`${AGENT_ENDPOINTS.doctor}/read-patient-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientDID, recordType }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.records;
}

export async function issuePrescription(connectionId: string, doc: {
  patientName: string; patientId: string; diagnosis: string; prescription: string; documentId?: string;
}, attachment?: DocumentAttachment, identity?: VerifiedPatientIdentity) {
  const response = await fetch(`${AGENT_ENDPOINTS.doctor}/issue-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, ...doc, attachment, ...identity }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function sendProofRequest(agentType: AgentType, connectionId: string, proofRequestlabel: string) {
  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/send-proof-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, proofRequestlabel, version: '1.0' }),
  });
  // Without this check, a real server error (e.g. connection not yet fully
  // established) parses as a body with no `id` field, and the caller
  // (useProofVerification) silently polls forever until its own 120s
  // timeout instead of surfacing the real error immediately.
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  return response.json();
}

// pharmacy-agent's /verify-patient-identity and /verify-prescription both
// return { success, proofRecordId, state } — normalized here to { id, state }
// so both can be passed as useProofVerification's requestFn override.
export async function verifyPatientIdentity(connectionId: string): Promise<{ id: string; state: string }> {
  const response = await fetch(`${AGENT_ENDPOINTS.pharmacist}/verify-patient-identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return { id: data.proofRecordId, state: data.state };
}

export async function verifyPrescription(connectionId: string): Promise<{ id: string; state: string }> {
  const response = await fetch(`${AGENT_ENDPOINTS.pharmacist}/verify-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return { id: data.proofRecordId, state: data.state };
}

export interface DWNPrescriptionRecord {
  recordId: string;
  recordType: string;
  createdAt: string;
  data: Record<string, unknown> | string;
}

// Reads the patient's prescription record(s) directly from their DWN via
// pharmacy-agent's /read-prescription — the DWN-selective-sharing pathway,
// independent of the ZKP-based verifyPrescription() above. Requires the
// patient to have already granted PHARMACY_DID access via the Patient
// Portal's Consent Manager; throws with the DWN's real status (e.g. 403)
// embedded in the message when they haven't yet.
export async function readPrescriptionFromDWN(patientDID: string): Promise<DWNPrescriptionRecord[]> {
  const response = await fetch(`${AGENT_ENDPOINTS.pharmacist}/read-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientDID }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.records;
}

export async function sendMessage(agentType: AgentType, connectionId: string, message: string) {
  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, message }),
  });
  if (!response.ok) throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function getProofRecords(agentType: AgentType, proofRecordId?: string | null) {
  const isAvailable = await checkAgentAvailability(agentType);
  if (!isAvailable) return [];

  const url = proofRecordId
    ? `${AGENT_ENDPOINTS[agentType]}/proof-records?proofRecordId=${proofRecordId}`
    : `${AGENT_ENDPOINTS[agentType]}/proof-records`;

  const response = await fetch(url);
  if (!response.ok) return [];
  return response.json();
}

export async function getProofData(agentType: AgentType, proofRecordId: string) {
  const isAvailable = await checkAgentAvailability(agentType);
  if (!isAvailable) return null;

  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/proof-data/${proofRecordId}`);
  if (!response.ok) return null;

  // The server (verifier-routes.ts) already computes and includes a real
  // isVerified field from the proof record's actual state — forcing it to
  // true here unconditionally used to silently overwrite that with a false
  // positive regardless of the real response. Not currently exploited (no
  // caller reads this field today), but a real landmine for anything that
  // starts trusting it.
  return response.json();
}

export async function getAgentStatus(agentType: AgentType): Promise<{ agentDid?: string } | null> {
  const isAvailable = await checkAgentAvailability(agentType);
  if (!isAvailable) return null;

  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/agent-status`);
  if (!response.ok) return null;
  return response.json();
}

export async function getProofStatus(agentType: AgentType, proofRecordId: string) {
  const isAvailable = await checkAgentAvailability(agentType);
  if (!isAvailable) return { isVerified: false, state: 'unknown', error: 'Agent not available' };

  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/proof-status/${proofRecordId}`);
  if (!response.ok) {
    if (response.status === 404) return { isVerified: false, state: 'not_found' };
    return { isVerified: false, state: 'error' };
  }
  return response.json();
}
