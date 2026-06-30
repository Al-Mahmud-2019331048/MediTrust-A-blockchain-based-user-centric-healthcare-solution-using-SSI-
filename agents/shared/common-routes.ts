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
    const { proofRequestlabel, connectionId, version } = req.body;

    if (!proofRequestlabel) return res.status(400).send({ error: "proofRequestlabel is required" });
    if (!connectionId) return res.status(400).send({ error: "connectionId is required" });

    let requestAttributes: Record<string, any> = {};
    let requestPredicates: Record<string, any> = {};

    if (config.agentType === "--issuer") {
      requestAttributes = {
        name: {
          names: ["nationalId", "medicalCondition", "bloodType"],
          restriction: [{ cred_def_id: config.credentialDefinitionId }],
        },
      };
      requestPredicates = {
        name: {
          name: "age",
          p_type: ">=" as const,
          p_value: 18,
          restriction: [{ cred_def_id: config.credentialDefinitionId }],
        },
      };
    } else if (config.agentType === "--doctor") {
      const governmentCredDefId = process.env.ISSUER_CRED_DEF_ID || config.credentialDefinitionId;
      requestAttributes = {
        identity_info: {
          names: ["nationalId", "name", "medicalCondition", "bloodType"],
          restriction: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
        },
      };
      requestPredicates = {
        age_check: {
          name: "age",
          p_type: ">=" as const,
          p_value: 18,
          restriction: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
        },
      };
    } else if (config.agentType === "--pharmacist") {
      const governmentCredDefId = process.env.GOVERNMENT_MEDICAL_CRED_DEF_ID;
      requestAttributes = {
        name: {
          names: ["documentId", "documentType", "documentHash", "issuedBy", "issuedAt"],
          restriction: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
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
