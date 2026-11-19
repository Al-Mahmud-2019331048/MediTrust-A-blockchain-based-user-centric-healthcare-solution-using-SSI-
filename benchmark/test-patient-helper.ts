import { BaseAgent } from '../agents/shared/agent-base';
import { signRequest } from '../crypto/encryption/src/request-signing';
import fs from 'fs';
import path from 'path';

// Shared by Day 18's benchmark and Day 19's E2E test: spins up a temporary
// automated agent standing in for what Bifold (the real patient mobile
// wallet) would do — connects for real over DIDComm, no mocking. Extracted
// here so both scripts use the same tested logic instead of duplicating it.

export function randomHex(bytes: number): string {
  return require('crypto').randomBytes(bytes).toString('hex');
}

export async function isReachable(url: string, path = '/health', timeoutMs = 3000, headers: Record<string, string> = {}): Promise<boolean> {
  try {
    const res = await fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pollUntil<T>(fn: () => Promise<T | undefined>, timeoutMs: number, intervalMs = 500): Promise<T | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

// Port 4020 is reserved for this temporary agent specifically because it's
// clear of every real service's port (DWN 5050, government 4000/4001,
// doctor 4002/4003, pharmacy 4004/4005, healthcare-authority 4006/4007, sss
// 4008, backup-provider 4010) — a prior collision with backup-provider's
// default port caused BaseAgent.init() to hang indefinitely rather than
// fail, since Credo-TS's HttpInboundTransport never rejects its own promise
// on a port-bind failure. Confirmed live: same symptom reproduces on any
// already-occupied port. The startup timeout below is the actual fix for
// that failure mode — it can't be fixed inside Credo-TS itself, but a
// hung init() can be bounded and surfaced clearly from here.
// Tracks every test-patient agent created via this function, so callers can
// clean them all up in one call at the end of their own main() (see
// shutdownAllTestPatients below) regardless of which internal function
// created them or which error path was hit — each gets a permanently-unique
// Askar wallet persisted to disk (~/.afj/data/wallet/<id>/), and without
// this every benchmark/e2e run left new wallet files behind forever
// (confirmed live 2026-07-25: 73 accumulated, 146MB).
const createdTestPatients: BaseAgent[] = [];

export async function createTestPatientAgent(port = 4020, timeoutMs = 15000): Promise<BaseAgent> {
  const testPatient = new BaseAgent({ port, label: 'Test Patient', publicEndpoint: `http://localhost:${port}` });
  createdTestPatients.push(testPatient);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      `Test-patient agent failed to start within ${timeoutMs}ms on port ${port} — ` +
      `most likely another process is already bound to this port (check with ` +
      `\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`); Credo-TS's HttpInboundTransport ` +
      `hangs rather than erroring on a bind failure, so this timeout is what actually surfaces it.`
    )), timeoutMs)
  );
  await Promise.race([testPatient.init(), timeout]);

  // Stands in for a human tapping "Accept" on a real wallet's proof-request
  // screen — AutoAcceptProof.ContentApproved never auto-responds to a bare
  // verifier-initiated request (see BaseAgent.acceptProofRequest), so
  // without this every proof request sent to this test patient would sit at
  // request-received forever.
  testPatient.registerProofStateListener(async (proofRecord) => {
    if (proofRecord.state === 'request-received') {
      try {
        await testPatient.acceptProofRequest(proofRecord.id);
      } catch (err) {
        console.log(`Test-patient agent failed to auto-accept proof request ${proofRecord.id}: ${(err as Error).message}`);
      }
    }
  });

  return testPatient;
}

export interface TestConnection {
  connectionId: string;
}

// Accepts an invitation from the given agent's HTTP API and waits for the
// connection to actually complete. A single testPatient instance can hold
// multiple simultaneous connections to different agents (normal DIDComm
// behavior) — call this once per agent to connect to.
//
// Scoped to THIS call's own out-of-band invitation (via the shared
// /connections?outOfBandId= filter agents/shared/common-routes.ts already
// supports) rather than scanning the agent's entire connections list by
// state alone. A long-lived agent process accumulates connections across
// every test run against it (benchmark, e2e, ad-hoc adversarial scripts,
// re-runs...) — an unfiltered scan can match an older, unrelated
// already-`completed` connection instead of the one this call just
// established, especially mid-poll while the new connection is still only
// at `response-sent`. Confirmed live: with two connections on the same
// doctor-agent process (one from an earlier adversarial test, one freshly
// established by an e2e run), the old unfiltered scan picked the stale one
// and the subsequent credential-issuance call failed as "undeliverable" to
// a connection nothing was actually waiting on.
export async function connectTestPatientTo(
  testPatient: BaseAgent,
  agentBaseUrl: string,
  label = 'Test Patient',
  timeoutMs = 15000,
  headers: Record<string, string> = {}
): Promise<TestConnection | undefined> {
  const invRes = await fetch(`${agentBaseUrl}/create-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ label, alias: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}` }),
  });
  const invitation = await invRes.json();
  const outOfBandId = invitation.invitation?.id;

  await testPatient.acceptInvitation({ invitationUrl: invitation.invitationUrl, label });

  const connection = await pollUntil(async () => {
    const res = await fetch(`${agentBaseUrl}/connections?outOfBandId=${outOfBandId}`, { headers });
    const conns: any[] = await res.json();
    return conns.find((c) => c.state === 'completed' || c.state === 'response-sent');
  }, timeoutMs);

  return connection ? { connectionId: connection.id } : undefined;
}

