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

export async function createTestPatientAgent(port = 4010): Promise<BaseAgent> {
  const testPatient = new BaseAgent({ port, label: 'Test Patient', publicEndpoint: `http://localhost:${port}` });
  await testPatient.init();
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
