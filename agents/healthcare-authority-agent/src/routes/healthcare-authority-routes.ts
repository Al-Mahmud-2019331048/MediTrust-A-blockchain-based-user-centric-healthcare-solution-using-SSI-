import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { AuditService } from "../../../../audit/src/services/audit-service";

// Registers healthcare-authority agent routes. This agent sits between
// government (which issues it a HospitalAuthorizationCredential) and doctors
// (to whom it issues a ProfessionalRoleCredential) in the 3-tier chain —
// closes the "no credential-backed proof a doctor is licensed" gap.
export function registerHealthcareAuthorityRoutes(
  app: Express,
  agent: BaseAgent,
  agentDid: string,
  getCredDefId: () => string
) {
  // POST /issue-role-credential — issues a ProfessionalRoleCredential to a
  // doctor. Falls back to a plain DIDComm message when the credential
  // definition isn't real yet, same pattern as doctor's
  // /issue-medical-credential fallback.
  app.post("/issue-role-credential", async (req: Request, res: Response) => {
    const { connectionId, role, licenseNumber, specialization, hospitalAffiliation, validityPeriod } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (!role || !licenseNumber) {
      return res.status(400).json({ error: "role and licenseNumber are required" });
    }

    // validityPeriod is an ISO 8601 interval ("start/end"); defaults to one
    // year from issuance when the caller doesn't supply one.
    const validFrom = new Date();
    const validUntil = new Date(validFrom);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    const attributesData = {
      role,
      licenseNumber,
      specialization: specialization || "Not specified",
      hospitalAffiliation: hospitalAffiliation || "Not specified",
      validityPeriod: validityPeriod || `${validFrom.toISOString()}/${validUntil.toISOString()}`,
    };

    const credDefId = getCredDefId();
    if (!credDefId || credDefId.startsWith("dummy-")) {
      const msg = JSON.stringify({
        "@type": "https://didcomm.org/issue-credential/2.0/credential",
        credential: {
          type: ["VerifiableCredential", "ProfessionalRoleCredential"],
          issuer: agentDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: { id: connectionId, ...attributesData },
        },
      }, null, 2);
      try {
        const result = await agent.sendMessage(connectionId, msg);
        await AuditService.record({
          eventType: "credential_issued",
          actorDid: agentDid,
          targetDid: connectionId,
          resourceId: result.id,
          resourceType: "professional_role_credential",
          action: "issueAnonCredsCredential",
          metadata: { connectionId, role, licenseNumber, isW3C: true },
        });
        return res.status(200).json({
          success: true,
          credentialId: result.id,
          credentialType: "StructuredMessage",
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
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
        resourceType: "professional_role_credential",
        action: "issueAnonCredsCredential",
        metadata: { connectionId, role, licenseNumber, isW3C: false },
      });
      res.status(200).json({ success: true, credentialExchangeId: result.id, state: result.state });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /issued-role-credentials
  app.get("/issued-role-credentials", async (req: Request, res: Response) => {
    const { credentialId } = req.query;
    try {
      const result = await agent.getIssuedCredentialRecords(credentialId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}
