import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { splitMEK } from '../crypto/sss/src/key-splitter';
import { reconstructKey } from '../crypto/sss/src/key-reconstructor';
import { AuditService } from '../audit/src/services/audit-service';
import { createTestPatientAgent, connectTestPatientTo, pollUntil, isReachable, randomHex, shutdownAllTestPatients, waitForNewCredentialDone, verifyTestCitizen, loginTestPatient, bearer, providerHeaders, DwnLoginSession } from './test-patient-helper';
import { runSelectiveDisclosurePayloadAndLatency, runConcurrentCredentialWorkflows } from './selective-disclosure-experiments';

const DWN_URL = (process.env.PATIENT_DWN_URL || 'http://localhost:5050').replace(/\/$/, '');
const SSS_URL = `http://localhost:${process.env.SSS_PORT || '4008'}`;
const GOV_URL = `http://localhost:${process.env.GOVERNMENT_API_PORT || '4000'}`;

interface ExperimentResult {
  name: string;
  metric: string;
  status: 'ok' | 'blocked' | 'degraded';
  value?: number;
  detail: string;
}

interface AttackResult {
  name: string;
  passed: boolean;
  detail: string;
}

const experiments: ExperimentResult[] = [];
const attacks: AttackResult[] = [];

// ============================================================
// DWN caller authentication (2026-11-08)
// ============================================================
// The DWN now checks who is calling: doctor/pharmacy requests must be
// signed with their ledger keys, and the patient's own actions need a
// wallet-login session. The DWN experiments below therefore (a) sign every
// write as the doctor, (b) read as the real doctor/pharmacy providers
// instead of made-up DIDs, and (c) use one real, logged-in benchmark
// patient for grants/revocations. Logging in needs the government agent, so
// those experiments report `blocked` (with the reason) if it isn't up.

const BENCH_PATIENT_NID = '0000000004';
let benchSession: DwnLoginSession | undefined;
let benchSessionError = 'benchmark patient login not attempted';

async function setupBenchmarkPatient(): Promise<void> {
  if (!(await isReachable(GOV_URL, '/connections'))) {
    benchSessionError = `government-agent not reachable at ${GOV_URL} — needed to log the benchmark patient in`;
    return;
  }
  try {
    const wallet = await createTestPatientAgent(4026);
    const connection = await connectTestPatientTo(wallet, GOV_URL, 'Benchmark DWN Patient');
    if (!connection) throw new Error('connection to government-agent did not complete');
    const verificationId = await verifyTestCitizen(GOV_URL, connection.connectionId, BENCH_PATIENT_NID);
    const done = new Set<string>(((await wallet.getIssuedCredentialRecords()) as any[]).filter((r) => r.state === 'done').map((r) => r.id));
    const issueRes = await fetch(`${GOV_URL}/issue-credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: connection.connectionId, verificationId }),
      signal: AbortSignal.timeout(20000),
    });
    const issueBody = await issueRes.json();
    if (!issueRes.ok || issueBody.isW3C) throw new Error(`identity credential not issued as AnonCreds: ${JSON.stringify(issueBody).slice(0, 150)}`);
    if (!(await waitForNewCredentialDone(wallet, done, 20000))) throw new Error('identity credential never reached done');
    benchSession = await loginTestPatient(GOV_URL, connection.connectionId, DWN_URL);
  } catch (err) {
    benchSessionError = `benchmark patient login failed: ${(err as Error).message}`;
  }
}

async function signedStore(patientDID: string, recordType: string, data: unknown): Promise<Response> {
  const body = JSON.stringify({ patientDID, recordType, protocol: 'MedicalRecord', contentType: 'application/json', data, nonce: crypto.randomUUID() });
  return fetch(`${DWN_URL}/dwn/storeRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...providerHeaders('doctor', 'POST', '/dwn/storeRecord', body) },
    body,
  });
}

function signedRead(provider: 'doctor' | 'pharmacy', recordId: string): Promise<Response> {
  const readPath = `/dwn/queryRecord?recordId=${recordId}`;
  return fetch(`${DWN_URL}${readPath}`, { headers: providerHeaders(provider, 'GET', readPath) });
}