// Sending a proof request immediately after /issue-credential returns is a
// race: that HTTP call only reflects the OFFER being sent, not the holder
// having actually stored the credential (offer-received -> request-sent ->
// credential-received -> done all still have to happen over real DIDComm).
// A proof request that arrives before "done" finds zero matching credentials
// and getCredentialsForAnonCredsProofRequest throws "Unable to automatically
// select requested attributes." — confirmed exactly this way in an earlier
// run. Polling the holder's OWN in-process credential record (rather than
// guessing a fixed sleep) removes the race outright.
//
// Deliberately does NOT filter by connectionId: each side of a DIDComm
// connection keeps its own separate local connection record (and thus its
// own local ID) for the same logical pairwise relationship — the
// connectionId returned by connectTestPatientTo() is the other agent's own
// ID for the connection, which never matches the holder's local
// credential-record connectionId. Confirmed by direct inspection (a debug
// script logging real record contents). Since credential issuance in these
// benchmark/e2e scripts is always done one connection at a time,
// sequentially, waiting for "one more done record than before" is
// unambiguous and avoids the cross-party ID mismatch entirely.
//
// Originally lived only in selective-disclosure-experiments.ts, where it was
// applied after the exact same race was diagnosed there — but
// run-experiments.ts's runVcIssuanceAndVerification() has the identical
// issue-then-immediately-prove pattern and never got the same fix, which is
// why "VC verification time" was blocked in every sampled run (2026-08-16).
// Promoted here so both callers share one implementation instead of the bug
// existing in one copy and the fix in the other.
export async function waitForNewCredentialDone(testPatient: BaseAgent, alreadyDoneIds: Set<string>, timeoutMs = 15000): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const records: any[] = await testPatient.getIssuedCredentialRecords();
    const newDone = records.find((r) => r.state === 'done' && !alreadyDoneIds.has(r.id));
    if (newDone) return newDone.id;
    await new Promise((r) => setTimeout(r, 300));
  }
  return undefined;
}

// Call once, near the end of a script's main(), after every experiment/step
// that might have called createTestPatientAgent() has finished (success or
// failure). Shuts down and deletes the wallet for every test-patient created
// via this module so far — see createTestPatientAgent's comment above for
// why this matters. Safe to call even if some agents failed to fully
// initialize (BaseAgent.shutdown() itself tolerates that).
export async function shutdownAllTestPatients(): Promise<void> {
  await Promise.all(createdTestPatients.map((agent) => agent.shutdown()));
  createdTestPatients.length = 0;
}

// /issue-credential requires a completed phone verification (2026-10-30, see
// agents/government-agent/src/identity-verification.ts). This runs that flow
// for one of the registry's test citizens, reading the code from the
// government agent's simulated SMS inbox exactly as the portal's inbox page
// does. Without a nationalId, it rotates across the three benchmark test
// citizens and all their SIMs, so repeated issuance in one run (the
// concurrency experiments) spreads across numbers instead of tripping the
// per-phone/per-NID code rate limits.
const BENCHMARK_TEST_NIDS = ['0000000002', '0000000003', '0000000004'];
let benchmarkSimIndex = 0;

function registeredSims(nationalId: string): string[] {
  const registryPath = path.resolve(__dirname, '../agents/government-agent/src/registry/citizen-registry.json');
  const citizens: { nationalId: string; registeredSims: string[] }[] = JSON.parse(fs.readFileSync(registryPath, 'utf8')).citizens;
  const citizen = citizens.find((c) => c.nationalId === nationalId);
  if (!citizen) throw new Error(`Test citizen ${nationalId} is not in the citizen registry`);
  return citizen.registeredSims;
}

