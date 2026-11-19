import crypto from 'crypto';
import { Request, Response } from 'express';
import { extractRevealedAttributes } from '../../../../agents/shared/proof-parser';
import { isValidPatientDID } from '../utils/validation';

// Patient wallet login + session tokens (added 2026-11-07).
//
// Before this, knowing a patient's account ID was enough to act as that
// patient: read everything, grant/revoke access, split or restore their key.
// Now the patient proves who they are with the Government-issued identity
// credential already in their wallet:
//   1. The dashboard calls POST /dwn/login/start; the DWN asks the Government
//      agent to send the wallet a login proof request
//      (agents/government-agent/src/routes/login-routes.ts) and returns the
//      proofRecordId together with a one-time login secret.
//   2. The patient approves it in their wallet.
//   3. The dashboard POSTs the proofRecordId and the login secret to
//      /dwn/session.
//   4. The DWN fetches the proof result ITSELF from the Government agent at
//      the address in its own config (never from the request), checks it,
//      and issues a random session token bound to the revealed account ID.
// Owner-only routes then require `Authorization: Bearer <token>` for that
// same account (requireOwner below).
//
// The login secret (2026-11-19) binds a login to the browser that started
// it. Proof record IDs are not secret — they pass through the Government
// agent's API — so without it, anyone who saw a fresh login proof's ID could
// redeem it before the patient's own dashboard did and get their session.
//
// Sessions, pending logins and used-proof IDs are kept in memory: a DWN
// restart logs everyone out, which is acceptable for this PoC.

export const LOGIN_PROOF_NAME = 'meditrust-dwn-login'; // keep in sync with login-routes.ts
const PROOF_MAX_AGE_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 10_000;
// A started login has to be completed within this window.
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_LOGINS = 10_000;

interface Session {
  patientDID: string;
  expiresAt: number;
}

interface PendingLogin {
  secretHash: string;
  startedAt: number;
}

const sessions = new Map<string, Session>();
// proofRecordId -> time it was used; kept slightly longer than the proof's
// own freshness window, after which it can't be replayed anyway.
const usedProofs = new Map<string, number>();
// proofRecordId -> hash of the login secret handed to the browser that
// started this login (startLogin below).
const pendingLogins = new Map<string, PendingLogin>();

function pruneExpired(now: number) {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
  for (const [proofId, usedAt] of usedProofs) {
    if (now - usedAt > 2 * PROOF_MAX_AGE_MS) usedProofs.delete(proofId);
  }
  for (const [proofId, pending] of pendingLogins) {
    if (now - pending.startedAt > PENDING_LOGIN_TTL_MS) pendingLogins.delete(proofId);
  }
}

