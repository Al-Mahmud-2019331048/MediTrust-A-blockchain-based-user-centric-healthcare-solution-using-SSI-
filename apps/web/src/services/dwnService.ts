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

// --- Wallet-login session (2026-11-07) ---
// Owner actions (reading your records, granting/revoking access, notifications,
// key recovery, restore) need a session token from POST /dwn/session, which
// the DWN only issues for a verified wallet login proof. The token is kept in
// sessionStorage so a page reload in the same tab stays logged in; it is
// never put in localStorage (it would outlive the tab and leak across tabs).

export interface DwnSession {
  token: string;
  patientDID: string;
  expiresAt: string;
}

const SESSION_STORAGE_KEY = 'meditrust-dwn-session';
export const SESSION_EXPIRED_EVENT = 'meditrust-dwn-session-expired';
let currentSession: DwnSession | null = null;

export function getStoredSession(): DwnSession | null {
  if (currentSession) return currentSession;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DwnSession;
    if (!parsed.token || Date.parse(parsed.expiresAt) <= Date.now()) return null;
    currentSession = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function storeSession(session: DwnSession | null) {
  currentSession = session;
  try {
    if (session) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // storage unavailable (private mode etc.) — in-memory session still works
  }
}

function authHeaders(): Record<string, string> {
  const session = getStoredSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

// proofRecordId -> one-time login secret from startLogin(). Kept only in this
// tab's memory: the DWN accepts a login proof only together with the secret
// it gave to the browser that started the login (2026-11-19).
const loginSecrets = new Map<string, string>();

// Wallet login, step 1: the DWN asks the Government agent to send the wallet
// a minimal proof request (revealing only patientAccountId) and returns a
// one-time secret for this browser. Normalized to { id, state } for
// useProofVerification's requestFn.
export async function startLogin(connectionId: string): Promise<{ id: string; state: string }> {
  const response = await fetch(`${DWN_URL}/dwn/login/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Login could not start (${response.status})`);
  loginSecrets.set(body.proofRecordId, body.loginSecret);
  return { id: body.proofRecordId, state: body.state };
}

export async function createSession(proofRecordId: string): Promise<DwnSession> {
  const response = await fetch(`${DWN_URL}/dwn/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofRecordId, loginSecret: loginSecrets.get(proofRecordId) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Login failed (${response.status})`);
  loginSecrets.delete(proofRecordId);
  storeSession(body as DwnSession);
  return body as DwnSession;
}

// Confirms a stored token is still accepted by the DWN (e.g. after a DWN
// restart, which clears all sessions).
export async function checkSession(): Promise<DwnSession | null> {
  const session = getStoredSession();
  if (!session) return null;
  try {
    const response = await fetch(`${DWN_URL}/dwn/session`, { headers: authHeaders() });
    if (response.ok) return session;
  } catch {
    return session; // DWN unreachable — keep the session, calls will surface the error
  }
  storeSession(null);
  return null;
}

export async function logout(): Promise<void> {
  const headers = authHeaders();
  storeSession(null);
  try {
    await fetch(`${DWN_URL}/dwn/session`, { method: 'DELETE', headers });
  } catch {
    // already logged out locally
  }
}

async function asJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && currentSession) {
    // Session expired or DWN restarted — send the dashboard back to login.
    storeSession(null);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  if (!response.ok) throw new Error(body.error || `Server responded with ${response.status}`);
  return body;
}

export async function queryRecords(patientDID: string): Promise<DWNRecordSummary[]> {
  const response = await fetch(
    `${DWN_URL}/dwn/queryRecord?patientDID=${encodeURIComponent(patientDID)}`,
    { headers: authHeaders() }
  );
  const body = await asJson(response);
  return Array.isArray(body) ? body : [body];
}

export async function shareRecord(input: {
  patientDID: string; grantedToDID: string; recordType: string;
  purpose: string; allowedFields?: string[]; expiresAt?: string | null;
}): Promise<Permission> {
  // Generated fresh per call — the DWN rejects a repeat of the same nonce as
  // a replay (dwn/patient-node/src/routes/permission-routes.ts).
  const nonce = crypto.randomUUID();
  const response = await fetch(`${DWN_URL}/dwn/shareRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...input, nonce }),
  });
  return asJson(response);
}

export async function revokeAccess(input: { patientDID: string; grantedToDID: string; recordType: string }) {
  const response = await fetch(`${DWN_URL}/dwn/revokeAccess`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  return asJson(response);
}

export interface SelfCustodyShare {
  shareId: string;
  shareIndex: number;
  holder: 'primary_device' | 'paper_backup' | 'secondary_device' | 'cloud_backup' | 'safe_deposit_box';
  shareData: string;
  // Which account this share belongs to — lets a patient identify the
  // right account from their paper backup alone, without needing to
  // separately remember a UUID. Optional so shares minted before this field
  // existed still parse.
  patientDID?: string;
}

export async function initiateSelfCustody(patientDID: string): Promise<{
  shares: SelfCustodyShare[]; splitTimeMs: number; threshold: number; total: number; isNewPatient: boolean;
}> {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/self-custody/initiate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return asJson(response);
}

export async function restoreSelfCustody(patientDID: string, shares: SelfCustodyShare[]) {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/self-custody/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
    headers: authHeaders(),
  });
  return asJson(response);
}

export async function getSigningKeyStatus(patientDID: string): Promise<{ hasKey: boolean; publicKeyFingerprint: string | null }> {
  const response = await fetch(`${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/signing-key-status`);
  return asJson(response);
}

export interface DwnNotification {
  eventId: string;
  eventType: string;
  message: string;
  actorDid: string;
  timestamp: string;
}

export async function getNotifications(patientDID: string, limit = 20): Promise<DwnNotification[]> {
  const response = await fetch(
    `${DWN_URL}/dwn/patients/${encodeURIComponent(patientDID)}/notifications?limit=${limit}`,
    { headers: authHeaders() }
  );
  const body = await asJson(response);
  return body.notifications as DwnNotification[];
}

export async function checkDwnHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${DWN_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
