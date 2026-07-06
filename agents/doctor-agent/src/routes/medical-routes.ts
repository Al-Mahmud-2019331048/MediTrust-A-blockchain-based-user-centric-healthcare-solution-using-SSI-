import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { storeRecord } from "../../../shared/dwn-client";
import { DWNRecord } from "../../../shared/types";

// Writes a just-issued document into the patient's own DWN vault, mirroring
// the same data that went into the credential. patientDID is derived from
// the DIDComm connection's `theirDid` — a real did:peer value Credo-TS
// generates per connection, NOT a stable long-term patient identity DID
// (there is no patient wallet/DID infrastructure yet, same placeholder
// treatment as the DWN's KEK — see CLAUDE.md Known Constraints). Falls back
// to the bare connectionId if theirDid isn't set yet, matching the identical
// `theirDid || connectionId` pattern already used in the legacy
// demo/credo/src/routes/document-routes.ts.
//
// A DWN write failure does NOT throw — the credential/message was already
// issued over DIDComm and can't be un-issued, so callers report this as a
// non-fatal `dwnWriteError` alongside their existing success response rather
// than failing the whole request.
export async function writeIssuedDocumentToDWN(
  agent: BaseAgent,
  connectionId: string,
  agentDid: string,
  recordType: DWNRecord["recordType"],
  protocol: string,
  documentData: Record<string, unknown>
): Promise<{ record?: DWNRecord; dwnWriteError?: string }> {
  try {
    const connections = await agent.getConnections({ connectionId });
    const patientDID = connections[0]?.theirDid || connectionId;

    const record = await storeRecord({
      patientDID,
      recordType,
      protocol,
      contentType: "application/json",
      data: documentData,
      authorDID: agentDid,
    });
    return { record };
  } catch (error) {
    console.warn(`writeIssuedDocumentToDWN: DWN write failed (credential was still issued): ${(error as Error).message}`);
    return { dwnWriteError: (error as Error).message };
  }
}

// Registers all doctor agent routes
export function registerDoctorRoutes(
  app: Express,
  agent: BaseAgent,
  agentDid: string,
  getCredDefId: () => string
) {
  // POST /issue-medical-credential — issues medical doc credential to patient.
  // Falls back to a plain DIDComm message when the credential definition
  // isn't real yet (mirrors /issue-prescription's already-proven pattern —
  // this route used to hard-400 here instead, a leftover from before Days
  // 16-17's fallback+DWN-write pattern existed, not a deliberate difference).
  app.post("/issue-medical-credential", async (req: Request, res: Response) => {
    const { connectionId, documentId, documentType, documentHash, patientName, patientId, diagnosis, prescription, issuedBy, issuedAt } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (!documentId || !documentType || !issuedBy || !issuedAt) {
      return res.status(400).json({ error: "Missing required attributes" });
    }

    const documentData = {
      documentId,
      documentType,
      documentHash: documentHash || `hash-${Date.now()}`,
      patientName: patientName || "Unknown Patient",
      patientId: patientId || "Unknown ID",
      diagnosis: diagnosis || "Not specified",
      prescription: prescription || "Not specified",
      issuedBy,
      issuedAt,
    };

    const credDefId = getCredDefId();
    if (!credDefId || credDefId.startsWith("dummy-")) {
      const msg = JSON.stringify({
        "@type": "https://didcomm.org/issue-credential/2.0/credential",
        credential: {
          type: ["VerifiableCredential", "MedicalDocumentCredential"],
          issuer: agentDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: { id: connectionId, ...documentData },
        },
      }, null, 2);
      try {
        const result = await agent.sendMessage(connectionId, msg);
        const { record, dwnWriteError } = await writeIssuedDocumentToDWN(
          agent,
          connectionId,
          agentDid,
          "medical",
          "MedicalRecord",
          documentData
        );
        return res.status(200).json({
          success: true,
          credentialId: result.id,
          credentialType: "StructuredMessage",
          dwnRecordId: record?.recordId,
          ...(dwnWriteError ? { dwnWriteError } : {}),
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    try {
      const attributes = Object.entries(documentData).map(([name, value]) => ({ name, value: String(value) }));
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      const { record, dwnWriteError } = await writeIssuedDocumentToDWN(
        agent,
        connectionId,
        agentDid,
        "medical",
        "MedicalRecord",
        documentData
      );
      res.status(200).json({
        success: true,
        credentialExchangeId: result.id,
        state: result.state,
        dwnRecordId: record?.recordId,
        ...(dwnWriteError ? { dwnWriteError } : {}),
      });
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
      const documentData = {
        documentId: documentId || `prescription-${Date.now()}`,
        documentType: "prescription",
        patientName: patientName || "Unknown Patient",
        patientId: patientId || "Unknown ID",
        diagnosis: diagnosis || "Not specified",
        prescription: prescription || "Not specified",
        issuedBy: agentDid,
        issuedAt: new Date().toISOString(),
      };
      const msg = JSON.stringify({
        "@type": "https://didcomm.org/issue-credential/2.0/credential",
        credential: {
          type: ["VerifiableCredential", "PrescriptionCredential"],
          issuer: agentDid,
          issuanceDate: documentData.issuedAt,
          credentialSubject: { id: connectionId, ...documentData },
        },
      }, null, 2);
      try {
        const result = await agent.sendMessage(connectionId, msg);
        const { record, dwnWriteError } = await writeIssuedDocumentToDWN(
          agent,
          connectionId,
          agentDid,
          "prescription",
          "Prescription",
          documentData
        );
        return res.status(200).json({
          success: true,
          credentialId: result.id,
          credentialType: "StructuredMessage",
          dwnRecordId: record?.recordId,
          ...(dwnWriteError ? { dwnWriteError } : {}),
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    const documentData = {
      documentId: documentId || `prescription-${Date.now()}`,
      documentType: "prescription",
      documentHash: `hash-${Date.now()}`,
      patientName: patientName || "Unknown Patient",
      patientId: patientId || "Unknown ID",
      diagnosis: diagnosis || "Not specified",
      prescription: prescription || "Not specified",
      issuedBy: agentDid,
      issuedAt: new Date().toISOString(),
    };

    try {
      const attributes = Object.entries(documentData).map(([name, value]) => ({ name, value: String(value) }));
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      const { record, dwnWriteError } = await writeIssuedDocumentToDWN(
        agent,
        connectionId,
        agentDid,
        "prescription",
        "Prescription",
        documentData
      );
      res.status(200).json({
        success: true,
        credentialId: result.id,
        state: result.state,
        dwnRecordId: record?.recordId,
        ...(dwnWriteError ? { dwnWriteError } : {}),
      });
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
