import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";

// Name the DWN checks for when it accepts a login proof
// (dwn/patient-node/src/auth/session.ts) — keep the two in sync.
export const LOGIN_PROOF_NAME = "meditrust-dwn-login";

// POST /request-login-proof — Patient Dashboard wallet login (2026-11-07).
// Body: { connectionId }
//
// Sends the patient's wallet a minimal proof request: reveal ONLY
// patientAccountId, from a credential issued by this Government agent.
//
// Restricted by issuer DID + schema name, deliberately NOT by exact credDef
// ID: this agent registers a fresh credDef on every boot, so a credDef-ID
// restriction would reject every credential issued before the last restart
// and lock patients out of their own dashboard. issuer_id still ties the
// credential to the Government's own ledger DID, so a self-issued look-alike
// credential cannot satisfy it.
export function registerLoginRoutes(app: Express, agent: BaseAgent, agentDid: string) {
  app.post("/request-login-proof", async (req: Request, res: Response) => {
    const { connectionId } = req.body ?? {};
    if (!connectionId || typeof connectionId !== "string") {
      return res.status(400).send({ error: "connectionId is required" });
    }
    if (!agentDid) {
      return res.status(503).send({ error: "Government DID is not configured — cannot send a login proof request" });
    }

    try {
      const result = await agent.sendProofRequest({
        proofRequestlabel: LOGIN_PROOF_NAME,
        connectionId,
        version: "1.0",
        attributes: {
          login: {
            names: ["patientAccountId"],
            restrictions: [{ issuer_id: agentDid, schema_name: "patient_credential" }],
          },
        },
        predicates: {},
      });
      res.status(200).send({ proofRecordId: result.id, state: result.state });
    } catch (error) {
      res.status(500).send({ error: (error as Error).message });
    }
  });
}
