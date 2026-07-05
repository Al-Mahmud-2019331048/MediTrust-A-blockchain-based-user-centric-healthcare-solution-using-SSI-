import { Router, Request, Response } from 'express';
import { RecordsInterface, CreateRecordInput } from '../interfaces/records';
import { PermissionsInterface } from '../interfaces/permissions';
import { ProtocolsInterface } from '../interfaces/protocols';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { DWNRecord, Permission } from '../../../../agents/shared/types';

const BINARY_CONTENT_TYPES: DWNRecord['contentType'][] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

export const recordRouter = Router();

// POST /storeRecord — mounted at /dwn/storeRecord by server.ts (Day 13)
// Body: { patientDID, recordType, protocol, contentType, fileName?, data, authorDID? }
// data is a JSON string/object for contentType 'application/json', or a base64
// string for binary contentTypes.
recordRouter.post('/storeRecord', async (req: Request, res: Response) => {
  try {
    const { patientDID, recordType, protocol, contentType, fileName, data, authorDID } = req.body;

    if (!patientDID || !recordType || !protocol || !contentType || data === undefined) {
      return res.status(400).json({
        error: 'patientDID, recordType, protocol, contentType, and data are required',
      });
    }

    const isBinary = BINARY_CONTENT_TYPES.includes(contentType);
    const normalizedData = isBinary
      ? Buffer.from(data, 'base64')
      : typeof data === 'string'
        ? data
        : JSON.stringify(data);

    const input: CreateRecordInput = {
      patientDID,
      recordType,
      protocol,
      contentType,
      fileName: fileName ?? null,
      data: normalizedData,
    };

    const { record, encryptTimeMs, wrapTimeMs } = await RecordsInterface.createRecord(input);

    await AuditService.record({
      eventType: 'document_written',
      actorDid: authorDID ?? patientDID,
      targetDid: patientDID,
      resourceId: record.recordId,
      resourceType: recordType,
      action: 'createRecord',
      metadata: { encryptTimeMs, wrapTimeMs, fileSize: record.fileSize, contentType },
    });

    res.status(201).json(record);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /queryRecord — mounted at /dwn/queryRecord by server.ts (Day 13)
// Query params: recordId? | patientDID? & recordType? | requesterDID (required)
// The patient always may read their own records (self-read exemption, full
// record, no field redaction). Any other requester needs an active permission
// grant (PermissionsInterface) and gets field-level redaction applied: the
// permission's own allowedFields, further capped by a matching Protocol's
// allowedFields if one is defined for this record's protocol + the
// permission's actorRole (Days 11-12). Denied records are excluded (list
// query) or produce a 403 (single recordId lookup).
recordRouter.get('/queryRecord', async (req: Request, res: Response) => {
  try {
    const recordId = req.query.recordId as string | undefined;
    const patientDID = req.query.patientDID as string | undefined;
    const recordType = req.query.recordType as string | undefined;
    const requesterDID = req.query.requesterDID as string | undefined;

    if (!requesterDID) {
      return res.status(400).json({ error: 'requesterDID is required' });
    }

    let records: DWNRecord[];
    if (recordId) {
      const record = await RecordsInterface.readRecord(recordId);
      if (!record) return res.status(404).json({ error: `Record ${recordId} not found` });
      records = [record];
    } else {
      records = await RecordsInterface.queryRecords({ patientDID, recordType });
    }

    const authorized: DWNRecord[] = [];
    // null permission means self-read (isSelf) — no permission governs a
    // patient reading their own record, so no field redaction applies.
    const grantByRecordId = new Map<string, Permission | null>();
    const denied: DWNRecord[] = [];
    for (const record of records) {
      const isSelf = requesterDID === record.patientDID;
      if (isSelf) {
        authorized.push(record);
        grantByRecordId.set(record.recordId, null);
        continue;
      }
      // Multiple active grants for the same {patientDID, grantedToDID,
      // recordType} triple are possible (the patient granted more than
      // once) — take the first active match to govern field redaction.
      const [matchingGrant] = await PermissionsInterface.listPermissions({
        patientDID: record.patientDID,
        grantedToDID: requesterDID,
        recordType: record.recordType,
        activeOnly: true,
      });
      if (matchingGrant) {
        authorized.push(record);
        grantByRecordId.set(record.recordId, matchingGrant);
      } else {
        denied.push(record);
      }
    }

    if (recordId && denied.length > 0) {
      await AuditService.record({
        eventType: 'access_denied',
        actorDid: requesterDID,
        targetDid: denied[0].patientDID,
        resourceId: recordId,
        resourceType: denied[0].recordType,
        action: 'readRecord',
        metadata: {},
      });
      return res.status(403).json({ error: 'No active permission grant for this record' });
    }

    if (!recordId && denied.length > 0) {
      await AuditService.record({
        eventType: 'access_denied',
        actorDid: requesterDID,
        targetDid: patientDID ?? 'multiple',
        resourceId: `query:patientDID=${patientDID ?? '*'}:recordType=${recordType ?? '*'}`,
        resourceType: recordType ?? 'record',
        action: 'readRecord',
        metadata: { deniedRecordIds: denied.map((r) => r.recordId) },
      });
    }

    const results = [];
    const redactionsApplied: Record<string, string[]> = {};
    for (const record of authorized) {
      const { plaintext } = await RecordsInterface.decryptRecord(record);
      let data =
        record.contentType === 'application/json'
          ? JSON.parse(plaintext.toString('utf8'))
          : plaintext.toString('base64');

      // Field-level redaction (Days 11-12): only applies to non-self reads
      // (self-reads carry a null grant and always see the full record) and
      // only to JSON records (binary content has no fields to redact).
      const grant = grantByRecordId.get(record.recordId) ?? null;
      if (grant && record.contentType === 'application/json') {
        let effectiveAllowedFields = grant.allowedFields;
        if (grant.actorRole) {
          // A corrupted Protocol entry must not break reads for every record
          // that references it, across every patient — same class of bug
          // fixed for corrupted records/permissions entries. Treat it as "no
          // protocol defined" (soft fallback to Permission.allowedFields alone)
          // rather than letting the error propagate to a 500.
          let protocol;
          try {
            protocol = await ProtocolsInterface.getProtocol(record.protocol);
          } catch {
            console.warn(`GET /dwn/queryRecord: Protocol "${record.protocol}" is corrupted, skipping its field cap for record ${record.recordId}`);
            protocol = null;
          }
          if (protocol && protocol.actorRole === grant.actorRole) {
            effectiveAllowedFields =
              effectiveAllowedFields.length === 0
                ? protocol.allowedFields
                : protocol.allowedFields.length === 0
                  ? effectiveAllowedFields
                  : effectiveAllowedFields.filter((field) => protocol.allowedFields.includes(field));
          }
        }
        if (effectiveAllowedFields.length > 0) {
          redactionsApplied[record.recordId] = effectiveAllowedFields;
        }
        data = ProtocolsInterface.applyFieldFilter(data, effectiveAllowedFields);
      }

      // accessPolicy is DID-keyed (grantedToDID), not role-keyed like CLAUDE.md's
      // illustrative {"doctor": true} example — the schema has no role registry today.
      const activeGrants = await PermissionsInterface.listPermissions({
        patientDID: record.patientDID,
        recordType: record.recordType,
        activeOnly: true,
      });
      const accessPolicy = activeGrants.reduce(
        (acc, permission) => ({ ...acc, [permission.grantedToDID]: true }),
        {} as Record<string, boolean>
      );

      const { encryptedData, encryptedKey, iv, tag, ...rest } = record;
      results.push({ ...rest, data, accessPolicy });
    }

    await AuditService.record({
      eventType: 'document_read',
      actorDid: requesterDID,
      targetDid: patientDID ?? records[0]?.patientDID ?? 'unknown',
      resourceId: recordId ?? `query:patientDID=${patientDID ?? '*'}:recordType=${recordType ?? '*'}`,
      resourceType: recordType ?? 'record',
      action: 'readRecord',
      metadata: { resultCount: results.length, deniedCount: denied.length, redactionsApplied },
    });

    res.json(recordId ? results[0] : results);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
