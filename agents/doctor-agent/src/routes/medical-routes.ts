import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { storeRecord, queryRecords, DWNRequestError } from "../../../shared/dwn-client";
import { DWNRecord } from "../../../shared/types";

const BINARY_ATTACHMENT_CONTENT_TYPES: DWNRecord["contentType"][] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

export interface DocumentAttachment {
  contentType: DWNRecord["contentType"];
  fileName: string;
  // base64-encoded file bytes — validated for real base64 by the DWN's own
  // storeRecord route (record-routes.ts already re-encodes and compares),
  // not duplicated here.
  data: string;
}

// Writes a just-issued document into the patient's own DWN vault, mirroring
// the same data that went into the credential.
//
// patientDID resolution: if `patientDIDOverride` is supplied — the patient's
// stable patientAccountId, learned by verifying a proof against their
// identity credential (see doctor/page.tsx's verification step) — that's
// used directly, so records from different visits/connections consolidate
// under one identity. Otherwise falls back to the OLD placeholder behavior:
// the DIDComm connection's ephemeral `theirDid` (a real did:peer Credo-TS
// mints fresh per connection, not a stable identity), or the bare
// connectionId if theirDid isn't set yet. That fallback path is unchanged
// so existing callers (and e2e/full-flow-test.ts, which hardcodes the same
// derivation) keep working exactly as before.
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
  documentData: Record<string, unknown>,
  attachment?: DocumentAttachment,
  patientDIDOverride?: string
): Promise<{ record?: DWNRecord; attachmentRecord?: DWNRecord; dwnWriteError?: string }> {
  try {
    let patientDID: string;
    if (patientDIDOverride) {
      patientDID = patientDIDOverride;
    } else {
      const connections = await agent.getConnections({ connectionId });
      patientDID = connections[0]?.theirDid || connectionId;
    }

    const record = await storeRecord({
      patientDID,
      recordType,
      protocol,
      contentType: "application/json",
      data: documentData,
      authorDID: agentDid,
    });

    // The attached file is written as its own separate DWN record — same
    // patient/recordType/protocol, binary contentType — rather than folded
    // into the JSON record above, so existing field-redaction/query logic
    // (which assumes JSON content) keeps working unchanged for the metadata
    // record. A write failure here doesn't affect the already-succeeded
    // JSON record, same non-fatal treatment as the outer try/catch.
    let attachmentRecord: DWNRecord | undefined;
    if (attachment) {
      attachmentRecord = await storeRecord({
        patientDID,
        recordType,
        protocol,
        contentType: attachment.contentType,
        fileName: attachment.fileName,
        data: attachment.data,
        authorDID: agentDid,
      });
    }

    return { record, attachmentRecord };
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
    const { connectionId, documentId, documentType, documentHash, patientName, patientId, diagnosis, prescription, issuedBy, issuedAt, attachment, patientDID, identityVerified } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (!documentId || !documentType || !issuedBy || !issuedAt) {
      return res.status(400).json({ error: "Missing required attributes" });
    }
    if (attachment && !BINARY_ATTACHMENT_CONTENT_TYPES.includes(attachment.contentType)) {
      return res.status(400).json({
        error: `attachment.contentType must be one of: ${BINARY_ATTACHMENT_CONTENT_TYPES.join(", ")}`,
      });
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
      // true only when patientDID came from a cryptographically verified
      // proof against the patient's identity credential (Doctor Portal's
      // verification step), false for a manually-typed fallback ID —
      // downstream readers can tell these apart rather than treating every
      // write as equally trustworthy.
      identityVerified: Boolean(identityVerified),
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
        const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
          agent,
          connectionId,
          agentDid,
          "medical",
          "MedicalRecord",
          documentData,
          attachment,
          patientDID
        );
        return res.status(200).json({
          success: true,
          credentialId: result.id,
          credentialType: "StructuredMessage",
          dwnRecordId: record?.recordId,
          dwnAttachmentRecordId: attachmentRecord?.recordId,
          ...(dwnWriteError ? { dwnWriteError } : {}),
        });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    try {
      const attributes = Object.entries(documentData).map(([name, value]) => ({ name, value: String(value) }));
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
        agent,
        connectionId,
        agentDid,
        "medical",
        "MedicalRecord",
        documentData,
        attachment,
        patientDID
      );
      res.status(200).json({
        success: true,
        credentialExchangeId: result.id,
        state: result.state,
        dwnRecordId: record?.recordId,
        dwnAttachmentRecordId: attachmentRecord?.recordId,
        ...(dwnWriteError ? { dwnWriteError } : {}),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /issue-prescription — simplified prescription issuance with message fallback
  app.post("/issue-prescription", async (req: Request, res: Response) => {
    const { connectionId, patientName, patientId, diagnosis, prescription, documentId, attachment, patientDID, identityVerified } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (attachment && !BINARY_ATTACHMENT_CONTENT_TYPES.includes(attachment.contentType)) {
      return res.status(400).json({
        error: `attachment.contentType must be one of: ${BINARY_ATTACHMENT_CONTENT_TYPES.join(", ")}`,
      });
    }

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
        identityVerified: Boolean(identityVerified),
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
        const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
          agent,
          connectionId,
          agentDid,
          "prescription",
          "Prescription",
          documentData,
          attachment,
          patientDID
        );
        return res.status(200).json({
          success: true,
          credentialId: result.id,
          credentialType: "StructuredMessage",
          dwnRecordId: record?.recordId,
          dwnAttachmentRecordId: attachmentRecord?.recordId,
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
      identityVerified: Boolean(identityVerified),
    };

    try {
      const attributes = Object.entries(documentData).map(([name, value]) => ({ name, value: String(value) }));
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
        agent,
        connectionId,
        agentDid,
        "prescription",
        "Prescription",
        documentData,
        attachment,
        patientDID
      );
      res.status(200).json({
        success: true,
        credentialId: result.id,
        state: result.state,
        dwnRecordId: record?.recordId,
        dwnAttachmentRecordId: attachmentRecord?.recordId,
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

  // POST /read-patient-records — reads a patient's records directly from
  // their DWN, using this doctor's own DID as the requester (same
  // DWN-selective-sharing pathway pharmacy-agent's /read-prescription uses).
  // recordType is optional — omitted, the DWN returns every record type this
  // doctor currently holds an active grant for, excluding the rest rather
  // than erroring. Requires the patient to have granted this doctor's DID
  // access via the Patient Portal's Consent Manager first.
  app.post("/read-patient-records", async (req: Request, res: Response) => {
    const { patientDID, recordType } = req.body;
    if (!patientDID) return res.status(400).json({ error: "patientDID is required" });

    try {
      const records = await queryRecords({ requesterDID: agentDid, patientDID, recordType });
      res.status(200).json({ records });
    } catch (error) {
      if (error instanceof DWNRequestError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(502).json({ error: (error as Error).message });
    }
  });
}
