import { BaseAgent } from '../agents/shared/agent-base';
import { createTestPatientAgent, connectTestPatientTo, pollUntil, isReachable } from './test-patient-helper';

const GOV_URL = `http://localhost:${process.env.GOVERNMENT_API_PORT || '4000'}`;

export interface ExperimentResult {
  name: string;
  metric: string;
  status: 'ok' | 'blocked' | 'degraded';
  value?: number;
  detail: string;
}

async function issueRealCredential(connectionId: string, label: string): Promise<boolean> {
  const issueRes = await fetch(`${GOV_URL}/issue-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId, name: label, nationalId: '999999999' }),
    signal: AbortSignal.timeout(20000),
  });
  const issueBody = await issueRes.json();
  return issueRes.ok && issueBody.success && !issueBody.isW3C;
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
// connectionId returned by connectTestPatientTo() is government-agent's own
// ID for the connection, which never matches the holder's local
// credential-record connectionId. Confirmed by direct inspection (a debug
// script logging real record contents). Since credential issuance in this
// benchmark is always done one connection at a time, sequentially, waiting
// for "one more done record than before" is unambiguous and avoids the
// cross-party ID mismatch entirely.
async function waitForNewCredentialDone(testPatient: BaseAgent, alreadyDoneIds: Set<string>, timeoutMs = 15000): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const records: any[] = await testPatient.getIssuedCredentialRecords();
    const newDone = records.find((r) => r.state === 'done' && !alreadyDoneIds.has(r.id));
    if (newDone) return newDone.id;
    await new Promise((r) => setTimeout(r, 300));
  }
  return undefined;
}

// Sends one proof request (selective-disclosure, no-predicate selective, or
// full-reveal) and returns the round-trip latency plus the real serialized
// presentation size fetched from /proof-data — government-agent/server.ts
// (proof-status/proof-data) and the revealAll/noPredicate options on
// /send-proof-request (agents/shared/common-routes.ts) had to be added for
// this to work at all; none of it existed before this experiment.
async function runProofRoundTrip(
  connectionId: string,
  label: string,
  revealAll: boolean,
  timeoutMs = 20000,
  noPredicate = false
): Promise<{ ms: number; bytes: number } | undefined> {
  const t0 = performance.now();
  const proofRes = await fetch(`${GOV_URL}/send-proof-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofRequestlabel: label, connectionId, revealAll, noPredicate }),
  });
  const proofBody = await proofRes.json();
  if (!proofBody?.id) return undefined;

  const verified = await pollUntil(async () => {
    const statusRes = await fetch(`${GOV_URL}/proof-status/${proofBody.id}`);
    const status = await statusRes.json();
    return status.isVerified ? status : undefined;
  }, timeoutMs, 500);
  if (!verified) return undefined;

  const ms = performance.now() - t0;
  const dataRes = await fetch(`${GOV_URL}/proof-data/${proofBody.id}`);
  const data = await dataRes.json();
  const bytes = Buffer.byteLength(JSON.stringify(data));
  return { ms, bytes };
}

function blockedPair(payloadName: string, latencyName: string, detail: string): ExperimentResult[] {
  return [
    { name: payloadName, metric: '%', status: 'blocked', detail },
    { name: latencyName, metric: 'ms', status: 'blocked', detail },
  ];
}

