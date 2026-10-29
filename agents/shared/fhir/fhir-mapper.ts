// Pure mappers from this project's own ad hoc document-data shape into
// structurally valid HL7 FHIR R4 resource instances (DocumentReference,
// MedicationRequest). Shape-level mappings only — this system has no real
// clinical terminology binding (no SNOMED CT/LOINC/RxNorm lookup), so every
// CodeableConcept below carries free text only, never a coded `coding`
// entry. Attached as an extra `fhir` field on the DWN record's own JSON
// content; never sent to AnonCreds (which only accepts flat attributes) or
// into the DIDComm credential message — see medical-routes.ts call sites.

interface FHIRCodeableConcept {
  text: string;
}

interface FHIRReference {
  display: string;
  identifier?: { value: string };
}

interface FHIRIdentifier {
  system: string;
  value: string;
}

export interface FHIRDocumentReference {
  resourceType: "DocumentReference";
  id: string;
  status: "current";
  type: FHIRCodeableConcept;
  subject: FHIRReference;
  date: string;
  author: FHIRReference[];
  description?: string;
  identifier?: FHIRIdentifier[];
  content: Array<{
    attachment: {
      contentType: string;
      title: string;
    };
  }>;
}

export interface FHIRMedicationRequest {
  resourceType: "MedicationRequest";
  id: string;
  status: "active";
  intent: "order";
  medicationCodeableConcept: FHIRCodeableConcept;
  subject: FHIRReference;
  authoredOn: string;
  requester: FHIRReference;
  reasonCode?: FHIRCodeableConcept[];
  identifier?: FHIRIdentifier[];
}

interface DocumentDataInput {
  documentId: string;
  documentType?: string;
  documentHash?: string;
  patientName?: string;
  patientId?: string;
  diagnosis?: string;
  prescription?: string;
  issuedBy: string;
  issuedAt: string;
}

// Maps a doctor-issued "medical" record into a FHIR DocumentReference.
// content[0] describes the associated document type only — the actual
// document bytes, when present, are stored as a separate binary DWN record
// (writeIssuedDocumentToDWN's attachmentRecord), not embedded here.
export function buildDocumentReferenceResource(data: DocumentDataInput): FHIRDocumentReference {
  const resource: FHIRDocumentReference = {
    resourceType: "DocumentReference",
    id: data.documentId,
    status: "current",
    type: { text: data.documentType || "Medical document" },
    subject: {
      display: data.patientName || "Unknown Patient",
      ...(data.patientId ? { identifier: { value: data.patientId } } : {}),
    },
    date: data.issuedAt,
    author: [{ display: data.issuedBy }],
    content: [
      {
        attachment: {
          contentType: "text/plain",
          title: data.documentType || "Medical document",
        },
      },
    ],
  };
  if (data.diagnosis) resource.description = data.diagnosis;
  // Our own hash format isn't a base64 SHA-1 digest of attachment bytes, so
  // it goes in a custom identifier rather than FHIR's attachment.hash field
  // (which has that specific meaning) — avoids misrepresenting the value.
  if (data.documentHash) {
    resource.identifier = [{ system: "urn:meditrust:document-hash", value: data.documentHash }];
  }
  return resource;
}

// Maps a doctor-issued "prescription" record into a FHIR MedicationRequest.
export function buildMedicationRequestResource(data: DocumentDataInput): FHIRMedicationRequest {
  const resource: FHIRMedicationRequest = {
    resourceType: "MedicationRequest",
    id: data.documentId,
    status: "active",
    intent: "order",
    medicationCodeableConcept: { text: data.prescription || "Not specified" },
    subject: {
      display: data.patientName || "Unknown Patient",
      ...(data.patientId ? { identifier: { value: data.patientId } } : {}),
    },
    authoredOn: data.issuedAt,
    requester: { display: data.issuedBy },
  };
  if (data.diagnosis) resource.reasonCode = [{ text: data.diagnosis }];
  if (data.documentHash) {
    resource.identifier = [{ system: "urn:meditrust:document-hash", value: data.documentHash }];
  }
  return resource;
}