// Only stored as a hash, so a dump of process memory/logs never contains a
// usable token.
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class LoginError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// True when every restriction on the attribute group that revealed
// patientAccountId pins the credential to the Government's own DID — so a
// look-alike credential issued by anyone else can never open a session,
// whichever route on the Government agent happened to send the request.
function requestIsRestrictedToGovernment(request: any, governmentDID: string): boolean {
  const groups = request?.requested_attributes ?? {};
  const group = Object.values<any>(groups).find(
    (g) => g?.name === 'patientAccountId' || (Array.isArray(g?.names) && g.names.includes('patientAccountId'))
  );
  const restrictions: any[] = group?.restrictions ?? [];
  if (restrictions.length === 0) return false;
  return restrictions.every(
    (r) =>
      r?.issuer_id === governmentDID ||
      r?.issuer_did === governmentDID ||
      (typeof r?.cred_def_id === 'string' && r.cred_def_id.startsWith(`${governmentDID}/`))
  );
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Starts a wallet login for the browser that calls it: asks the Government
// agent to send the login proof request over the given connection, and
// returns the proof's ID with a one-time secret that only this caller gets.
// createSessionFromLoginProof() accepts the proof only with that secret.
export async function startLogin(connectionId: unknown): Promise<{ proofRecordId: string; state: string; loginSecret: string }> {
  if (typeof connectionId !== 'string' || !ID_PATTERN.test(connectionId)) {
    throw new LoginError(400, 'connectionId is required');
  }
  const governmentUrl = process.env.GOVERNMENT_AGENT_BASE_URL;
  if (!governmentUrl) {
    throw new LoginError(503, 'Wallet login is not configured (GOVERNMENT_AGENT_BASE_URL unset)');
  }

  let body: any;
  let ok = false;
  try {
    const response = await fetch(`${governmentUrl.replace(/\/$/, '')}/request-login-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId }),
      signal: AbortSignal.timeout(10_000),
    });
    ok = response.ok;
    body = await response.json().catch(() => ({}));
  } catch (err) {
    throw new LoginError(503, `Could not reach the Government agent to start the login: ${(err as Error).message}`);
  }
  if (!ok) {
    throw new LoginError(502, `The Government agent could not send the login request: ${body?.error ?? 'unknown error'}`);
  }
  const proofRecordId = body?.proofRecordId;
  if (typeof proofRecordId !== 'string' || !ID_PATTERN.test(proofRecordId)) {
    throw new LoginError(502, 'The Government agent returned no valid proof record ID');
  }

  const now = Date.now();
  pruneExpired(now);
  if (pendingLogins.size >= MAX_PENDING_LOGINS) {
    const oldest = pendingLogins.keys().next().value;
    if (oldest !== undefined) pendingLogins.delete(oldest);
  }
  const loginSecret = crypto.randomBytes(32).toString('base64url');
  pendingLogins.set(proofRecordId, { secretHash: hashToken(loginSecret), startedAt: now });
  return { proofRecordId, state: typeof body?.state === 'string' ? body.state : 'request-sent', loginSecret };
}

export async function createSessionFromLoginProof(
  proofRecordId: unknown,
  loginSecret: unknown
): Promise<{ token: string; patientDID: string; expiresAt: string }> {
  if (typeof proofRecordId !== 'string' || !ID_PATTERN.test(proofRecordId)) {
    throw new LoginError(400, 'proofRecordId is required');
  }
  const governmentUrl = process.env.GOVERNMENT_AGENT_BASE_URL;
  const governmentDID = process.env.GOVERNMENT_DID;
  if (!governmentUrl || !governmentDID) {
    throw new LoginError(503, 'Wallet login is not configured (GOVERNMENT_AGENT_BASE_URL / GOVERNMENT_DID unset)');
  }

  const now = Date.now();
  pruneExpired(now);
  if (usedProofs.has(proofRecordId)) {
    throw new LoginError(401, 'This login proof has already been used');
  }
  // Checked before contacting the Government agent: only the browser that
  // started this login (startLogin) holds the matching secret.
  const pending = pendingLogins.get(proofRecordId);
  if (!pending || typeof loginSecret !== 'string' || !sameHash(hashToken(loginSecret), pending.secretHash)) {
    throw new LoginError(401, 'This login was not started from this browser — please start the login again');
  }

  let proof: any;
  try {
    const response = await fetch(`${governmentUrl.replace(/\/$/, '')}/proof-data/${encodeURIComponent(proofRecordId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    proof = await response.json();
  } catch (err) {
    throw new LoginError(503, `Could not reach the Government agent to check the login proof: ${(err as Error).message}`);
  }

  if (proof?.isVerified !== true || proof?.state !== 'done') {
    throw new LoginError(401, 'Login proof is not verified');
  }
  const request = proof?.request?.anoncreds ?? proof?.request?.indy;
  if (request?.name !== LOGIN_PROOF_NAME) {
    throw new LoginError(401, 'This proof is not a login proof');
  }
  if (!requestIsRestrictedToGovernment(request, governmentDID)) {
    throw new LoginError(401, 'Login proof was not restricted to the Government-issued identity credential');
  }
  const completedAt = Date.parse(proof?.updatedAt ?? '');
  if (!Number.isFinite(completedAt) || now - completedAt > PROOF_MAX_AGE_MS) {
    throw new LoginError(401, 'Login proof is too old — please log in again');
  }
  const patientDID = extractRevealedAttributes(proof).revealedAttributes.patientAccountId;
  if (!patientDID || !isValidPatientDID(patientDID)) {
    throw new LoginError(401, 'Login proof did not reveal a valid account ID');
  }

  // Re-check right before use: two concurrent requests with the same proof
  // must not both get a session.
  if (usedProofs.has(proofRecordId)) {
    throw new LoginError(401, 'This login proof has already been used');
  }
  usedProofs.set(proofRecordId, now);
  pendingLogins.delete(proofRecordId);
  return issueSession(patientDID, now);
}

function issueSession(patientDID: string, now: number): { token: string; patientDID: string; expiresAt: string } {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(hashToken(token), { patientDID, expiresAt });
  return { token, patientDID, expiresAt: new Date(expiresAt).toISOString() };
}

// TEST-ONLY sessions without a wallet proof (2026-11-08), for the DWN scale
// benchmark, which simulates hundreds of separate patients that have no
// wallets. Only usable when BOTH DWN_ALLOW_TEST_SESSIONS=true is set for the
// DWN process (never in .env by default) AND the caller presents the SSS
// service token — see session-routes.ts. Never enable on a real deployment.
export function testSessionsEnabled(): boolean {
  return process.env.DWN_ALLOW_TEST_SESSIONS === 'true';
}

export function createTestSession(patientDID: string): { token: string; patientDID: string; expiresAt: string } {
  if (!testSessionsEnabled()) throw new LoginError(404, 'Not found');
  if (!isValidPatientDID(patientDID)) throw new LoginError(400, 'patientDID must be a valid UUID');
  const now = Date.now();
  pruneExpired(now);
  return issueSession(patientDID, now);
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

// The patient account this request is logged in as, or null.
export function sessionPatientDID(req: Request): string | null {
  const token = bearerToken(req);
  if (!token) return null;
  const key = hashToken(token);
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  return session.patientDID;
}

export function endSession(req: Request): boolean {
  const token = bearerToken(req);
  return token ? sessions.delete(hashToken(token)) : false;
}

// Guard for owner-only routes. Sends 401 (not logged in / expired) or 403
// (logged in as a different account) and returns false; returns true when
// the caller is logged in as patientDID.
export function requireOwner(req: Request, res: Response, patientDID: string | undefined): boolean {
  const sessionDID = sessionPatientDID(req);
  if (!sessionDID) {
    res.status(401).json({ error: 'Log in with your wallet to do this (missing or expired session)' });
    return false;
  }
  if (!patientDID || sessionDID !== patientDID) {
    res.status(403).json({ error: 'This session belongs to a different account' });
    return false;
  }
  return true;
}