// Experiment: payload-size reduction and latency cost of AnonCreds selective
// disclosure vs. a full-attribute reveal of the same credential, over the
// same connection — measured two ways:
//   1. Selective (3 attrs + age predicate) vs. full (8 attrs) — this
//      project's actual selective-disclosure mechanism, predicate included.
//   2. Selective (3 attrs, NO predicate) vs. full (8 attrs) — isolates just
//      "fewer attributes revealed" from "a ZK predicate was also involved",
//      since a predicate's own range-proof cost can dominate and invert the
//      first comparison's direction (confirmed: it does, see #1's results).
export async function runSelectiveDisclosurePayloadAndLatency(): Promise<ExperimentResult[]> {
  const payloadName = 'Selective disclosure payload reduction';
  const latencyName = 'Selective disclosure latency cost';
  const payloadNameNoPred = 'Selective disclosure payload reduction (attribute count only, no predicate)';
  const latencyNameNoPred = 'Selective disclosure latency cost (attribute count only, no predicate)';

  if (!(await isReachable(GOV_URL, '/connections'))) {
    const detail = `government-agent not reachable at ${GOV_URL}`;
    return [...blockedPair(payloadName, latencyName, detail), ...blockedPair(payloadNameNoPred, latencyNameNoPred, detail)];
  }

  try {
    const testPatient = await createTestPatientAgent(4021);
    const connection = await connectTestPatientTo(testPatient, GOV_URL, 'SD Payload Benchmark Patient');
    if (!connection) {
      const detail = 'Connection did not complete within 15s';
      return [...blockedPair(payloadName, latencyName, detail), ...blockedPair(payloadNameNoPred, latencyNameNoPred, detail)];
    }

    if (!(await issueRealCredential(connection.connectionId, 'SD Payload Benchmark Patient'))) {
      const detail = 'Credential issuance failed or fell back to the non-AnonCreds W3C path';
      return [...blockedPair(payloadName, latencyName, detail), ...blockedPair(payloadNameNoPred, latencyNameNoPred, detail)];
    }
    if (!(await waitForNewCredentialDone(testPatient, new Set()))) {
      const detail = 'Credential never reached "done" state in the holder wallet within 15s';
      return [...blockedPair(payloadName, latencyName, detail), ...blockedPair(payloadNameNoPred, latencyNameNoPred, detail)];
    }

    const selective = await runProofRoundTrip(connection.connectionId, 'selective-disclosure-benchmark', false);
    const selectiveNoPred = await runProofRoundTrip(connection.connectionId, 'selective-no-predicate-benchmark', false, 20000, true);
    const full = await runProofRoundTrip(connection.connectionId, 'full-reveal-benchmark', true);

    const results: ExperimentResult[] = [];

    if (!selective || !full) {
      results.push(...blockedPair(payloadName, latencyName, 'One or both proof round trips did not verify within 20s'));
    } else {
      const reductionPct = ((full.bytes - selective.bytes) / full.bytes) * 100;
      const latencyDeltaMs = selective.ms - full.ms;
      results.push(
        {
          name: payloadName,
          metric: '%',
          status: 'ok',
          value: Number(reductionPct.toFixed(2)),
          detail: `Selective proof (3 attrs + age predicate): ${selective.bytes} bytes. Full-reveal proof (all 8 attrs): ${full.bytes} bytes. Real AnonCreds presentations fetched via /proof-data.`,
        },
        {
          name: latencyName,
          metric: 'ms',
          status: 'ok',
          value: Number(latencyDeltaMs.toFixed(3)),
          detail: `Selective request→verified: ${selective.ms.toFixed(1)}ms. Full-reveal request→verified: ${full.ms.toFixed(1)}ms. Positive value = selective disclosure cost more.`,
        }
      );
    }

    if (!selectiveNoPred || !full) {
      results.push(...blockedPair(payloadNameNoPred, latencyNameNoPred, 'One or both proof round trips did not verify within 20s'));
    } else {
      const reductionPctNoPred = ((full.bytes - selectiveNoPred.bytes) / full.bytes) * 100;
      const latencyDeltaMsNoPred = selectiveNoPred.ms - full.ms;
      results.push(
        {
          name: payloadNameNoPred,
          metric: '%',
          status: 'ok',
          value: Number(reductionPctNoPred.toFixed(2)),
          detail: `Selective proof, no predicate (3 attrs only): ${selectiveNoPred.bytes} bytes. Full-reveal proof (all 8 attrs): ${full.bytes} bytes. Isolates attribute-count reduction from predicate cost.`,
        },
        {
          name: latencyNameNoPred,
          metric: 'ms',
          status: 'ok',
          value: Number(latencyDeltaMsNoPred.toFixed(3)),
          detail: `Selective (no predicate) request→verified: ${selectiveNoPred.ms.toFixed(1)}ms. Full-reveal request→verified: ${full.ms.toFixed(1)}ms. Positive value = selective disclosure cost more.`,
        }
      );
    }

    return results;
  } catch (err) {
    const detail = `Error: ${(err as Error).message}`;
    return [...blockedPair(payloadName, latencyName, detail), ...blockedPair(payloadNameNoPred, latencyNameNoPred, detail)];
  }
}

