// HTTP client for communicating with the four SSI agent backends.
// Agent base URLs come from env vars — set NEXT_PUBLIC_GOVERNMENT_URL etc in .env.local

export type AgentType = 'government' | 'doctor' | 'pharmacist' | 'healthcare-authority';

const AGENT_ENDPOINTS: Record<AgentType, string> = {
  government:           process.env.NEXT_PUBLIC_GOVERNMENT_URL    || 'http://localhost:4000',
  doctor:               process.env.NEXT_PUBLIC_DOCTOR_URL        || 'http://localhost:4002',
  pharmacist:           process.env.NEXT_PUBLIC_PHARMACIST_URL    || 'http://localhost:4004',
  'healthcare-authority': process.env.NEXT_PUBLIC_HA_URL          || 'http://localhost:4006',
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

export async function issuePatientCredential(connectionId: string, patientData: {
  name: string; age: string | number; email: string;
  nationalId: string; medicalCondition: string; bloodType: string; emergencyContact: string;
}) {
  const isAvailable = await checkAgentAvailability('government');
  if (!isAvailable) throw new Error('Government agent is not available');

  const response = await fetch(`${AGENT_ENDPOINTS.government}/issue-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, ...patientData }),
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
  return response.json();
}

export async function uploadMedicalDocument(file: File, patientDid: string, documentType: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('patientDid', patientDid);
  formData.append('documentType', documentType);

  const response = await fetch(`${AGENT_ENDPOINTS.doctor}/medical-document/upload`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}

export async function verifyMedicalDocument(documentId: string, documentHash: string) {
  const response = await fetch(`${AGENT_ENDPOINTS.pharmacist}/medical-document/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, documentHash }),
  });
  return response.json();
}

export async function getMedicalDocument(documentId: string): Promise<Blob> {
  const response = await fetch(`${AGENT_ENDPOINTS.pharmacist}/medical-document/${documentId}`);
  return response.blob();
}

export async function sendMessage(agentType: AgentType, connectionId: string, message: string) {
  const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, message }),
  });
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

  const data = await response.json();
  if (data) data.isVerified = true;
  return data;
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
