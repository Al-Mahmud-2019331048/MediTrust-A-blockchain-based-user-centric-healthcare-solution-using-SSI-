import fs from 'fs';
import path from 'path';
import { createTestPatientAgent, connectTestPatientTo, isReachable, waitForNewCredentialDone, shutdownAllTestPatients } from './test-patient-helper';
import { issueRealCredential, runProofRoundTrip } from './selective-disclosure-experiments';

// Finds the REAL concurrency ceiling of the AnonCreds credential/ZKP-proof
// pipeline, instead of assuming a target level up front. The existing
// selective-disclosure-experiments.ts's runConcurrentCredentialWorkflows()
// is deliberately capped at maxLevel=3 because government-agent's native
// AnonCreds/Askar bindings have crashed the ENTIRE process twice under
// concurrent load (once at connection #2, once at #46 of a planned 50 — no
// catchable JS exception either time, the process just died). That cap was
// chosen to get *some* real data reliably, not because 3 is the actual
// ceiling — nobody has actually found the real ceiling. This script does:
// starts at level 1, increments by 1, and keeps going for as long as
// government-agent stays reachable and doesn't 100%-fail a level. The moment
// either happens, it stops and reports the last level that actually worked
// as the real, measured ceiling — whatever that number turns out to be.
const GOV_URL = `http://localhost:${process.env.GOVERNMENT_API_PORT || '4000'}`;

// Hard safety bound on the SEQUENTIAL setup phase only (connecting +
// issuing one real credential per simulated patient, one at a time, staggered
// 2s apart — same pattern as the existing concurrency experiment). This is
// not a claim about the concurrency ceiling; it just stops setup from running
// indefinitely if the agent somehow survives an unusually long stretch.
const MAX_SETUP_ATTEMPTS = 25;

interface LevelResult {
  level: number;
  avgMs: number;
  p95Ms: number;
  throughputReqPerSec: number;
  errorRatePct: number;
  failures: number;
}

