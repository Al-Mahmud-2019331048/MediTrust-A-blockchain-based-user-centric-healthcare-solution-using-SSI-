import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { signAuditEvent, verifyAuditEventSignature } from '../../../crypto/encryption/src/signing-utils';
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
}

export interface AuditEventInput {
  eventType: AuditEventType;
  actorDid: string;
  targetDid: string;
  resourceId: string;
  resourceType: string;
  action: string;
  metadata?: Record<string, unknown>;
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
  };
}

export class AuditService {
  static async record(input: AuditEventInput): Promise<AuditEvent> {
    const eventId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const payload = { eventId, ...input, timestamp };
    const signature = signAuditEvent(payload as Record<string, unknown>);

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
      },
    });

    console.log(`Audit: [${input.eventType}] actor=${input.actorDid} resource=${input.resourceId}`);
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

  static verify(event: AuditEvent): boolean {
    try {
      const decoded = verifyAuditEventSignature(event.signature) as Record<string, unknown>;
      return (
        decoded.eventId === event.eventId &&
        decoded.actorDid === event.actorDid &&
        decoded.targetDid === event.targetDid &&
        decoded.resourceId === event.resourceId
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
