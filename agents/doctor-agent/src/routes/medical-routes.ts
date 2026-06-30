import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";

// Registers all doctor agent routes
export function registerDoctorRoutes(
  app: Express,
  agent: BaseAgent,
  agentDid: string,
  getCredDefId: () => string
) {
  // POST /issue-medical-credential — issues medical doc credential to patient
  app.post("/issue-medical-credential", async (req: Request, res: Response) => {
    const { connectionId, documentId, documentType, documentHash, patientName, patientId, diagnosis, prescription, issuedBy, issuedAt } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    const credDefId = getCredDefId();
    if (!credDefId || credDefId.startsWith("dummy-")) {
      return res.status(400).json({ error: "Medical credential definition not available" });
    }
    if (!documentId || !documentType || !issuedBy || !issuedAt) {
      return res.status(400).json({ error: "Missing required attributes" });
    }

    try {
      const attributes = [
        { name: "documentId", value: documentId },
        { name: "documentType", value: documentType },
        { name: "documentHash", value: documentHash || `hash-${Date.now()}` },
        { name: "patientName", value: patientName || "Unknown Patient" },
        { name: "patientId", value: patientId || "Unknown ID" },
        { name: "diagnosis", value: diagnosis || "Not specified" },
        { name: "prescription", value: prescription || "Not specified" },
        { name: "issuedBy", value: issuedBy },
        { name: "issuedAt", value: issuedAt },
      ];
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      res.status(200).json({ success: true, credentialExchangeId: result.id, state: result.state });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /issue-prescription — simplified prescription issuance with message fallback
  app.post("/issue-prescription", async (req: Request, res: Response) => {
    const { connectionId, patientName, patientId, diagnosis, prescription, documentId } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });

    const credDefId = getCredDefId();
    if (!credDefId || credDefId.startsWith("dummy-")) {
      // Fallback: send as structured message
      const msg = JSON.stringify({
        "@type": "https://didcomm.org/issue-credential/2.0/credential",
        credential: {
          type: ["VerifiableCredential", "PrescriptionCredential"],
          issuer: agentDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: connectionId,
            documentId: documentId || `prescription-${Date.now()}`,
            documentType: "prescription",
            patientName: patientName || "Unknown Patient",
            patientId: patientId || "Unknown ID",
            diagnosis: diagnosis || "Not specified",
            prescription: prescription || "Not specified",
            issuedBy: agentDid,
            issuedAt: new Date().toISOString(),
          },
        },
      }, null, 2);
      try {
        const result = await agent.sendMessage(connectionId, msg);
        return res.status(200).json({ success: true, credentialId: result.id, credentialType: "StructuredMessage" });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    try {
      const attributes = [
        { name: "documentId", value: documentId || `prescription-${Date.now()}` },
        { name: "documentType", value: "prescription" },
        { name: "documentHash", value: `hash-${Date.now()}` },
        { name: "patientName", value: patientName || "Unknown Patient" },
        { name: "patientId", value: patientId || "Unknown ID" },
        { name: "diagnosis", value: diagnosis || "Not specified" },
        { name: "prescription", value: prescription || "Not specified" },
        { name: "issuedBy", value: agentDid },
        { name: "issuedAt", value: new Date().toISOString() },
      ];
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      res.status(200).json({ success: true, credentialId: result.id, state: result.state });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /issued-medical-credentials
  app.get("/issued-medical-credentials", async (req: Request, res: Response) => {
    const { credentialId } = req.query;
    try {
      const result = await agent.getIssuedCredentialRecords(credentialId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}