async function patientGrant(session: DwnLoginSession, grantedToDID: string, recordType: string, purpose: string, allowedFields: string[]) {
  const res = await fetch(`${DWN_URL}/dwn/shareRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(session) },
    body: JSON.stringify({ patientDID: session.patientDID, grantedToDID, recordType, purpose, allowedFields, nonce: crypto.randomUUID() }),
  });
  return res.json();
}

function patientRevoke(session: DwnLoginSession, permissionId: string): Promise<Response> {
  return fetch(`${DWN_URL}/dwn/revokeAccess`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...bearer(session) },
    body: JSON.stringify({ permissionId }),
  });
}

// ============================================================
// DWN-backed experiments (fully real today, no ledger needed)
// ============================================================

async function runDwnStorageOverhead(): Promise<void> {
  const name = 'DWN storage overhead';
  if (!(await isReachable(DWN_URL))) {
    experiments.push({ name, metric: 'ratio', status: 'blocked', detail: `DWN not reachable at ${DWN_URL}` });
    return;
  }

  const patientDID = crypto.randomUUID(); // must be a real UUID — DWN routes validate patientDID format (2026-07-25 fix)
  const data = {
    diagnosis: 'Type 2 Diabetes Mellitus, well controlled',
    labResults: 'HbA1c 6.8%, fasting glucose 118 mg/dL',
    prescription: 'Metformin 500mg twice daily',
    notes: 'Patient advised to continue current diet and exercise regimen. Follow-up in 3 months.',
  };

  const res = await signedStore(patientDID, 'medical', data);
  const record = await res.json();

  const plaintextBytes = record.fileSize as number;
  const cipherBytes =
    Buffer.from(record.encryptedData, 'base64').length +
    Buffer.from(record.encryptedKey, 'base64').length +
    Buffer.from(record.iv, 'base64').length +
    Buffer.from(record.tag, 'base64').length;
  const ratio = cipherBytes / plaintextBytes;

  experiments.push({
    name,
    metric: 'ratio (encrypted footprint / plaintext bytes)',
    status: 'ok',
    value: Number(ratio.toFixed(3)),
    detail: `plaintext=${plaintextBytes}B, encrypted footprint=${cipherBytes}B`,
  });
}

async function runSelectiveSharingOverhead(): Promise<void> {
  const name = 'Selective sharing overhead';
  if (!(await isReachable(DWN_URL))) {
    experiments.push({ name, metric: 'ms', status: 'blocked', detail: `DWN not reachable at ${DWN_URL}` });
    return;
  }

  if (!benchSession) {
    experiments.push({ name, metric: 'ms', status: 'blocked', detail: benchSessionError });
    return;
  }
  // Grantees are the real doctor (filtered) and pharmacy (unrestricted)
  // providers, reading with signed requests — made-up grantee DIDs can no
  // longer read at all since 2026-11-08. Both sides pay the same signature
  // check, so the difference still isolates field filtering.
  const filteredGranteeDID = process.env.DOCTOR_DID!;
  const fullGranteeDID = process.env.PHARMACY_DID!;
  const data = { diagnosis: 'flu', labResults: 'normal', prescription: 'rest and fluids', notes: 'private note' };

  const storeRes = await signedStore(benchSession.patientDID, 'medical', data);
  const record = await storeRes.json();

  const filteredGrant = await patientGrant(benchSession, filteredGranteeDID, 'medical', 'treatment', ['diagnosis']);
  // "Full" baseline is now ALSO a grant-based (non-self) read, with an
  // unrestricted grant (allowedFields: [] means unrestricted per
  // ProtocolsInterface.applyFieldFilter), not a self-read. A self-read used
  // to be the baseline, but self-reads compute `accessPolicy` (added
  // 2026-07-25 — see CLAUDE.md Security Audit) while non-self reads don't,
  // which silently added an unrelated LevelDB-scan cost to only one side of
  // the comparison, distorting the measured "filtering overhead". Comparing
  // two grant-based reads isolates the actual field-filtering cost again.
  const fullGrant = await patientGrant(benchSession, fullGranteeDID, 'medical', 'audit', []);

  const iterations = 20;
  const fullTimes: number[] = [];
  const filteredTimes: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await signedRead('pharmacy', record.recordId);
    fullTimes.push(performance.now() - t0);
  }
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await signedRead('doctor', record.recordId);
    filteredTimes.push(performance.now() - t0);
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const avgFull = avg(fullTimes);
  const avgFiltered = avg(filteredTimes);
  const overhead = avgFiltered - avgFull;

  // Clean up so this patient's later experiments start with no grants.
  await patientRevoke(benchSession, filteredGrant.permissionId);
  await patientRevoke(benchSession, fullGrant.permissionId);

  experiments.push({
    name,
    metric: 'ms (filtered read avg − full read avg, both grant-based)',
    status: 'ok',
    value: Number(overhead.toFixed(3)),
    detail: `n=${iterations} each; full grant-based read avg=${avgFull.toFixed(3)}ms, Protocol-filtered read avg=${avgFiltered.toFixed(3)}ms (both non-self, signed provider reads, so both pay the same accessPolicy/signature costs — isolates pure field-filtering overhead)`,
  });
}

async function runAccessRevocationTime(): Promise<void> {
  const name = 'Access revocation time';
  if (!(await isReachable(DWN_URL))) {
    experiments.push({ name, metric: 'seconds', status: 'blocked', detail: `DWN not reachable at ${DWN_URL}` });
    return;
  }

  if (!benchSession) {
    experiments.push({ name, metric: 'seconds', status: 'blocked', detail: benchSessionError });
    return;
  }
  // lab_report, not medical, so the grant can't be confused with the
  // selective-sharing experiment's grants on the same benchmark patient.
  const storeRes = await signedStore(benchSession.patientDID, 'lab_report', { a: 1 });
  const record = await storeRes.json();

  const permission = await patientGrant(benchSession, process.env.PHARMACY_DID!, 'lab_report', 'treatment', []);

  const beforeRevoke = await signedRead('pharmacy', record.recordId);
  if (beforeRevoke.status !== 200) {
    experiments.push({ name, metric: 'seconds', status: 'degraded', detail: 'Pre-revocation read unexpectedly denied — setup issue, not a timing result' });
    return;
  }

  const t0 = performance.now();
  await patientRevoke(benchSession, permission.permissionId);
  const revokeTimeSeconds = (performance.now() - t0) / 1000;

  const afterRevoke = await signedRead('pharmacy', record.recordId);

  experiments.push({
    name,
    metric: 'seconds',
    status: afterRevoke.status === 403 ? 'ok' : 'degraded',
    value: Number(revokeTimeSeconds.toFixed(6)),
    detail: `revokeAccess call latency; subsequent read returned ${afterRevoke.status} (expected 403)`,
  });
}

// ============================================================
// SSS/MPOA-backed experiments (fully real today, no ledger needed)
// ============================================================

async function runSssRecoveryTime(): Promise<void> {
  const name = 'SSS recovery time';
  const mek = require('crypto').randomBytes(32);
  const { shares } = await splitMEK(mek);
  const { reconstructTimeMs } = await reconstructKey(shares.slice(0, 3));
  experiments.push({ name, metric: 'ms', status: 'ok', value: Number(reconstructTimeMs.toFixed(3)), detail: 'reconstructKey() with 3 of 5 shares' });
}

async function runSssSplitTimeBonus(): Promise<void> {
  const name = 'SSS split time (bonus)';
  const mek = require('crypto').randomBytes(32);
  const { splitTimeMs } = await splitMEK(mek);
  experiments.push({ name, metric: 'ms', status: 'ok', value: Number(splitTimeMs.toFixed(3)), detail: 'splitMEK() into 5 shares, threshold 3' });
}

async function runKeyRecoverySuccessRate(): Promise<void> {
  const name = 'Key recovery success rate';
  const trials = 10;
  let validPassed = 0;
  let insufficientCorrectlyFailed = 0;

  for (let i = 0; i < trials; i++) {
    const mek = require('crypto').randomBytes(32);
    const { shares } = await splitMEK(mek);
    const { mek: reconstructed } = await reconstructKey(shares.slice(0, 3));
    if (Buffer.compare(mek, reconstructed) === 0) validPassed++;
  }

  for (let i = 0; i < trials; i++) {
    const mek = require('crypto').randomBytes(32);
    const { shares } = await splitMEK(mek);
    try {
      await reconstructKey(shares.slice(0, 2));
    } catch {
      insufficientCorrectlyFailed++;
    }
  }

  const successRate = ((validPassed + insufficientCorrectlyFailed) / (trials * 2)) * 100;

  experiments.push({
    name,
    metric: '%',
    status: 'ok',
    value: Number(successRate.toFixed(1)),
    detail: `${validPassed}/${trials} valid-threshold reconstructions matched original; ${insufficientCorrectlyFailed}/${trials} insufficient-share attempts correctly threw`,
  });
}

// ============================================================
// Ledger-dependent experiments (real attempt, honest "blocked" fallback)
// ============================================================

async function runBlockchainTransactionLatency(): Promise<void> {
  const name = 'Blockchain transaction latency';
  if (!(await isReachable(GOV_URL, '/connections'))) {
    experiments.push({ name, metric: 'seconds', status: 'blocked', detail: `government-agent not reachable at ${GOV_URL}` });
    return;
  }

  const did = process.env.GOVERNMENT_DID;
  if (!did) {
    experiments.push({ name, metric: 'seconds', status: 'blocked', detail: 'GOVERNMENT_DID not configured' });
    return;
  }

  const t0 = performance.now();
  try {
    const res = await fetch(`${GOV_URL}/create-schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, name: `benchmark_schema_${randomHex(4)}`, version: '1.0.0', attributes: ['field1', 'field2'] }),
      signal: AbortSignal.timeout(20000),
    });
    const elapsedSeconds = (performance.now() - t0) / 1000;
    const body = await res.json();
    if (!res.ok || body?.schemaState?.state !== 'finished') {
      experiments.push({
        name,
        metric: 'seconds',
        status: 'blocked',
        detail: `Schema registration did not finish (likely ledger pool connectivity unavailable): ${JSON.stringify(body).slice(0, 200)}`,
      });
      return;
    }
    experiments.push({ name, metric: 'seconds', status: 'ok', value: Number(elapsedSeconds.toFixed(3)), detail: 'Real schema registration on BCovrin (POST /create-schema)' });
  } catch (err) {
    experiments.push({ name, metric: 'seconds', status: 'blocked', detail: `Ledger pool connectivity unavailable: ${(err as Error).message}` });
  }
}

