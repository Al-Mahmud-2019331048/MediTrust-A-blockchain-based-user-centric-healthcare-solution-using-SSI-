import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { setGlobalDispatcher, Agent } from 'undici';
import { isReachable, randomHex } from './test-patient-helper';

// Storage-layer scale test: simulated concurrent patients, each a distinct
// crypto.randomUUID() patientDID (existing codebase convention — see
// runDwnStorageOverhead() etc. in run-experiments.ts). Deliberately does
// NOT touch the ledger or any AnonCreds/Askar native binding — see
// anoncreds-concurrency-ceiling.ts for why that pipeline cannot honestly be
// pushed anywhere near this scale. Because every simulated user gets its own
// patientDID, the DWN's real per-patientDID rate limits (storeRecord/
// shareRecord: 30 req/min, keyed per patientDID —
// dwn/patient-node/src/utils/rate-limit.ts) are structurally never hit here,
// however high the level goes.
const DWN_URL = (process.env.PATIENT_DWN_URL || 'http://localhost:5050').replace(/\/$/, '');

// A prior 100-500 (step 100) pass found the real OOM ceiling sits between
// N=100 (100% reliable) and N=300 (0% reliable, every attempt) on this 8GB
// machine — see CLAUDE.md's "Full Regression Test + Live Recovery Drills"
// section. 2026-09-02 user request: cap the default run at 200 (the device
// genuinely heats up beyond that), stepping by 50 — [50, 100, 150, 200] —
// to get finer resolution inside the region that's actually reliable/mixed,
// instead of re-running the already-confirmed 300+ crash. Can still be
// overridden via CLI args for a targeted one-off check, e.g. `npx tsx
// dwn-scale-experiment.ts 250` to probe past 200 if ever needed.
const argLevels = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const LEVELS = argLevels.length ? argLevels : [50, 100, 150, 200];
const REPEATS_PER_LEVEL = 20;

