import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { queryRecords, DWNRequestError } from "../../../shared/dwn-client";

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
            // patientAccountId is the stable identifier minted at identity
            // issuance (government-agent's credential-routes.ts) — the same
            // attribute doctor-agent's proof request reveals. Needed here so
            // /read-prescription below can query the DWN by the patient's
            // real patientDID instead of an ephemeral connection ID.
            names: ["nationalId", "name", "medicalCondition", "bloodType", "patientAccountId"],
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

  // POST /read-prescription — reads the patient's prescription record(s)
  // directly from their DWN, using PHARMACY_DID as the requester, instead of
  // asking the wallet to present a ZKP proof (the /verify-prescription flow
  // above). This exercises the DWN's own selective-sharing pathway
  // (Permission.allowedFields, optionally capped by a Protocol) rather than
  // the identity-layer ZKP one — the two are independent, both real. Requires
  // the patient to have already granted PHARMACY_DID access to their
  // 'prescription' records via the Patient Portal's Consent Manager; if not,
  // the DWN's own 403 is passed straight through rather than masked as a 500.
  app.post("/read-prescription", async (req: Request, res: Response) => {
    const { patientDID } = req.body;
    if (!patientDID) return res.status(400).json({ error: "patientDID is required" });

    const pharmacyDID = process.env.PHARMACY_DID;
    if (!pharmacyDID) return res.status(500).json({ error: "PHARMACY_DID is not configured" });

    try {
      const records = await queryRecords({ requesterDID: pharmacyDID, patientDID, recordType: "prescription" });
      res.status(200).json({ records });
    } catch (error) {
      if (error instanceof DWNRequestError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(502).json({ error: (error as Error).message });
    }
  });
}
