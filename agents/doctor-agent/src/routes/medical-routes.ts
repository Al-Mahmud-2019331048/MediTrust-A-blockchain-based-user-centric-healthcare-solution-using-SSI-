import { Express, Request, Response } from "express";
import { BaseAgent } from "../../../shared/agent-base";
import { storeRecord, queryRecords, DWNRequestError } from "../../../shared/dwn-client";
import { DWNRecord } from "../../../shared/types";
import { extractRevealedAttributes } from "../../../shared/proof-parser";
import { AuditService } from "../../../../audit/src/services/audit-service";
import { buildDocumentReferenceResource, buildMedicationRequestResource } from "../../../shared/fhir/fhir-mapper";

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

// Independently verifies a claimed identityVerified/patientDID pair against
// this agent's OWN real proof records, rather than trusting the client's
// assertion — previously `identityVerified` and `patientDID` came straight
// from req.body with nothing checking them, so any caller hitting this HTTP
// API directly (bypassing the Doctor Portal's real verification step, e.g.
// doctor/page.tsx's PatientVerificationPanel) could set
// identityVerified: true and patientDID to any patient's account ID.
// Requires the SAME proofRecordId the frontend already has from
// useProofVerification — a request with no proofRecordId, a proofRecordId
// for a different connection, a proof that never reached a real "done"
// state (matches cache-utils.ts's VERIFIED_STATES), or a proof that didn't
// reveal patientAccountId are all treated as unverified, same as the
// existing manual-entry fallback.
async function verifyIdentityProof(
  agent: BaseAgent,
  connectionId: string,
  proofRecordId: unknown
): Promise<{ verified: boolean; verifiedPatientDID?: string }> {
  if (!proofRecordId || typeof proofRecordId !== "string") {
    return { verified: false };
  }
  try {
    const records = await agent.getProofRecords(proofRecordId);
    const record = records?.[0];
    if (!record || record.state !== "done" || record.connectionId !== connectionId) {
      return { verified: false };
    }
    const proofData = await agent.getProofData(proofRecordId);
    const { revealedAttributes } = extractRevealedAttributes(proofData);
    if (!revealedAttributes.patientAccountId) {
      return { verified: false };
    }
    return { verified: true, verifiedPatientDID: revealedAttributes.patientAccountId };
  } catch {
    return { verified: false };
  }
}

