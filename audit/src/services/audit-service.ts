import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { signAuditEvent, verifyAuditEventSignature, signWithPatientKey, verifyWithPatientKey } from '../../../crypto/encryption/src/signing-utils';
import { AuditEventType } from '../../../agents/shared/types';

export interface AuditEvent {
  eventId: string;
  eventType: AuditEventType;
  actorDid: string;
  targetDid: string;
  resourceId: string;
  resourceType: string;
  action: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  signature: string;
  // Present only for events signed with a patient's own key (see
  // AuditEventInput.patientSigningKey below) — null for the ordinary,
  // shared-secret-signed path. Storing the public key on the row itself
  // (rather than looking it up by DID at verify time) keeps verify()
  // callable from any process without depending on the DWN's LevelDB —
  // audit-service.ts is also loaded by the separate crypto/sss and
  // benchmark processes, which must never try to open the DWN's storage.
  signerPublicKey: string | null;
  // On-chain anchoring status — set via markAnchored(), a separate opt-in
  // call after record(). Deliberately OUTSIDE the signed JWT payload (written
  // after signing), so verify()'s field-by-field check never touches these.
  // Null on every row that never attempted anchoring (most rows — only 5
  // patient-signed event types opt in, see the callers of markAnchored()).
  anchorStatus: 'anchored' | 'blocked' | 'not_attempted' | null;
  ledgerTxnSeqNo: number | null;
  anchorError: string | null;
  anchoredAt: string | null;
}

export interface AuditEventInput {
  eventType: AuditEventType;
  actorDid: string;
  targetDid: string;
  resourceId: string;
  resourceType: string;
  action: string;
  metadata?: Record<string, unknown>;
  // When set, this event is signed with the PATIENT'S OWN key instead of the
  // shared AUDIT_SIGNING_SECRET — used for events that represent an action
  // the patient (or their own device, immediately, via self-custody)
  // genuinely took themselves (consent grant/revoke, self-custody split/
  // restore, data restore), as opposed to something the system merely
  // observed happening to their data (a doctor's write, someone else's
  // read) or an institutional-governance action (MPOA), both of which stay
  // system-signed on purpose. The caller resolves the key material itself
  // (via dwn/patient-node's patient-signing-key.ts) rather than this module
  // reaching for it directly — that import would transitively pull in the
  // DWN's LevelDB adapter, which must not be opened from a second process.
  patientSigningKey?: { privateKeyPem: string; publicKeyPem: string };
}

const prisma = new PrismaClient();

function rowToEvent(row: {
  eventId: string;
  eventType: string;
  actorDid: string;
  targetDid: string;
  resourceId: string;
  resourceType: string;
  action: string;
  metadata: string | null;
  timestamp: Date;
  signature: string;
  signerPublicKey: string | null;
  anchorStatus: string | null;
  ledgerTxnSeqNo: number | null;
  anchorError: string | null;
  anchoredAt: Date | null;
}): AuditEvent {
  return {
    eventId: row.eventId,
    eventType: row.eventType as AuditEventType,
    actorDid: row.actorDid,
    targetDid: row.targetDid,
    resourceId: row.resourceId,
    resourceType: row.resourceType,
    action: row.action,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
    timestamp: row.timestamp.toISOString(),
    signature: row.signature,
    signerPublicKey: row.signerPublicKey,
    anchorStatus: row.anchorStatus as AuditEvent['anchorStatus'],
    ledgerTxnSeqNo: row.ledgerTxnSeqNo,
    anchorError: row.anchorError,
    anchoredAt: row.anchoredAt ? row.anchoredAt.toISOString() : null,
  };
}

export class AuditService {
  static async record(input: AuditEventInput): Promise<AuditEvent> {
    const eventId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const { patientSigningKey, ...rest } = input;

    const payload = { eventId, ...rest, timestamp };
    const signature = patientSigningKey
      ? signWithPatientKey(payload as Record<string, unknown>, patientSigningKey.privateKeyPem)
      : signAuditEvent(payload as Record<string, unknown>);
    const signerPublicKey = patientSigningKey?.publicKeyPem ?? null;

    const row = await prisma.auditLog.create({
      data: {
        eventId,
        eventType: input.eventType,
        actorDid: input.actorDid,
        targetDid: input.targetDid,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        action: input.action,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        timestamp: new Date(timestamp),
        signature,
        signerPublicKey,
      },
    });

    console.log(`Audit: [${input.eventType}] actor=${input.actorDid} resource=${input.resourceId}`);
    return rowToEvent(row);
  }

