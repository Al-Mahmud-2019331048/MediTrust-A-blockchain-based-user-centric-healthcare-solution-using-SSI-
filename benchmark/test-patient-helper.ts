import { BaseAgent } from '../agents/shared/agent-base';

// Shared by Day 18's benchmark and Day 19's E2E test: spins up a temporary
// automated agent standing in for what Bifold (the real patient mobile
// wallet) would do — connects for real over DIDComm, no mocking. Extracted
// here so both scripts use the same tested logic instead of duplicating it.

export function randomHex(bytes: number): string {
  return require('crypto').randomBytes(bytes).toString('hex');
}

export async function isReachable(url: string, path = '/health', timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
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
export async function createTestPatientAgent(port = 4020, timeoutMs = 15000): Promise<BaseAgent> {
  const testPatient = new BaseAgent({ port, label: 'Test Patient', publicEndpoint: `http://localhost:${port}` });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      `Test-patient agent failed to start within ${timeoutMs}ms on port ${port} — ` +
      `most likely another process is already bound to this port (check with ` +
      `\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`); Credo-TS's HttpInboundTransport ` +
      `hangs rather than erroring on a bind failure, so this timeout is what actually surfaces it.`
    )), timeoutMs)
  );
  await Promise.race([testPatient.init(), timeout]);
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
  timeoutMs = 15000
): Promise<TestConnection | undefined> {
  const invRes = await fetch(`${agentBaseUrl}/create-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, alias: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}` }),
  });
  const invitation = await invRes.json();
  const outOfBandId = invitation.invitation?.id;

  await testPatient.acceptInvitation({ invitationUrl: invitation.invitationUrl, label });

  const connection = await pollUntil(async () => {
    const res = await fetch(`${agentBaseUrl}/connections?outOfBandId=${outOfBandId}`);
    const conns: any[] = await res.json();
    return conns.find((c) => c.state === 'completed' || c.state === 'response-sent');
  }, timeoutMs);

  return connection ? { connectionId: connection.id } : undefined;
}