export async function verifyTestCitizen(govUrl: string, connectionId: string, nationalId?: string): Promise<string> {
  let nid = nationalId;
  let phoneNumber: string;
  if (nid) {
    phoneNumber = registeredSims(nid)[0];
  } else {
    const pairs = BENCHMARK_TEST_NIDS.flatMap((n) => registeredSims(n).map((sim) => ({ n, sim })));
    const pair = pairs[benchmarkSimIndex++ % pairs.length];
    nid = pair.n;
    phoneNumber = pair.sim;
  }

  const startRes = await fetch(`${govUrl}/identity-verification/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, nationalId: nid, phoneNumber }),
    signal: AbortSignal.timeout(10000),
  });
  const startBody = await startRes.json();
  if (!startRes.ok) throw new Error(`Identity verification start failed: ${startBody.error}`);

  const inboxRes = await fetch(`${govUrl}/simulated-sms/${phoneNumber}`, { signal: AbortSignal.timeout(10000) });
  const latest: string | undefined = (await inboxRes.json()).messages[0]?.message;
  const code = latest?.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No verification code found in the simulated inbox for ${phoneNumber}`);

  const confirmRes = await fetch(`${govUrl}/identity-verification/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verificationId: startBody.verificationId, code }),
    signal: AbortSignal.timeout(10000),
  });
  const confirmBody = await confirmRes.json();
  if (!confirmRes.ok) throw new Error(`Identity verification confirm failed: ${confirmBody.error}`);

  return startBody.verificationId;
}

// --- DWN caller authentication helpers (2026-11-08) ---

export interface DwnLoginSession {
  token: string;
  patientDID: string;
  expiresAt: string;
  // The login proof this session came from — kept so tests can confirm a
  // proof can't be exchanged for a second session.
  proofRecordId: string;
}

// Logs the test patient in to the DWN the same way the Patient Dashboard
// does: the DWN starts the login (it asks the Government agent to send a
// login proof request over an existing connection and returns a one-time
// login secret), the test wallet answers it (auto-accept is wired in
// createTestPatientAgent), and the proof's ID plus the secret are exchanged
// at the DWN for a session token. The wallet must already hold a Government
// identity credential.
export async function loginTestPatient(govUrl: string, connectionId: string, dwnUrl: string, timeoutMs = 30000): Promise<DwnLoginSession> {
  const requestRes = await fetch(`${dwnUrl}/dwn/login/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId }),
    signal: AbortSignal.timeout(15000),
  });
  const requestBody = await requestRes.json();
  if (!requestRes.ok) throw new Error(`Login could not start: ${requestBody.error}`);

  const verified = await pollUntil(async () => {
    const statusRes = await fetch(`${govUrl}/proof-status/${requestBody.proofRecordId}`);
    const status = await statusRes.json();
    return status.isVerified ? status : undefined;
  }, timeoutMs, 500);
  if (!verified) throw new Error('Login proof did not verify in time');

  const sessionRes = await fetch(`${dwnUrl}/dwn/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofRecordId: requestBody.proofRecordId, loginSecret: requestBody.loginSecret }),
  });
  const session = await sessionRes.json();
  if (!sessionRes.ok) throw new Error(`DWN session failed: ${session.error}`);
  return { ...session, proofRecordId: requestBody.proofRecordId } as DwnLoginSession;
}

export function bearer(session: DwnLoginSession): Record<string, string> {
  return { Authorization: `Bearer ${session.token}` };
}

// Staff access code for calling the doctor or pharmacy agent's API directly
// (2026-11-19, see agents/shared/staff-auth.ts), from .env.
export function staffHeaders(agent: 'doctor' | 'pharmacy'): Record<string, string> {
  const token = agent === 'doctor' ? process.env.DOCTOR_STAFF_TOKEN : process.env.PHARMACY_STAFF_TOKEN;
  return token ? { 'x-staff-token': token } : {};
}

// Signs a DWN request as one of the real, trusted providers (keys from .env),
// exactly as the doctor/pharmacy agents do (agents/shared/dwn-client.ts).
// pathWithQuery must be the exact path + query string sent, e.g.
// `/dwn/queryRecord?recordId=...`.
export function providerHeaders(
  provider: 'doctor' | 'pharmacy',
  method: string,
  pathWithQuery: string,
  body = ''
): Record<string, string> {
  const did = provider === 'doctor' ? process.env.DOCTOR_DID : process.env.PHARMACY_DID;
  const seed = provider === 'doctor' ? process.env.DOCTOR_SEED : process.env.PHARMACY_SEED;
  if (!did || !seed) throw new Error(`${provider.toUpperCase()}_DID/_SEED not set — cannot sign DWN requests`);
  return signRequest(seed, did, method, pathWithQuery, body);
}
