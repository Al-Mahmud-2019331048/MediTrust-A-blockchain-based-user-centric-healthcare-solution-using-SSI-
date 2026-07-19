import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";

// Registers healthcare-authority agent routes. This agent sits between
// government (which issues it a HospitalAuthorizationCredential) and doctors
// (to whom it issues a ProfessionalRoleCredential) in the 3-tier chain —
// closes the "no credential-backed proof a doctor is licensed" gap.
// No AuditService.record() call here, matching the confirmed existing
// behavior of government's /issue-credential and doctor's
// /issue-medical-credential — neither audit-logs today, so this doesn't
// invent a new convention just for this one route.
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
    const { connectionId, role, licenseId, issuedAt } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (!role || !licenseId) {
      return res.status(400).json({ error: "role and licenseId are required" });
    }

    const attributesData = {
      role,
      licenseId,
      issuedAt: issuedAt || new Date().toISOString(),
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
