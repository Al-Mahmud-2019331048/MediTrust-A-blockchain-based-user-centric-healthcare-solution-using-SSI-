// Fire-and-forget HTTP client for on-chain hash anchoring — the one caller
// this repo's audit callers (DWN, crypto/sss, benchmark) have for reaching a
// government-agent process (the only agent with a real ENDORSER DID and
// ledger-write intent). Deliberately non-throwing and time-boxed: the ledger
// validator pool is confirmed blocked on this network (same block affecting
// 2/8 benchmark experiments and schema/credDef registration), so an anchor
// attempt must never slow down or fail the caller's real work — the SQLite +
// signed-JWT audit trail (AuditService.record()) already succeeds on its own,
// this is a best-effort bonus, not a dependency.
export interface AnchorResult {
  anchorStatus: 'anchored' | 'blocked' | 'not_attempted';
  ledgerTxnSeqNo?: number;
  anchorError?: string;
}

export async function attemptAnchor(hash: string, govAgentBaseUrl?: string): Promise<AnchorResult> {
  const baseUrl = govAgentBaseUrl || process.env.GOVERNMENT_AGENT_BASE_URL;
  if (!baseUrl) {
    return { anchorStatus: 'not_attempted', anchorError: 'GOVERNMENT_AGENT_BASE_URL not configured' };
  }

  try {
    const res = await fetch(`${baseUrl}/anchor-hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { anchorStatus: 'blocked', anchorError: `Anchor endpoint responded ${res.status}` };
    }

    const body = (await res.json()) as { success: boolean; ledgerTxnSeqNo?: number; error?: string };
    if (body.success) {
      return { anchorStatus: 'anchored', ledgerTxnSeqNo: body.ledgerTxnSeqNo };
    }
    return { anchorStatus: 'blocked', anchorError: body.error ?? 'Anchor attempt failed with no error detail' };
  } catch (err: unknown) {
    return { anchorStatus: 'blocked', anchorError: (err as Error).message };
  }
}
