import { Express, Request, Response } from "express";
import { BaseAgent } from "./agent-base";
import { ProofStatusCacheInstance } from "./cache-utils";

export type AgentConfig = {
  agentType: string;
  agentLabel: string;
  agentPublicEndpoint: string;
  credentialDefinitionId: string;
};

export function registerCommonRoutes(
  app: Express,
  agent: BaseAgent,
  config: AgentConfig,
  proofCache: ProofStatusCacheInstance
) {
  // POST /send-proof-request — attributes/predicates differ per agent type
  app.post("/send-proof-request", async (req: Request, res: Response) => {
    const { proofRequestlabel, connectionId, version, revealAll, noPredicate } = req.body;

    if (!proofRequestlabel) return res.status(400).send({ error: "proofRequestlabel is required" });
    if (!connectionId) return res.status(400).send({ error: "connectionId is required" });

    let requestAttributes: Record<string, any> = {};
    let requestPredicates: Record<string, any> = {};

    if (config.agentType === "--issuer" && revealAll) {
      // Full-attribute reveal, no predicate — the "full credential
      // presentation" baseline used by the selective-disclosure benchmark
      // to compare payload size/latency against the normal 3-attribute +
      // age-predicate request below. Never used by the doctor/pharmacy
      // portals — opt-in only, so default proof-request behavior for every
      // existing caller is unchanged.
      requestAttributes = {
        name: {
          names: ["name", "age", "email", "nationalId", "medicalCondition", "bloodType", "emergencyContact", "patientAccountId"],
          restrictions: [{ cred_def_id: config.credentialDefinitionId }],
        },
      };
    } else if (config.agentType === "--issuer") {
      requestAttributes = {
        name: {
          names: ["nationalId", "medicalCondition", "bloodType"],
          restrictions: [{ cred_def_id: config.credentialDefinitionId }],
        },
      };
      // Opt-in only (noPredicate) — isolates "fewer attributes revealed" from
      // "a ZK predicate was also requested" for the selective-disclosure
      // benchmark's clean attribute-count-only comparison. Every existing
      // caller (doctor/pharmacy portals, the original benchmark path) omits
      // this flag and keeps getting the age predicate, unchanged.
      if (!noPredicate) {
        requestPredicates = {
          name: {
            name: "age",
            p_type: ">=" as const,
            p_value: 18,
            restrictions: [{ cred_def_id: config.credentialDefinitionId }],
          },
        };
      }
    } else if (config.agentType === "--doctor") {
      // Deliberately NOT `|| config.credentialDefinitionId` — that's this
      // agent's OWN (doctor's) credDef, not government's. config.credentialDefinitionId
      // is always a real, truthy string once this agent's own registration
      // succeeds, so that fallback made the `? [...] : []` "no restriction"
      // branch below unreachable: whenever ISSUER_CRED_DEF_ID was unset, the
      // restriction silently pointed at the wrong (doctor's own) credDef
      // instead of correctly falling through to no restriction — making the
      // proof request permanently unsatisfiable in a way indistinguishable
      // from a ledger timeout. Confirmed live 2026-07-25.
      const governmentCredDefId = process.env.ISSUER_CRED_DEF_ID;
      requestAttributes = {
        // patientAccountId is the stable identifier minted at identity
        // issuance (government-agent's credential-routes.ts) — revealing it
        // here is what lets the doctor use it as the DWN's patientDID
        // instead of the connection's ephemeral theirDid.
        identity_info: {
          names: ["nationalId", "name", "medicalCondition", "bloodType", "patientAccountId"],
          restrictions: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
        },
      };
      requestPredicates = {
        age_check: {
          name: "age",
          p_type: ">=" as const,
          p_value: 18,
          restrictions: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
        },
      };
    } else if (config.agentType === "--pharmacist") {
      const governmentCredDefId = process.env.GOVERNMENT_MEDICAL_CRED_DEF_ID;
      requestAttributes = {
        name: {
          names: ["documentId", "documentType", "documentHash", "issuedBy", "issuedAt"],
          restrictions: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
        },
      };
    } else if (config.agentType === "--healthcare-authority") {
      // Healthcare-authority verifies a doctor's ProfessionalRoleCredential —
      // structurally identical to how --doctor/--pharmacist above restrict to
      // governmentCredDefId when verifying identity, except restricted to
      // healthcare-authority's OWN credDef, since it's the issuer of this
      // credential (3-tier chain: Government -> Healthcare-Authority -> Doctor).
      const professionalRoleCredDefId = process.env.PROFESSIONAL_ROLE_CRED_DEF_ID || config.credentialDefinitionId;
      requestAttributes = {
        role_info: {
          names: ["role", "licenseId"],
          restrictions: professionalRoleCredDefId ? [{ cred_def_id: professionalRoleCredDefId }] : [],
        },
      };
    }

    try {
      const result = await agent.sendProofRequest({
        proofRequestlabel,
        connectionId,
        version: version || "1.0",
        attributes: requestAttributes,
        predicates: requestPredicates,
      });
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // GET /proof-records
  app.get("/proof-records", async (req: Request, res: Response) => {
    const { proofRecordId } = req.query;
    try {
      const result = await agent.getProofRecords(proofRecordId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // GET /wallet-dids
  app.get("/wallet-dids", async (req: Request, res: Response) => {
    const { method } = req.query;
    try {
      const result = await agent.getWalletDids(method as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // POST /create-invitation
  app.post("/create-invitation", async (req: Request, res: Response) => {
    const { label, alias, domain } = req.body;
    const agentDomain =
      config.agentType === "--issuer"
        ? process.env.ISSUER_AGENT_PUBLIC_ENDPOINT
        : config.agentType === "--doctor"
        ? process.env.DOCTOR_AGENT_PUBLIC_ENDPOINT
        : config.agentType === "--healthcare-authority"
        ? process.env.HEALTHCARE_AUTHORITY_AGENT_PUBLIC_ENDPOINT
        : process.env.PHARMACIST_AGENT_PUBLIC_ENDPOINT;

    try {
      const result = await agent.createInvitation({
        label: label || config.agentLabel,
        alias: alias || `${config.agentLabel.toLowerCase()}-connection`,
        domain: domain || agentDomain,
      });
      res.status(200).send({ ...result, qrCodeData: result.invitationUrl });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // POST /accept-invitation — lets an already-running agent accept ANOTHER
  // agent's invitation as holder (previously only patients/test-agents could
  // accept invitations via Bifold or a throwaway test-patient agent; nothing
  // let one agent accept another's invitation over HTTP). Needed for the
  // 3-tier chain: healthcare-authority accepts government's invitation, and
  // doctor accepts healthcare-authority's invitation. Agent-agnostic by
  // construction — calls the existing BaseAgent.acceptInvitation() method,
  // no agentType branching needed here, same as registerVerifierRoutes/
  // registerDebugRoutes.
  app.post("/accept-invitation", async (req: Request, res: Response) => {
    const { invitationUrl, label, alias } = req.body;
    if (!invitationUrl) return res.status(400).send({ error: "invitationUrl is required" });

    try {
      const result = await agent.acceptInvitation({ invitationUrl, label, alias });
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // GET /connections
  app.get("/connections", async (req: Request, res: Response) => {
    const { connectionId, outOfBandId } = req.query;
    try {
      const result = await agent.getConnections({
        connectionId: connectionId as string,
        outOfBandId: outOfBandId as string,
      });
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // POST /send-message
  app.post("/send-message", async (req: Request, res: Response) => {
    const { connectionId, message } = req.body;
    if (!connectionId) return res.status(400).send({ error: "connectionId is required" });
    if (!message) return res.status(400).send({ error: "message is required" });
    try {
      const result = await agent.sendMessage(connectionId, message);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // POST /clear-proof-cache
  app.post("/clear-proof-cache", async (_req: Request, res: Response) => {
    const count = proofCache.clear();
    res.status(200).send({ message: `Cleared ${count} entries` });
  });
}