// Kept even though the default LEVELS no longer reach the known 300+
// OOM-crash region (see CLAUDE.md) — a CLI-overridden run can still target
// that range, and N=150/200 alone can be enough to crash a machine that's
// already been running for a while. Without recovery, one crash would
// cascade into every remaining repeat/level reporting a false 100% failure
// rate (the server, not the code under test, being the reason) instead of
// a real per-repeat measurement. ensureDwnUp() restarts it and waits for
// readiness before each repeat so every repeat gets a fair, live server.
const REPO_ROOT = path.resolve(__dirname, '..');
// 2026-09-01 follow-up: CLAUDE.md already documents that doubling the heap
// (2GB default -> 4GB) delayed but did not remove the crash. This re-run
// pushes further — 6GB on an 8GB machine, leaving ~2GB for the OS,
// backup-provider, and this script itself — to see whether 300+ can
// genuinely survive with more headroom, instead of assuming the answer.
// Override via DWN_HEAP_MB if a different value is wanted.
const DWN_HEAP_MB = process.env.DWN_HEAP_MB || '6144';
async function ensureDwnUp(): Promise<void> {
  if (await isReachable(DWN_URL)) return;
  console.log(`  [recovery] DWN unreachable (likely OOM-crashed) — restarting dwn:dev with --max-old-space-size=${DWN_HEAP_MB}...`);
  const proc = spawn('npm', ['run', 'dwn:dev'], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${DWN_HEAP_MB}` },
  });
  proc.unref();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isReachable(DWN_URL)) {
      console.log('  [recovery] DWN back up.');
      // Give LevelDB/backup wiring a moment past the bare /health 200.
      await new Promise((r) => setTimeout(r, 1000));
      return;
    }
  }
  console.warn('  [recovery] DWN did not come back up within 45s — next repeat will likely fail too.');
}

// Sizes the HTTP connection pool for the highest concurrency level under
// test. undici's default per-origin pool is small (browser-like) — left
// alone, Promise.all over 1000 requests would silently serialize behind that
// pool cap, and reporting the resulting latency as "1000-concurrent"
// latency would misrepresent what was actually measured.
setGlobalDispatcher(new Agent({ connections: Math.max(...LEVELS) }));

// One simulated user's fixed workload, per the user's explicit choice:
// write + self-read + share (not just write+read) — exercises the
// permission-grant path too, at the cost of 3x the request volume per user.
async function runOneUser(): Promise<number | undefined> {
  const patientDID = crypto.randomUUID();
  const grantedToDID = `did:bench:scale-${randomHex(4)}`;
  const t0 = performance.now();
  try {
    const storeRes = await fetch(`${DWN_URL}/dwn/storeRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientDID,
        recordType: 'medical',
        protocol: 'ScaleTestProtocol',
        contentType: 'application/json',
        data: { note: 'scale-test-record' },
        nonce: crypto.randomUUID(),
      }),
    });
    if (!storeRes.ok) return undefined;
    const record = await storeRes.json();

    const readRes = await fetch(`${DWN_URL}/dwn/queryRecord?recordId=${record.recordId}&requesterDID=${patientDID}`);
    if (!readRes.ok) return undefined;
    await readRes.json();

    const shareRes = await fetch(`${DWN_URL}/dwn/shareRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientDID,
        grantedToDID,
        recordType: 'medical',
        purpose: 'scale-test',
        allowedFields: ['note'],
        nonce: crypto.randomUUID(),
      }),
    });
    if (!shareRes.ok) return undefined;
    await shareRes.json();

    return performance.now() - t0;
  } catch {
    return undefined;
  }
}

interface RunResult {
  avgMs: number;
  p95Ms: number;
  throughputReqPerSec: number;
  errorRatePct: number;
  failures: number;
}

async function runLevelOnce(level: number): Promise<RunResult> {
  const wallStart = performance.now();
  const outcomes = await Promise.all(Array.from({ length: level }, () => runOneUser()));
  const wallMs = performance.now() - wallStart;

  const successTimes = outcomes.filter((t): t is number => t !== undefined).sort((a, b) => a - b);
  const failures = level - successTimes.length;
  const avgMs = successTimes.length ? successTimes.reduce((a, b) => a + b, 0) / successTimes.length : NaN;
  const p95Ms = successTimes.length ? successTimes[Math.min(successTimes.length - 1, Math.floor(successTimes.length * 0.95))] : NaN;
  // Each successful user makes 3 real HTTP requests (store + read + share).
  const throughput = (successTimes.length * 3) / (wallMs / 1000);
  const errorRatePct = (failures / level) * 100;

  return {
    avgMs: Number((Number.isNaN(avgMs) ? 0 : avgMs).toFixed(1)),
    p95Ms: Number((Number.isNaN(p95Ms) ? 0 : p95Ms).toFixed(1)),
    throughputReqPerSec: Number((Number.isNaN(throughput) ? 0 : throughput).toFixed(1)),
    errorRatePct: Number(errorRatePct.toFixed(2)),
    failures,
  };
}

async function main() {
  await ensureDwnUp();
  if (!(await isReachable(DWN_URL))) {
    console.error(`DWN not reachable at ${DWN_URL} and recovery failed`);
    process.exit(1);
  }

  const levelSummaries: { level: number; avgMs: number; p95Ms: number; throughputReqPerSec: number; errorRatePct: number; runs: RunResult[] }[] = [];

  for (const level of LEVELS) {
    console.log(`\n=== Level ${level} (${REPEATS_PER_LEVEL} runs, averaged) ===`);
    const runs: RunResult[] = [];
    for (let r = 0; r < REPEATS_PER_LEVEL; r++) {
      await ensureDwnUp();
      console.log(`  run ${r + 1}/${REPEATS_PER_LEVEL}...`);
      const run = await runLevelOnce(level);
      console.log(
        `    avg=${run.avgMs}ms p95=${run.p95Ms}ms throughput=${run.throughputReqPerSec}req/s errorRate=${run.errorRatePct}% failures=${run.failures}/${level}`
      );
      runs.push(run);
    }
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    levelSummaries.push({
      level,
      avgMs: Number(mean(runs.map((r) => r.avgMs)).toFixed(1)),
      p95Ms: Number(mean(runs.map((r) => r.p95Ms)).toFixed(1)),
      throughputReqPerSec: Number(mean(runs.map((r) => r.throughputReqPerSec)).toFixed(1)),
      errorRatePct: Number(mean(runs.map((r) => r.errorRatePct)).toFixed(2)),
      runs,
    });
  }

  const resultsDir = path.resolve(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(resultsDir, `dwn-scale-${timestamp}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        levels: levelSummaries,
        repeatsPerLevel: REPEATS_PER_LEVEL,
        workloadPerUser: 'storeRecord (write) + self-read queryRecord + shareRecord (grant one field to a second synthetic DID)',
        note:
          'No ledger, no AnonCreds/Askar native bindings touched — pure DWN HTTP + LevelDB + SQLite audit log. Each simulated user is a distinct patientDID, so per-patientDID rate limits are never triggered regardless of level.',
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(`\nResults written to ${jsonPath}`);
  console.log('\n=== Summary (averaged across 3 runs per level) ===');
  for (const s of levelSummaries) {
    console.log(`N=${s.level}: avg=${s.avgMs}ms p95=${s.p95Ms}ms throughput=${s.throughputReqPerSec}req/s errorRate=${s.errorRatePct}%`);
  }
}

main().catch((err) => {
  console.error('dwn-scale-experiment crashed:', err);
  process.exit(1);
});
