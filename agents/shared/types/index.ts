import { AnonCredsRequestedAttribute, AnonCredsRequestedPredicate } from "@credo-ts/anoncreds";

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
    | 'key_reconstructed';

export interface SSSShare {
    shareId: string;
    shareIndex: number;
    holder: 'patient' | 'hospital' | 'trusted_family' | 'backup_server' | 'recovery_agent';
    shareData: string;
}

export interface MPOAApproval {
    approverDid: string;
    approverRole: 'patient' | 'hospital' | 'trusted_authority';
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
}