async function runVcIssuanceAndVerification(): Promise<void> {
  const issuanceName = 'VC issuance time';
  const verificationName = 'VC verification time';

  if (!(await isReachable(GOV_URL, '/connections'))) {
    const detail = `government-agent not reachable at ${GOV_URL}`;
    experiments.push({ name: issuanceName, metric: 'ms', status: 'blocked', detail });
    experiments.push({ name: verificationName, metric: 'ms', status: 'blocked', detail });
    return;
  }

  try {
    const testPatient = await createTestPatientAgent(4020);
    const connection = await connectTestPatientTo(testPatient, GOV_URL, 'Benchmark Test Patient');

    if (!connection) {
      const detail = 'Connection did not complete within 15s (unexpected — DIDComm connections do not need ledger access; investigate separately from the ledger-connectivity limitation)';
      experiments.push({ name: issuanceName, metric: 'ms', status: 'blocked', detail });
      experiments.push({ name: verificationName, metric: 'ms', status: 'blocked', detail });
      return;
    }

    // Phone verification happens before t0 — it's a separate step from
    // issuance, so it stays out of the "VC issuance time" measurement.
    const verificationId = await verifyTestCitizen(GOV_URL, connection.connectionId);
    const t0 = performance.now();
    const issueRes = await fetch(`${GOV_URL}/issue-credential`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: connection.connectionId, verificationId }),
      signal: AbortSignal.timeout(20000),
    });
    const issuanceTimeMs = performance.now() - t0;
    const issueBody = await issueRes.json();

    if (issueBody.isW3C) {
      experiments.push({
        name: issuanceName,
        metric: 'ms',
        status: 'degraded',
        value: Number(issuanceTimeMs.toFixed(3)),
        detail: 'AnonCreds issuance fell back to a plain W3C-shaped DIDComm message (ledger connectivity unavailable) — this timing is the fallback path, NOT a real ZKP-backed VC issuance',
      });
      experiments.push({
        name: verificationName,
        metric: 'ms',
        status: 'blocked',
        detail: 'No real AnonCreds credential was issued to verify against (issuance used the W3C fallback path — see VC issuance time result)',
      });
      return;
    }
    if (!issueRes.ok || !issueBody.success) {
      const detail = `Credential issuance failed: ${JSON.stringify(issueBody).slice(0, 200)}`;
      experiments.push({ name: issuanceName, metric: 'ms', status: 'blocked', detail });
      experiments.push({ name: verificationName, metric: 'ms', status: 'blocked', detail });
      return;
    }

    experiments.push({ name: issuanceName, metric: 'ms', status: 'ok', value: Number(issuanceTimeMs.toFixed(3)), detail: 'Real AnonCreds credential issuance' });

    // Sending the proof request immediately after /issue-credential responds
    // is a race — that HTTP call only reflects the OFFER being sent, not the
    // holder having actually stored the credential yet (offer-received ->
    // request-sent -> credential-received -> done still have to happen over
    // real async DIDComm). This is exactly why "VC verification time" was
    // blocked in every sampled run through 2026-08-16: the proof request
    // reliably beat the credential into the holder's wallet, so
    // selectCredentialsForRequest found nothing and threw, and the holder's
    // proof-state listener never retries. Same race already diagnosed and
    // fixed for the selective-disclosure experiment — see
    // waitForNewCredentialDone() in test-patient-helper.ts.
    if (!(await waitForNewCredentialDone(testPatient, new Set()))) {
      experiments.push({
        name: verificationName,
        metric: 'ms',
        status: 'blocked',
        detail: 'Credential never reached "done" state in the holder wallet within 15s — cannot send a proof request against it',
      });
      return;
    }

    const t1 = performance.now();
    const proofRes = await fetch(`${GOV_URL}/send-proof-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proofRequestlabel: 'benchmark-verification', connectionId: connection.connectionId }),
    });
    const proofBody = await proofRes.json();

    const verified = await pollUntil(async () => {
      const statusRes = await fetch(`${GOV_URL}/proof-status/${proofBody.id}`);
      const status = await statusRes.json();
      return status.isVerified ? status : undefined;
    }, 20000, 500);

    if (!verified) {
      experiments.push({ name: verificationName, metric: 'ms', status: 'blocked', detail: 'Proof verification did not complete within 20s' });
      return;
    }
    const verificationTimeMs = performance.now() - t1;
    experiments.push({ name: verificationName, metric: 'ms', status: 'ok', value: Number(verificationTimeMs.toFixed(3)), detail: 'Real AnonCreds ZKP proof verification' });
  } catch (err) {
    const detail = `Ledger/connection error: ${(err as Error).message}`;
    experiments.push({ name: issuanceName, metric: 'ms', status: 'blocked', detail });
    experiments.push({ name: verificationName, metric: 'ms', status: 'blocked', detail });
  }
}

// ============================================================
// 5 Attack simulation scenarios
// ============================================================

async function attack1_readWithoutGrant(): Promise<void> {
  const name = '1. Read record without a permission grant';
  if (!(await isReachable(DWN_URL))) {
    attacks.push({ name, passed: false, detail: `DWN not reachable at ${DWN_URL}` });
    return;
  }
  const patientDID = crypto.randomUUID(); // must be a real UUID — DWN routes validate patientDID format (2026-07-25 fix)
  const storeRes = await signedStore(patientDID, 'medical', { a: 1 });
  const record = await storeRes.json();
  // A real, signed provider that this patient never granted anything to.
  const res = await signedRead('pharmacy', record.recordId);
  const body = await res.json();
  const passed = res.status === 403 && body.error === 'No active permission grant for this record';
  attacks.push({ name, passed, detail: `status=${res.status}, error="${body.error}"` });
}

async function attack2_sssInsufficientShares(): Promise<void> {
  const name = '2. SSS reconstruction with only 2 shares';
  const mek = require('crypto').randomBytes(32);
  const { shares } = await splitMEK(mek);
  let passed = false;
  let detail = 'did not throw (FAIL)';
  try {
    await reconstructKey(shares.slice(0, 2));
  } catch (err) {
    passed = (err as Error).message.includes('At least 3 shares required');
    detail = (err as Error).message;
  }
  attacks.push({ name, passed, detail });
}

async function attack3_mpoaBeforeThreshold(): Promise<void> {
  const name = '3. MPOA recovery attempt before all 3 approvals';
  if (!(await isReachable(SSS_URL))) {
    attacks.push({ name, passed: false, detail: `SSS service not reachable at ${SSS_URL}` });
    return;
  }
  const initRes = await fetch(`${SSS_URL}/sss/recovery/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientDid: `did:bench:patient-${randomHex(4)}` }),
  });
  const request = await initRes.json();
  const reconstructRes = await fetch(`${SSS_URL}/sss/recovery/${request.requestId}/reconstruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shares: [] }),
  });
  const body = await reconstructRes.json();
  const passed = reconstructRes.status === 403 && String(body.error).includes("'pending'");
  attacks.push({ name, passed, detail: `status=${reconstructRes.status}, error="${body.error}"` });
}

async function attack4_mpoaExpired(): Promise<void> {
  const name = '4. Expired MPOA request reconstruction attempt';
  if (!(await isReachable(SSS_URL))) {
    attacks.push({ name, passed: false, detail: `SSS service not reachable at ${SSS_URL}` });
    return;
  }
  const initRes = await fetch(`${SSS_URL}/sss/recovery/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientDid: `did:bench:patient-${randomHex(4)}`, expiryHours: 1 / 3600000 }), // ~3.6ms
  });
  const request = await initRes.json();
  await new Promise((r) => setTimeout(r, 50));
  const reconstructRes = await fetch(`${SSS_URL}/sss/recovery/${request.requestId}/reconstruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shares: [] }),
  });
  const body = await reconstructRes.json();
  const passed = reconstructRes.status === 403 && String(body.error).includes("'expired'");
  attacks.push({ name, passed, detail: `status=${reconstructRes.status}, error="${body.error}"` });
}

async function attack5_tamperedAuditEntry(): Promise<void> {
  const name = '5. Tampered audit entry verification';
  const event = await AuditService.record({
    eventType: 'document_read',
    actorDid: 'did:bench:actor',
    targetDid: 'did:bench:target',
    resourceId: `bench-resource-${randomHex(4)}`,
    resourceType: 'record',
    action: 'readRecord',
    metadata: {},
  });

  const genuineValid = await AuditService.verify(event);
  const tampered = { ...event, resourceId: `tampered-${randomHex(4)}` };
  const tamperedValid = await AuditService.verify(tampered);

  const passed = genuineValid === true && tamperedValid === false;
  attacks.push({
    name,
    passed,
    detail: `genuine event verify()=${genuineValid} (expected true), tampered resourceId verify()=${tamperedValid} (expected false)`,
  });
}

// ============================================================
// Main
// ============================================================

// --- Caller-authentication attacks (added 2026-11-08) ---

async function attack6_actAsPatientWithAccountIdOnly(): Promise<void> {
  const name = '6. Act as a patient knowing only their account ID';
  if (!benchSession) {
    attacks.push({ name, passed: false, detail: benchSessionError });
    return;
  }
  const victim = benchSession.patientDID;
  const read = await fetch(`${DWN_URL}/dwn/queryRecord?patientDID=${victim}&requesterDID=${victim}`);
  const grant = await fetch(`${DWN_URL}/dwn/shareRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientDID: victim, grantedToDID: process.env.PHARMACY_DID, recordType: 'medical', purpose: 'attack', nonce: crypto.randomUUID() }),
  });
  const split = await fetch(`${DWN_URL}/dwn/patients/${victim}/self-custody/initiate`, { method: 'POST' });
  const passed = read.status === 401 && grant.status === 401 && split.status === 401;
  attacks.push({ name, passed, detail: `read=${read.status}, grant=${grant.status}, key split=${split.status} (all expected 401)` });
}

