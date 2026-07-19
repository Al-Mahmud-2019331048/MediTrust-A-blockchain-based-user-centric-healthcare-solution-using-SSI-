import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";

// Registers the government agent's on-chain hash-anchoring route — the "one
// designated anchoring authority" for the whole system, since government is
// the agent with a real ENDORSER DID and ledger-write intent. Wallet-less
// processes (DWN, crypto/sss, benchmark) reach this over HTTP via
// audit/src/services/anchor-client.ts, the same pattern
// verifyActorRoleProof() already uses to call out to an agent's HTTP API.
export function registerAnchorRoutes(app: Express, agent: BaseAgent, agentDid: string) {
  // POST /anchor-hash
  // Body: { hash: string }
  // Always 200 with a { success, ledgerTxnSeqNo?, error? } status report —
  // never an HTTP error, even when the underlying ledger write fails. The
  // caller's real work (the SQLite + signed-JWT audit trail) already
  // succeeded before this is ever called; this is a best-effort bonus, and
  // reporting it as a 500 would incorrectly suggest something the caller
  // actually needs failed.
  app.post("/anchor-hash", async (req: Request, res: Response) => {
    const { hash } = req.body;
    if (!hash || typeof hash !== "string") {
      return res.status(400).json({ error: "hash (string) is required" });
    }

    const result = await agent.anchorHash(agentDid, hash);
    res.status(200).json(result);
  });
}
