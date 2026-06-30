import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";

// Registers all pharmacist agent routes
export function registerPharmacyRoutes(
  app: Express,
  agent: BaseAgent,
  getCredDefId: () => string
) {
  // POST /verify-patient-identity — requests identity proof from patient
  app.post("/verify-patient-identity", async (req: Request, res: Response) => {
    const { connectionId } = req.body;
    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });

    const governmentCredDefId = process.env.ISSUER_CRED_DEF_ID || getCredDefId();

    try {
      await agent.sendMessage(connectionId, "Please prepare to share your identity credentials.");

      const result = await agent.sendProofRequest({
        proofRequestlabel: "patient-identity-verification",
        connectionId,
        version: "1.0",
        attributes: {
          identity_info: {
            names: ["nationalId", "name", "medicalCondition", "bloodType"],
            restrictions: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
          },
        },
        predicates: {
          age_check: {
            name: "age",
            p_type: ">=" as const,
            p_value: 18,
            restrictions: governmentCredDefId ? [{ cred_def_id: governmentCredDefId }] : [],
          },
        },
      });

      res.status(200).json({ success: true, proofRecordId: result.id, state: result.state });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /verify-prescription — requests prescription proof from patient
  app.post("/verify-prescription", async (req: Request, res: Response) => {
    const { connectionId } = req.body;
    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });

    const doctorCredDefId = process.env.DOCTOR_MEDICAL_CRED_DEF_ID;

    try {
      await agent.sendMessage(connectionId, "Please prepare to share your prescription credentials.");

      const requestAttributes = doctorCredDefId && !doctorCredDefId.startsWith("dummy-")
        ? {
            prescription_info: {
              names: ["documentId", "documentType", "documentHash", "patientName", "diagnosis", "prescription", "issuedBy", "issuedAt"],
              restrictions: [{ cred_def_id: doctorCredDefId }],
            },
          }
        : {
            prescription_info: {
              names: ["documentId", "documentType", "documentHash", "issuedBy", "issuedAt"],
              restrictions: [],
            },
          };

      const result = await agent.sendProofRequest({
        proofRequestlabel: "prescription-verification",
        connectionId,
        version: "1.0",
        attributes: requestAttributes,
        predicates: {},
      });

      res.status(200).json({ success: true, proofRecordId: result.id, state: result.state });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
