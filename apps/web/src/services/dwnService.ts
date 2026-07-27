// HTTP client for the patient's own DWN node (records, permissions, self-custody
// key recovery, restore). Separate from apiService.ts, which only talks to the
// SSI agents (government/doctor/pharmacist) — the DWN is a different service
// on a different port (see CLAUDE.md: PATIENT_DWN_URL, default :5050).

const DWN_URL = process.env.NEXT_PUBLIC_DWN_URL || 'http://localhost:5050';

export interface DWNRecordSummary {
  recordId: string;
  patientDID: string;
  recordType: string;
  protocol: string;
  contentType: string;
  fileName: string | null;
  fileSize: number;
  data: unknown;
  // Only present on self-reads (the patient reading their own record) —
  // omitted for non-self/grant-based reads, since it would otherwise leak
  // the identities of every other party with access to the patient.
  accessPolicy?: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  permissionId: string;
  patientDID: string;
  grantedToDID: string;
  recordType: string;
  allowedFields: string[];
  purpose: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

async function asJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Server responded with ${response.status}`);
  return body;
}

export async function queryRecords(patientDID: string, requesterDID: string = patientDID): Promise<DWNRecordSummary[]> {
  const response = await fetch(
    `${DWN_URL}/dwn/queryRecord?patientDID=${encodeURIComponent(patientDID)}&requesterDID=${encodeURIComponent(requesterDID)}`
  );
  const body = await asJson(response);
  return Array.isArray(body) ? body : [body];
}

export async function shareRecord(input: {
  patientDID: string; grantedToDID: string; recordType: string;
  purpose: string; allowedFields?: string[]; expiresAt?: string | null;
}): Promise<Permission> {
  const response = await fetch(`${DWN_URL}/dwn/shareRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return asJson(response);
}

export async function revokeAccess(input: { patientDID: string; grantedToDID: string; recordType: string }) {
  const response = await fetch(`${DWN_URL}/dwn/revokeAccess`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return asJson(response);
}

export interface SelfCustodyShare {
  shareId: string;
  shareIndex: number;
  holder: 'primary_device' | 'paper_backup' | 'secondary_device';
  shareData: string;
}

export async function initiateSelfCustody(patientDID: string): Promise<{
  shares: SelfCustodyShare[]; splitTimeMs: number; threshold: number; total: number; isNewPatient: boolean;
}> {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/self-custody/initiate`, {
    method: 'POST',
  });
  return asJson(response);
}

export async function restoreSelfCustody(patientDID: string, shares: SelfCustodyShare[]) {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/self-custody/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shares }),
  });
  return asJson(response);
}

export async function getMekStatus(patientDID: string): Promise<{ hasMEK: boolean }> {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/mek-status`);
  return asJson(response);
}

export async function restoreData(patientDID: string) {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/restore-data`, {
    method: 'POST',
  });
  return asJson(response);
}

export async function getSigningKeyStatus(patientDID: string): Promise<{ hasKey: boolean; publicKeyFingerprint: string | null }> {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/signing-key-status`);
  return asJson(response);
}

export async function checkDwnHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${DWN_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
