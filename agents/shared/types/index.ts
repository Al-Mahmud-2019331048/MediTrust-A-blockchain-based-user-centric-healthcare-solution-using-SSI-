import { AnonCredsRequestedAttribute, AnonCredsRequestedPredicate, AnonCredsProof } from "@credo-ts/anoncreds";

export type CreateInvitationOptions = {
    label?: string;
    alias?: string;
    domain?: string;
}

export type AcceptInvitationOptions = {
    invitationUrl: string;
    label?: string;
    alias?: string;
    imageUrl?: string;
}

export type GetConnectionsOptions = {
    connectionId?: string;
    outOfBandId?: string;
}

export type SendProofRequest = {
    proofRequestlabel: string;
    connectionId: string;
    version?: string;
    attributes?: Record<string, AnonCredsRequestedAttribute>;
    predicates?: Record<string, AnonCredsRequestedPredicate>;
}

export type AttributeElement = {
    name: string;
    value: string;
}

export type PredicateProps = {
    name: {
        name: string;
        p_type: ">=" | ">" | "<=" | "<";
        p_value: number;
        restriction: {
            cred_def_id: string;
        }[];
    };
};

// Extended types for the new build

export type AgentType = 'government' | 'doctor' | 'pharmacy' | 'healthcare-authority';

export type ProofStatusCacheEntry = {
    state: string;
    isVerified: boolean;
    timestamp: number;
    connectionId?: string;
};

export type ProofStatusCache = Record<string, ProofStatusCacheEntry>;

export type DocumentMetadata = {
    documentId: string;
    patientDid: string;
    sha256: string;
    docType: string;
    issuedBy: string;
    issuedAt: string;
    fileName: string;
    mimeType: string;
};

export type ConsentReceiptAttributes = {
    consentId: string;
    patientDid: string;
    providerDid: string;
    resourceType: string;
    grantedAt: string;
    expiresAt?: string;
    purpose: string;
};

export type AuditEventType =
    | 'credential_issued'
    | 'credential_verified'
    | 'credential_revoked'
    | 'document_written'
    | 'document_read'
    | 'consent_granted'
    | 'consent_revoked'
    | 'access_denied'
    | 'key_split'
    | 'key_recovery_initiated'
    | 'key_recovery_approved'
    | 'key_reconstructed'
    | 'protocol_registered'
    | 'protocol_updated'
    | 'vp_generated'
    | 'dwn_restored'
    | 'backup_integrity_check_failed';

export interface SSSShare {
    shareId: string;
    shareIndex: number;
    holder: 'patient' | 'hospital' | 'trusted_family' | 'backup_server' | 'recovery_agent';
    shareData: string;
}

export interface MPOAApproval {
    approverDid: string;
    approverRole: 'patient' | 'hospital' | 'guardian';
    approvedAt: string;
    signature: string;
}

export interface RecoveryRequest {
    requestId: string;
    patientDid: string;
    initiatedAt: string;
    expiresAt: string;
    approvals: MPOAApproval[];
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    // shareIds of the specific 5-way split issued for this request (via /recovery/initiate-with-split).
    // Unset for requests created via the older bare /recovery/initiate — reconstruct() rejects
    // (rather than skips) the share-provenance check in that case; see sss-routes.ts.
    issuedShareIds?: string[];
    // sha256(shareData) per issued shareId — checking shareId membership alone only proves a
    // submitted share's ID was once issued, not that its DATA wasn't swapped for something else
    // while keeping a real (plaintext, publicly visible in API responses) shareId. reconstruct()
    // must check both.
    issuedShareFingerprints?: Record<string, string>;
}

export interface EncryptedPayload {
    encryptedData: string;
    encryptedKey: string;
    iv: string;
    tag: string;
}

export interface DWNRecord extends EncryptedPayload {
    recordId: string;
    patientDID: string;
    recordType: 'medical' | 'prescription' | 'lab_report';
    protocol: string;
    contentType: 'application/json' | 'application/pdf' | 'image/jpeg' | 'image/png';
    fileName: string | null;
    fileSize: number;
    hash: string;
    // Placeholder until Days 16-17 wire in real on-chain Indy VC issuance via the doctor agent.
    integrityVCId: string;
    createdAt: string;
    updatedAt: string;
}

export interface Permission {
    permissionId: string;
    patientDID: string;
    grantedToDID: string;
    recordType: DWNRecord['recordType'];
    allowedFields: string[];
    purpose: string;
    grantedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    // Real signConsentReceipt() JWT — off-chain but cryptographically real.
    // On-chain anchoring on Indy deferred to Days 16-17, same as DWNRecord.integrityVCId.
    consentVCId: string;
    // Role-based Protocol enforcement (Days 11-12). actorRole is only trusted when backed by
    // roleProofRecordId — a verified AnonCreds proof (via an agent's existing sendProofRequest/
    // getProofData flow) that the grantedToDID holds a ProfessionalRoleCredential with this role.
    // grantPermission() rejects actorRole supplied without a roleProofRecordId.
    actorRole?: string;
    roleProofRecordId?: string;
}

// DWN Protocols Interface (Days 11-12) — attribute-level field rules per actor role.
// Stored under LevelDB key `protocol:{name}` — one row per protocol name (CLAUDE.md's
// documented 1:1 examples: MedicalRecord/doctor, Prescription/pharmacist, InsuranceClaim/insurer).
export interface Protocol {
    name: string;              // "MedicalRecord" | "Prescription" | "InsuranceClaim"
    actorRole: string;         // "doctor" | "pharmacist" | "insurer"
    allowedFields: string[];
    createdAt: string;
    updatedAt: string;
}

// Minimal shape verifyActorRoleProof() expects back from an agent's GET /proof-data/:id
// endpoint — matches what agents/shared/verifier-routes.ts already returns.
export interface ProofDataResponse {
    isVerified: boolean;
    presentation?: {
        anoncreds?: AnonCredsProof;
    };
}

// W3C Verifiable Presentation generated from an AnonCreds ZKP proof record (Days 11-12).
// JWT-based (not a JSON-LD/LD-Proof VP), consistent with this repo's existing JWT-only
// signing convention (crypto/encryption/src/signing-utils.ts). The JWT signature itself is
// the "proof" for now — real patient-DID-based signing deferred until patient wallet/DID
// work lands, same placeholder treatment as Permission.consentVCId.
export interface VerifiablePresentation {
    '@context': string[];
    type: string[];
    holder: string;
    verifiableCredential: Array<{
        '@context': string[];
        type: string[];
        credentialSubject: Record<string, string>;
        proof: {
            type: 'AnonCredsZKP';
            anoncredsProof: AnonCredsProof;
            identifiers: AnonCredsProof['identifiers'];
        };
    }>;
    issuanceDate: string;
}