// Builds the AnonCreds attribute list for a medical_document_credential from
// the fuller DWN document data. Must list exactly the schema's attrNames
// (doctor-agent/server.ts) — Credo-TS rejects an offer with any extra or
// missing attribute.
function buildMedicalCredentialAttributes(
  documentData: { documentId: string; documentType: string; documentHash: string; diagnosis: string; prescription: string; issuedAt: string },
  issuerDid: string
): { name: string; value: string }[] {
  const { documentId, documentType, documentHash, diagnosis, prescription, issuedAt } = documentData;
  return Object.entries({ documentId, documentType, documentHash, diagnosis, prescription, issuerDid, issuedAt })
    .map(([name, value]) => ({ name, value: String(value) }));
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
    const { connectionId, documentId, documentType, documentHash, patientName, patientId, diagnosis, prescription, issuedBy, issuedAt, attachment, patientDID, proofRecordId } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (!documentId || !documentType || !issuedBy || !issuedAt) {
      return res.status(400).json({ error: "Missing required attributes" });
    }
    if (attachment && !BINARY_ATTACHMENT_CONTENT_TYPES.includes(attachment.contentType)) {
      return res.status(400).json({
        error: `attachment.contentType must be one of: ${BINARY_ATTACHMENT_CONTENT_TYPES.join(", ")}`,
      });
    }

    const { verified: identityVerified, verifiedPatientDID } = await verifyIdentityProof(agent, connectionId, proofRecordId);
    const effectivePatientDID = identityVerified ? verifiedPatientDID : patientDID;

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
      // true only when the server independently confirmed patientDID via a
      // real, verified AnonCreds proof on this connection (see
      // verifyIdentityProof above) — false for a manually-typed fallback ID.
      // Derived server-side, not trusted from the client.
      identityVerified,
    };

    // FHIR-shaped representation of the same data, stored only in the DWN
    // record (never sent as an AnonCreds attribute or in the DIDComm
    // credential message below) — see fhir-mapper.ts for scope/limits.
    const dwnDocumentData = { ...documentData, fhir: buildDocumentReferenceResource(documentData) };

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
        await AuditService.record({
          eventType: "credential_issued",
          actorDid: agentDid,
          targetDid: effectivePatientDID || connectionId,
          resourceId: result.id,
          resourceType: "medical_document_credential",
          action: "issueAnonCredsCredential",
          metadata: { connectionId, documentId, documentType, identityVerified, isW3C: true },
        });
        const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
          agent,
          connectionId,
          agentDid,
          "medical",
          "MedicalRecord",
          dwnDocumentData,
          attachment,
          effectivePatientDID
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
      // The credential carries exactly the medical_document_credential
      // schema's attrNames (the paper's Medical Document, Section 6.1).
      // identityVerified, patientName, patientId and issuedBy stay in the
      // DWN record only; issuerDid is this agent's own DID, set server-side.
      const attributes = buildMedicalCredentialAttributes(documentData, agentDid);
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      await AuditService.record({
        eventType: "credential_issued",
        actorDid: agentDid,
        targetDid: effectivePatientDID || connectionId,
        resourceId: result.id,
        resourceType: "medical_document_credential",
        action: "issueAnonCredsCredential",
        metadata: { connectionId, documentId, documentType, identityVerified, isW3C: false },
      });
      const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
        agent,
        connectionId,
        agentDid,
        "medical",
        "MedicalRecord",
        dwnDocumentData,
        attachment,
        effectivePatientDID
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
    const { connectionId, patientName, patientId, diagnosis, prescription, documentId, attachment, patientDID, proofRecordId } = req.body;

    if (!connectionId) return res.status(400).json({ error: "connectionId is required" });
    if (attachment && !BINARY_ATTACHMENT_CONTENT_TYPES.includes(attachment.contentType)) {
      return res.status(400).json({
        error: `attachment.contentType must be one of: ${BINARY_ATTACHMENT_CONTENT_TYPES.join(", ")}`,
      });
    }

    const { verified: identityVerified, verifiedPatientDID } = await verifyIdentityProof(agent, connectionId, proofRecordId);
    const effectivePatientDID = identityVerified ? verifiedPatientDID : patientDID;

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
        // Derived server-side — see verifyIdentityProof above.
        identityVerified,
      };
      // FHIR-shaped representation, DWN-record-only — see comment on the
      // matching line in /issue-medical-credential above.
      const dwnDocumentData = { ...documentData, fhir: buildMedicationRequestResource(documentData) };
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
        await AuditService.record({
          eventType: "credential_issued",
          actorDid: agentDid,
          targetDid: effectivePatientDID || connectionId,
          resourceId: result.id,
          resourceType: "prescription_credential",
          action: "issueAnonCredsCredential",
          metadata: { connectionId, documentId: documentData.documentId, identityVerified, isW3C: true },
        });
        const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
          agent,
          connectionId,
          agentDid,
          "prescription",
          "Prescription",
          dwnDocumentData,
          attachment,
          effectivePatientDID
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
      // Derived server-side — see verifyIdentityProof above.
      identityVerified,
    };
    // FHIR-shaped representation, DWN-record-only — see comment on the
    // matching line in /issue-medical-credential above.
    const dwnDocumentData = { ...documentData, fhir: buildMedicationRequestResource(documentData) };

    try {
      // See the matching comment in /issue-medical-credential above.
      const attributes = buildMedicalCredentialAttributes(documentData, agentDid);
      const result = await agent.issueAnonCredsCredential(connectionId, credDefId, attributes);
      await AuditService.record({
        eventType: "credential_issued",
        actorDid: agentDid,
        targetDid: effectivePatientDID || connectionId,
        resourceId: result.id,
        resourceType: "prescription_credential",
        action: "issueAnonCredsCredential",
        metadata: { connectionId, documentId: documentData.documentId, identityVerified, isW3C: false },
      });
      const { record, attachmentRecord, dwnWriteError } = await writeIssuedDocumentToDWN(
        agent,
        connectionId,
        agentDid,
        "prescription",
        "Prescription",
        dwnDocumentData,
        attachment,
        effectivePatientDID
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