  // Opt-in second call, made by the handful of call sites that attempt
  // on-chain anchoring (see audit/src/services/anchor-client.ts) — never
  // required, record()'s signature/behavior is completely unchanged for the
  // other ~14 callers that don't call this. Writes anchor status fields via
  // a plain UPDATE, deliberately AFTER signing already happened in record(),
  // so they stay outside the signed JWT payload and verify() is unaffected.
  static async markAnchored(
    eventId: string,
    result: { anchorStatus: 'anchored' | 'blocked' | 'not_attempted'; ledgerTxnSeqNo?: number; anchorError?: string }
  ): Promise<AuditEvent> {
    const row = await prisma.auditLog.update({
      where: { eventId },
      data: {
        anchorStatus: result.anchorStatus,
        ledgerTxnSeqNo: result.ledgerTxnSeqNo ?? null,
        anchorError: result.anchorError ?? null,
        anchoredAt: new Date(),
      },
    });
    return rowToEvent(row);
  }

  static async getByActor(actorDid: string): Promise<AuditEvent[]> {
    const rows = await prisma.auditLog.findMany({
      where: { actorDid },
      orderBy: { timestamp: 'desc' },
    });
    return rows.map(rowToEvent);
  }

  static async getByTarget(targetDid: string): Promise<AuditEvent[]> {
    const rows = await prisma.auditLog.findMany({
      where: { targetDid },
      orderBy: { timestamp: 'desc' },
    });
    return rows.map(rowToEvent);
  }

  static async getByResource(resourceId: string): Promise<AuditEvent[]> {
    const rows = await prisma.auditLog.findMany({
      where: { resourceId },
      orderBy: { timestamp: 'desc' },
    });
    return rows.map(rowToEvent);
  }

  static async getAll(): Promise<AuditEvent[]> {
    const rows = await prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' } });
    return rows.map(rowToEvent);
  }

  // Checks every field that record() actually signs (the whole AuditEventInput
  // plus eventId/timestamp — see the `payload` construction in record()), not
  // just a subset. Previously only checked eventId/actorDid/targetDid/
  // resourceId — action, eventType, resourceType, metadata, and timestamp
  // were all inside the signed JWT already but were never compared against
  // the stored row, so tampering any of those 5 fields directly in the
  // database went undetected despite the signature technically still being
  // "valid" (it validates the ORIGINAL signed payload, which verify() simply
  // wasn't checking the row against). Confirmed live via adversarial testing.
  static verify(event: AuditEvent): boolean {
    try {
      const decoded = (
        event.signerPublicKey
          ? verifyWithPatientKey(event.signature, event.signerPublicKey)
          : verifyAuditEventSignature(event.signature)
      ) as Record<string, unknown>;
      return (
        decoded.eventId === event.eventId &&
        decoded.eventType === event.eventType &&
        decoded.actorDid === event.actorDid &&
        decoded.targetDid === event.targetDid &&
        decoded.resourceId === event.resourceId &&
        decoded.resourceType === event.resourceType &&
        decoded.action === event.action &&
        decoded.timestamp === event.timestamp &&
        JSON.stringify(decoded.metadata ?? null) === JSON.stringify(event.metadata ?? null)
      );
    } catch {
      return false;
    }
  }

  static toCredentialAttributes(event: AuditEvent) {
    return [
      { name: 'eventId', value: event.eventId },
      { name: 'eventType', value: event.eventType },
      { name: 'actorDid', value: event.actorDid },
      { name: 'resourceId', value: event.resourceId },
      { name: 'action', value: event.action },
      { name: 'timestamp', value: event.timestamp },
    ];
  }
}