async function main() {
  if (!(await isReachable(GOV_URL, '/connections'))) {
    console.error(`government-agent not reachable at ${GOV_URL}`);
    process.exit(1);
  }

  const testPatient = await createTestPatientAgent(4023, 20000);
  const connectionIds: string[] = [];
  const doneCredentialIds = new Set<string>();

  console.log(`Setting up up to ${MAX_SETUP_ATTEMPTS} real connections + real AnonCreds credentials (sequential, 2s stagger)...`);
  for (let i = 0; i < MAX_SETUP_ATTEMPTS; i++) {
    try {
      const connection = await connectTestPatientTo(testPatient, GOV_URL, `Ceiling Patient ${i}`);
      if (!connection) {
        console.log(`  #${i}: connection did not complete — stopping setup`);
        break;
      }
      const issued = await issueRealCredential(connection.connectionId, `Ceiling Patient ${i}`);
      if (!issued) {
        console.log(`  #${i}: credential issuance failed or fell back to W3C — stopping setup`);
        break;
      }
      const newDoneId = await waitForNewCredentialDone(testPatient, doneCredentialIds);
      if (!newDoneId) {
        console.log(`  #${i}: credential never reached 'done' in the holder wallet — stopping setup`);
        break;
      }
      doneCredentialIds.add(newDoneId);
      connectionIds.push(connection.connectionId);
      console.log(`  #${i}: OK (${connectionIds.length} ready)`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.log(`  #${i}: threw — ${(err as Error).message} — stopping setup`);
      break;
    }
    if (!(await isReachable(GOV_URL, '/connections'))) {
      console.log(`  government-agent became UNREACHABLE right after setup step #${i} — this is the known crash signature. Stopping setup.`);
      break;
    }
  }

  console.log(`Setup complete: ${connectionIds.length} real connections+credentials ready.\n`);

  if (connectionIds.length === 0) {
    console.error('No connections/credentials could be set up — cannot measure any concurrency level.');
    await shutdownAllTestPatients();
    process.exit(1);
  }

  const results: LevelResult[] = [];
  let stoppedReason = 'reached the top of what was set up';
  let level = 1;

  while (level <= connectionIds.length) {
    if (!(await isReachable(GOV_URL, '/connections'))) {
      stoppedReason = `government-agent unreachable BEFORE level ${level} could even be attempted`;
      console.log(stoppedReason);
      break;
    }

    const subset = connectionIds.slice(0, level);
    console.log(`Level ${level}: firing ${subset.length} concurrent real proof round-trips...`);
    const wallStart = performance.now();
    let outcomes: (number | undefined)[];
    try {
      outcomes = await Promise.all(
        subset.map(async (connectionId, i) => {
          const reqT0 = performance.now();
          try {
            const result = await runProofRoundTrip(connectionId, `ceiling-L${level}-${i}`, false, 90000);
            return result ? performance.now() - reqT0 : undefined;
          } catch {
            return undefined;
          }
        })
      );
    } catch (err) {
      stoppedReason = `level ${level} threw at the Promise.all level (${(err as Error).message}) — treating as a crash`;
      console.log(stoppedReason);
      break;
    }
    const wallMs = performance.now() - wallStart;

    const stillAlive = await isReachable(GOV_URL, '/connections');
    const successTimes = outcomes.filter((t): t is number => t !== undefined).sort((a, b) => a - b);
    const failures = level - successTimes.length;
    const avgMs = successTimes.length ? successTimes.reduce((a, b) => a + b, 0) / successTimes.length : NaN;
    const p95Ms = successTimes.length ? successTimes[Math.min(successTimes.length - 1, Math.floor(successTimes.length * 0.95))] : NaN;
    const throughput = successTimes.length / (wallMs / 1000);
    const errorRatePct = (failures / level) * 100;

    const levelResult: LevelResult = {
      level,
      avgMs: Number((Number.isNaN(avgMs) ? 0 : avgMs).toFixed(1)),
      p95Ms: Number((Number.isNaN(p95Ms) ? 0 : p95Ms).toFixed(1)),
      throughputReqPerSec: Number((Number.isNaN(throughput) ? 0 : throughput).toFixed(3)),
      errorRatePct: Number(errorRatePct.toFixed(1)),
      failures,
    };
    results.push(levelResult);
    console.log(
      `  level ${level}: avg=${levelResult.avgMs}ms p95=${levelResult.p95Ms}ms throughput=${levelResult.throughputReqPerSec}req/s errorRate=${levelResult.errorRatePct}% failures=${failures}/${level} agentAliveAfter=${stillAlive}`
    );

    if (!stillAlive) {
      stoppedReason = `government-agent became UNREACHABLE during/after level ${level} — this IS the real measured crash ceiling`;
      console.log(stoppedReason);
      break;
    }
    if (failures === level) {
      stoppedReason = `level ${level} failed 100% of requests while the agent stayed reachable — real ceiling, not a crash`;
      console.log(stoppedReason);
      break;
    }

    level += 1;
  }

  await shutdownAllTestPatients();

  const resultsDir = path.resolve(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(resultsDir, `anoncreds-ceiling-${timestamp}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        results,
        connectionsSetUp: connectionIds.length,
        stoppedReason,
        note:
          'Levels start at 1 and increment by 1 — no target level was assumed going in. The last row is the real, measured ceiling of this run, not a designed test size.',
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log(`\nResults written to ${jsonPath}`);
  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`Level ${r.level}: avg=${r.avgMs}ms p95=${r.p95Ms}ms throughput=${r.throughputReqPerSec}req/s errorRate=${r.errorRatePct}%`);
  }
  console.log(`\nStopped because: ${stoppedReason}`);
}

main().catch((err) => {
  console.error('anoncreds-concurrency-ceiling crashed:', err);
  process.exit(1);
});
