import { Router, Request, Response } from 'express';
import { RecordsInterface, CreateRecordInput } from '../interfaces/records';
import { PermissionsInterface } from '../interfaces/permissions';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { DWNRecord } from '../../../../agents/shared/types';

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
// The patient always may read their own records (self-read exemption). Any
// other requester needs an active permission grant (PermissionsInterface).
// Authorized records are decrypted; denied records are excluded (list query)
// or produce a 403 (single recordId lookup). Field-level allowedFields
// redaction is NOT enforced here — that's the Protocols interface (Days 11-12).
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
    const denied: DWNRecord[] = [];
    for (const record of records) {
      const isSelf = requesterDID === record.patientDID;
      const hasGrant =
        isSelf ||
        (await PermissionsInterface.checkPermission({
          patientDID: record.patientDID,
          grantedToDID: requesterDID,
          recordType: record.recordType,
        }));
      (hasGrant ? authorized : denied).push(record);
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
    for (const record of authorized) {
      const { plaintext } = await RecordsInterface.decryptRecord(record);
      const data =
        record.contentType === 'application/json'
          ? JSON.parse(plaintext.toString('utf8'))
          : plaintext.toString('base64');

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
      metadata: { resultCount: results.length, deniedCount: denied.length },
    });

    res.json(recordId ? results[0] : results);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
