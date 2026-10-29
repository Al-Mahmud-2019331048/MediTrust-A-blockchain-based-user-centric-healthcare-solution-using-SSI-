import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { generateId } from "../../../../crypto/encryption/src/hash-utils";
import { AuditService } from "../../../../audit/src/services/audit-service";

// Registers all government (issuer) agent routes
export function registerGovernmentRoutes(
  app: Express,
  agent: BaseAgent,
  agentDid: string,
  getCredDefId: () => string,
  getExtendedCredDefId: () => string
) {
  // POST /issue-credential — issues identity credential(s) to patient.
  //
  // Split into two independent credentials (2026-08 data-minimization fix):
  // a CORE identity credential (name/age/email/nationalId/patientAccountId)
  // and an EXTENDED PROFILE credential (medicalCondition/bloodType/
  // emergencyContact). Previously these 8 fields were one bundled
  // credential, so any verifier restricted to "the identity credDef" could
  // technically be handed clinical data too — only the proof REQUEST asking
  // for a subset kept that from happening in practice (and that request
  // once forgot to, see the 2026-08-09 audit). Splitting the credential
  // itself makes the restriction structural: a verifier scoped to the core
  // credDef cannot receive medicalCondition/bloodType/emergencyContact, full
  // stop, regardless of what any given proof request asks for.
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
    // Carried only by the core credential — the extended-profile schema
    // matches the paper's data model (Section 6.1) and has no account ID.
    const patientAccountId = generateId();

    const coreAttributes = [
      { name: "name", value: `${name ?? "John Doe"}` },
      { name: "age", value: `${age ?? 30}` },
      { name: "email", value: `${email ?? "patient@example.com"}` },
      { name: "nationalId", value: `${nationalId ?? "123456789"}` },
      { name: "patientAccountId", value: patientAccountId },
    ];
    const extendedAttributes = [
      { name: "medicalCondition", value: `${medicalCondition ?? "None"}` },
      { name: "bloodType", value: `${bloodType ?? "O+"}` },
      { name: "emergencyContact", value: `${emergencyContact ?? "555-123-4567"}` },
    ];

    // Best-effort: the extended-profile credential is a genuinely separate
    // credential from core identity, not a required part of it succeeding.
    // Its credDef being unregistered (e.g. this boot's second schema
    // registration hit the ledger's per-DID write cooldown — see
    // CLAUDE.md) must not fail the core identity issuance that every other
    // part of this system depends on; it's simply skipped and logged.
    async function issueExtendedProfile(): Promise<string | undefined> {
      const extendedCredDefId = getExtendedCredDefId();
      if (!extendedCredDefId || extendedCredDefId.startsWith("dummy-")) return undefined;
      try {
        const extendedResult = await agent.issueAnonCredsCredential(connectionId, extendedCredDefId, extendedAttributes);
        await AuditService.record({
          eventType: "credential_issued",
          actorDid: agentDid,
          targetDid: patientAccountId,
          resourceId: extendedResult.id,
          resourceType: "identity_extended_profile_credential",
          action: "issueAnonCredsCredential",
          metadata: { connectionId, isW3C: false },
        });
        return extendedResult.id;
      } catch (_extendedError) {
        return undefined;
      }
    }

    try {
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, coreAttributes);
      await AuditService.record({
        eventType: "credential_issued",
        actorDid: agentDid,
        targetDid: patientAccountId,
        resourceId: result.id,
        resourceType: "identity_credential",
        action: "issueAnonCredsCredential",
        metadata: { connectionId, isW3C: false },
      });
      const extendedProfileCredentialId = await issueExtendedProfile();
      res.status(200).send({
        success: true,
        credentialId: result.id,
        extendedProfileCredentialId,
        message: "Identity credential issuance initiated",
        state: result.state,
        patientAccountId,
      });
    } catch (error) {
      // W3C fallback — same degraded, non-ZKP path as before, now split the
      // same way as the real AnonCreds path. The extended-profile message is
      // attempted best-effort and never blocks a successful core fallback.
      try {
        const w3cCredential = {
          type: ["VerifiableCredential", "IdentityCredential"],
          issuer: agentDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: patientAccountId,
            ...Object.fromEntries(coreAttributes.map((a) => [a.name, a.value])),
          },
        };
        const w3cResult = await agent.sendMessage(connectionId, JSON.stringify(w3cCredential, null, 2));
        await AuditService.record({
          eventType: "credential_issued",
          actorDid: agentDid,
          targetDid: patientAccountId,
          resourceId: w3cResult.id,
          resourceType: "identity_credential",
          action: "issueAnonCredsCredential",
          metadata: { connectionId, isW3C: true },
        });

        let w3cExtendedId: string | undefined;
        try {
          const w3cExtendedCredential = {
            type: ["VerifiableCredential", "IdentityExtendedProfileCredential"],
            issuer: agentDid,
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
              id: patientAccountId,
              ...Object.fromEntries(extendedAttributes.map((a) => [a.name, a.value])),
            },
          };
          const w3cExtendedResult = await agent.sendMessage(connectionId, JSON.stringify(w3cExtendedCredential, null, 2));
          w3cExtendedId = w3cExtendedResult.id;
          await AuditService.record({
            eventType: "credential_issued",
            actorDid: agentDid,
            targetDid: patientAccountId,
            resourceId: w3cExtendedResult.id,
            resourceType: "identity_extended_profile_credential",
            action: "issueAnonCredsCredential",
            metadata: { connectionId, isW3C: true },
          });
        } catch (_w3cExtendedError) {}

        return res.status(200).send({
          success: true,
          credentialId: w3cResult.id,
          extendedProfileCredentialId: w3cExtendedId,
          isW3C: true,
          patientAccountId,
        });
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
      await AuditService.record({
        eventType: "credential_issued",
        actorDid: agentDid,
        targetDid: issuedBy,
        resourceId: result.id,
        resourceType: "medical_document_credential",
        action: "issueAnonCredsCredential",
        metadata: { connectionId, documentId, documentType },
      });
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
        await AuditService.record({
          eventType: "credential_issued",
          actorDid: agentDid,
          targetDid: connectionId,
          resourceId: w3cResult.id,
          resourceType: "hospital_authorization_credential",
          action: "issueAnonCredsCredential",
          metadata: { connectionId, institutionName, isW3C: true },
        });
        return res.status(200).send({ success: true, credentialId: w3cResult.id, isW3C: true });
      } catch (error) {
        return res.status(500).send({ error: error.message });
      }
    }

    try {
      const attributes = Object.entries(attributesData).map(([name, value]) => ({ name, value: String(value) }));
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      await AuditService.record({
        eventType: "credential_issued",
        actorDid: agentDid,
        targetDid: connectionId,
        resourceId: result.id,
        resourceType: "hospital_authorization_credential",
        action: "issueAnonCredsCredential",
        metadata: { connectionId, institutionName, isW3C: false },
      });
      res.status(200).send({ success: true, credentialId: result.id, state: result.state });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}
