import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { generateId } from "../../../../crypto/encryption/src/hash-utils";

// Registers all government (issuer) agent routes
export function registerGovernmentRoutes(
  app: Express,
  agent: BaseAgent,
  agentDid: string,
  getCredDefId: () => string
) {
  // POST /issue-credential — issues identity credential to patient
  app.post("/issue-credential", async (req: Request, res: Response) => {
    const { connectionId, name, email, age, nationalId, medicalCondition, bloodType, emergencyContact } = req.body;

    if (!connectionId) return res.status(400).send({ error: "connectionId is required" });
    const credDefId = getCredDefId();
    if (!credDefId) return res.status(400).send({ error: "credentialDefinitionId is required" });

    // A stable identifier for this patient, independent of any specific
    // DIDComm connection — Aries "Connections" mints a brand-new pairwise
    // did:peer per connection, so `connectionId`/`theirDid` can't serve as a
    // durable patient identity. Minted once here, embedded as a credential
    // attribute so any verifier (e.g. a doctor requesting a proof later) can
    // learn it cryptographically instead of the patient having to relay a
    // DID by hand. Deliberately a plain opaque UUID, not e.g. nationalId —
    // patientDID ends up as a plaintext LevelDB key prefix and backup
    // folder name in the DWN, so a real PII value shouldn't be reused here.
    const patientAccountId = generateId();

    const attributes = [
      { name: "name", value: `${name ?? "John Doe"}` },
      { name: "age", value: `${age ?? 30}` },
      { name: "email", value: `${email ?? "patient@example.com"}` },
      { name: "nationalId", value: `${nationalId ?? "123456789"}` },
      { name: "medicalCondition", value: `${medicalCondition ?? "None"}` },
      { name: "bloodType", value: `${bloodType ?? "O+"}` },
      { name: "emergencyContact", value: `${emergencyContact ?? "555-123-4567"}` },
      { name: "patientAccountId", value: patientAccountId },
    ];

    try {
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      res.status(200).send({
        success: true,
        credentialId: result.id,
        message: "Identity credential issuance initiated",
        state: result.state,
        patientAccountId,
      });
    } catch (error) {
      // W3C fallback
      try {
        const w3cCredential = {
          type: ["VerifiableCredential", "IdentityCredential"],
          issuer: agentDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: patientAccountId,
            ...Object.fromEntries(attributes.map((a) => [a.name, a.value])),
          },
        };
        const w3cResult = await agent.sendMessage(connectionId, JSON.stringify(w3cCredential, null, 2));
        return res.status(200).send({ success: true, credentialId: w3cResult.id, isW3C: true, patientAccountId });
      } catch (_w3cError) {}
      res.status(500).send({ error: error.message });
    }
  });

  // GET /issued-credentials
  app.get("/issued-credentials", async (req: Request, res: Response) => {
    const { credentialId } = req.query;
    try {
      const result = await agent.getIssuedCredentialRecords(credentialId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // POST /issue-medical-credential — issues medical document metadata credential
  app.post("/issue-medical-credential", async (req: Request, res: Response) => {
    const { connectionId, documentId, documentType, documentHash, documentCid, issuedBy, issuedAt } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    const govCredDefId = process.env.GOVERNMENT_MEDICAL_CRED_DEF_ID;
    if (!govCredDefId) return res.status(400).json({ error: "GOVERNMENT_MEDICAL_CRED_DEF_ID not set" });
    if (!documentId || !documentType || !documentHash || !issuedBy || !issuedAt) {
      return res.status(400).json({ error: "Missing required attributes" });
    }

    try {
      const attributes = [
        { name: "documentId", value: documentId },
        { name: "documentType", value: documentType },
        { name: "documentHash", value: documentHash },
        { name: "documentCid", value: documentCid || "N/A" },
        { name: "issuedBy", value: issuedBy },
        { name: "issuedAt", value: issuedAt },
      ];
      const result = await agent.issueAnonCredsCredential(connectionId, govCredDefId, attributes);
      res.status(200).json({ success: true, credentialExchangeId: result.id, state: result.state });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /create-schema
  app.post("/create-schema", async (req: Request, res: Response) => {
    const { did, name, version, attributes } = req.body;
    try {
      const result = await agent.createSchema(did, { name, version, attrNames: attributes, issuerId: did });
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // GET /schemas
  app.get("/schemas", async (req: Request, res: Response) => {
    const { schemaId } = req.query;
    try {
      const result = await agent.getSchema(schemaId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // POST /credential-definition
  app.post("/credential-definition", async (req: Request, res: Response) => {
    const { did, schemaId, tag } = req.body;
    try {
      const result = await agent.createCredentialDefinition(did, schemaId, tag);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // GET /credential-definitions
  app.get("/credential-definitions", async (req: Request, res: Response) => {
    const { credentialDefinitionId } = req.query;
    try {
      const result = await agent.getCredentialDefinition(credentialDefinitionId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}

// Registers the government agent's hospital-authorization route — kept as a
// separate exported function (not folded into registerGovernmentRoutes)
// so server.ts explicitly wires it and it's easy to find/revert independently
// of the identity-issuance routes above. Part of the 3-tier chain:
// government issues this credential to the healthcare-authority agent, which
// in turn issues doctors a ProfessionalRoleCredential.
export function registerHospitalAuthorizationRoute(
  app: Express,
  agent: BaseAgent,
  agentDid: string,
  getHospitalCredDefId: () => string
) {
  // POST /issue-hospital-authorization — issues hospital authorization
  // credential to the healthcare-authority agent (as holder). Falls back to
  // a plain DIDComm message when the credential definition isn't real yet,
  // same pattern as /issue-credential's W3C fallback.
  app.post("/issue-hospital-authorization", async (req: Request, res: Response) => {
    const { connectionId, institutionName, licenseNumber, authorizedAt } = req.body;

    if (!connectionId) return res.status(400).send({ error: "connectionId is required" });
    if (!institutionName || !licenseNumber) {
      return res.status(400).send({ error: "institutionName and licenseNumber are required" });
    }

    const attributesData = {
      institutionName,
      licenseNumber,
      authorizedAt: authorizedAt || new Date().toISOString(),
    };

    const credDefId = getHospitalCredDefId();
    if (!credDefId || credDefId.startsWith("dummy-")) {
      const w3cCredential = {
        type: ["VerifiableCredential", "HospitalAuthorizationCredential"],
        issuer: agentDid,
        issuanceDate: new Date().toISOString(),
        credentialSubject: { id: connectionId, ...attributesData },
      };
      try {
        const w3cResult = await agent.sendMessage(connectionId, JSON.stringify(w3cCredential, null, 2));
        return res.status(200).send({ success: true, credentialId: w3cResult.id, isW3C: true });
      } catch (error) {
        return res.status(500).send({ error: error.message });
      }
    }

    try {
      const attributes = Object.entries(attributesData).map(([name, value]) => ({ name, value: String(value) }));
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      res.status(200).send({ success: true, credentialId: result.id, state: result.state });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}