async function attack7_unsignedRecordWrite(): Promise<void> {
  const name = '7. Write a record without a provider signature';
  if (!(await isReachable(DWN_URL))) {
    attacks.push({ name, passed: false, detail: `DWN not reachable at ${DWN_URL}` });
    return;
  }
  const res = await fetch(`${DWN_URL}/dwn/storeRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientDID: crypto.randomUUID(), recordType: 'medical', protocol: 'MedicalRecord', contentType: 'application/json', data: { forged: true }, authorDID: process.env.DOCTOR_DID, nonce: crypto.randomUUID() }),
  });
  const body = await res.json();
  attacks.push({ name, passed: res.status === 401, detail: `status=${res.status}, error="${body.error}"` });
}

async function attack8_reuseLoginProof(): Promise<void> {
  const name = '8. Reuse a login proof for a second session';
  if (!benchSession) {
    attacks.push({ name, passed: false, detail: benchSessionError });
    return;
  }
  const res = await fetch(`${DWN_URL}/dwn/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofRecordId: benchSession.proofRecordId }),
  });
  const body = await res.json();
  attacks.push({ name, passed: res.status === 401, detail: `status=${res.status}, error="${body.error}"` });
}

async function main() {
  console.log('Running DWN-backed experiments...');
  await setupBenchmarkPatient();
  await runDwnStorageOverhead();
  await runSelectiveSharingOverhead();
  await runAccessRevocationTime();

  console.log('Running SSS/MPOA-backed experiments...');
  await runSssRecoveryTime();
  await runSssSplitTimeBonus();
  await runKeyRecoverySuccessRate();

  console.log('Running ledger-dependent experiments (may report blocked)...');
  await runBlockchainTransactionLatency();
  await runVcIssuanceAndVerification();

  console.log('Running selective-disclosure payload/latency experiment...');
  experiments.push(...(await runSelectiveDisclosurePayloadAndLatency()));

  console.log('Running concurrent credential workflow scalability experiment (this can take several minutes)...');
  experiments.push(await runConcurrentCredentialWorkflows());

  console.log('Running attack simulations...');
  await attack1_readWithoutGrant();
  await attack2_sssInsufficientShares();
  await attack3_mpoaBeforeThreshold();
  await attack4_mpoaExpired();
  await attack5_tamperedAuditEntry();
  await attack6_actAsPatientWithAccountIdOnly();
  await attack7_unsignedRecordWrite();
  await attack8_reuseLoginProof();

  await shutdownAllTestPatients();

  const resultsDir = path.resolve(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const jsonPath = path.join(resultsDir, `results-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ experiments, attacks, generatedAt: new Date().toISOString() }, null, 2));

  const mdLines: string[] = [];
  mdLines.push(`# Benchmark Results — ${new Date().toISOString()}`, '');
  mdLines.push('## Experiments', '');
  mdLines.push('| Experiment | Metric | Status | Value | Detail |');
  mdLines.push('|---|---|---|---|---|');
  for (const e of experiments) {
    mdLines.push(`| ${e.name} | ${e.metric} | ${e.status} | ${e.value ?? '—'} | ${e.detail} |`);
  }
  mdLines.push('', '## Attack Simulations', '');
  mdLines.push('| Scenario | Result | Detail |');
  mdLines.push('|---|---|---|');
  for (const a of attacks) {
    mdLines.push(`| ${a.name} | ${a.passed ? 'PASS' : 'FAIL'} | ${a.detail} |`);
  }
  const mdPath = path.join(resultsDir, `results-${timestamp}.md`);
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`\nResults written to:\n  ${jsonPath}\n  ${mdPath}\n`);
  console.log('=== Experiments ===');
  for (const e of experiments) console.log(`${e.status.toUpperCase().padEnd(8)} ${e.name}: ${e.value ?? 'N/A'} ${e.metric} — ${e.detail}`);
  console.log('\n=== Attack Simulations ===');
  for (const a of attacks) console.log(`${(a.passed ? 'PASS' : 'FAIL').padEnd(4)} ${a.name} — ${a.detail}`);

  const attackFailures = attacks.filter((a) => !a.passed).length;
  process.exit(attackFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Benchmark script crashed:', err);
  process.exit(1);
});