// Experiment: how government-agent's real per-request latency scales as
// concurrent credential-proof workflows increase. Setup (connections +
// issuance, each confirmed "done" before use) is sequential and NOT timed;
// only the concurrent request->verified phase at each level is timed, with a
// generous per-request timeout since real AnonCreds crypto is CPU-bound and
// will genuinely serialize somewhat under concurrent load on one process —
// that contention is the real thing being measured, not a bug to hide behind
// a short timeout.
//
// Deliberately small (maxLevel default 3, not 50): government-agent's native
// AnonCreds/Askar bindings crashed twice under the original 50-connection
// design — once mid-setup around connection #46, once around connection #2
// — with no catchable JS exception either time (the process just died). This
// is a real native-library stability limit under bursty/concurrent AnonCreds
// operations, not something fixable from this script. A small stagger delay
// between sequential setup steps reduces the chance of retriggering it.
export async function runConcurrentCredentialWorkflows(maxLevel = 3, proofTimeoutMs = 90000): Promise<ExperimentResult> {
  const name = 'Concurrent credential workflow scalability';
  const metric = 'concurrent workflows';

  if (!(await isReachable(GOV_URL, '/connections'))) {
    return { name, metric, status: 'blocked', detail: `government-agent not reachable at ${GOV_URL}` };
  }

  try {
    const testPatient = await createTestPatientAgent(4022, 20000);
    const connectionIds: string[] = [];
    const doneCredentialIds = new Set<string>();

    for (let i = 0; i < maxLevel; i++) {
      const connection = await connectTestPatientTo(testPatient, GOV_URL, `Concurrency Patient ${i}`);
      if (!connection) continue;
      const issued = await issueRealCredential(connection.connectionId, `Concurrency Patient ${i}`);
      if (!issued) continue;
      const newDoneId = await waitForNewCredentialDone(testPatient, doneCredentialIds);
      if (!newDoneId) continue;
      doneCredentialIds.add(newDoneId);
      connectionIds.push(connection.connectionId);
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (connectionIds.length === 0) {
      return { name, metric, status: 'blocked', detail: 'No connections/credentials could be set up against government-agent' };
    }

    // Previously hardcoded to [2, 3] regardless of maxLevel — a caller
    // passing e.g. maxLevel=10 would set up 10 real connections+credentials
    // but scalability was never actually tested past level 3. Now derives a
    // real ramp from maxLevel itself.
    const levels = [2, 3, 5, 10, 20, 30, 40, 50].filter((l) => l <= connectionIds.length && l <= maxLevel);
    const perLevel: { level: number; avgMs: number; p95Ms: number; failures: number }[] = [];
    let maxSubSecondLevel = 0;
    // Once any level fails to qualify, no LATER (higher) level can restore
    // the ceiling, even if it happens to succeed — the metric describes a
    // monotonic scalability ceiling, so a level 5 pass after a level 3 fail
    // must not be reported as "scales to 5" (found live 2026-07-25: this
    // exact non-monotonic overwrite happened with the old plain assignment).
    let ceilingBroken = false;

    for (const level of levels) {
      const subset = connectionIds.slice(0, level);
      const outcomes = await Promise.all(
        subset.map(async (connectionId, i) => {
          const reqT0 = performance.now();
          try {
            const result = await runProofRoundTrip(connectionId, `concurrency-L${level}-${i}`, false, proofTimeoutMs);
            return result ? performance.now() - reqT0 : undefined;
          } catch {
            return undefined;
          }
        })
      );
      const successTimes = outcomes.filter((t): t is number => t !== undefined).sort((a, b) => a - b);
      const failures = level - successTimes.length;
      const avgMs = successTimes.length ? successTimes.reduce((a, b) => a + b, 0) / successTimes.length : NaN;
      const p95Ms = successTimes.length ? successTimes[Math.min(successTimes.length - 1, Math.floor(successTimes.length * 0.95))] : NaN;
      perLevel.push({ level, avgMs: Number(avgMs.toFixed(1)), p95Ms: Number(p95Ms.toFixed(1)), failures });
      const qualifies = failures === 0 && !Number.isNaN(avgMs) && avgMs < 1000;
      if (qualifies && !ceilingBroken) {
        maxSubSecondLevel = level;
      } else if (!qualifies) {
        ceilingBroken = true;
      }
    }

    const detail = perLevel
      .map((r) => `${r.level}: avg ${Number.isNaN(r.avgMs) ? 'N/A' : r.avgMs + 'ms'}, p95 ${Number.isNaN(r.p95Ms) ? 'N/A' : r.p95Ms + 'ms'}${r.failures ? `, ${r.failures} failed` : ''}`)
      .join(' | ');

    const anySuccess = perLevel.some((r) => r.failures < r.level);
    return {
      name,
      metric,
      status: maxSubSecondLevel > 0 ? 'ok' : anySuccess ? 'degraded' : 'blocked',
      value: maxSubSecondLevel,
      detail: `Highest concurrency level with 0 failures and avg <1000ms: ${maxSubSecondLevel || 'none'}. Set up ${connectionIds.length}/${maxLevel} real connections+credentials. Per-level (real, uncapped latency, ${proofTimeoutMs}ms timeout): ${detail}`,
    };
  } catch (err) {
    return { name, metric, status: 'blocked', detail: `Error: ${(err as Error).message}` };
  }
}
