import { Router, Request, Response } from 'express';
import { RecordsInterface, CreateRecordInput } from '../interfaces/records';
import { PermissionsInterface } from '../interfaces/permissions';
import { ProtocolsInterface } from '../interfaces/protocols';
import { backupWrite } from '../backup/backup-service';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { DWNRecord, Permission } from '../../../../agents/shared/types';
import { isValidPatientDID } from '../utils/validation';
import { consumeNonce } from '../utils/nonce-guard';

const BINARY_CONTENT_TYPES: DWNRecord['contentType'][] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

export const recordRouter = Router();

// POST /storeRecord — mounted at /dwn/storeRecord by server.ts (Day 13)
// Body: { patientDID, recordType, protocol, contentType, fileName?, data, authorDID?, nonce }
// data is a JSON string/object for contentType 'application/json', or a base64
// string for binary contentTypes. nonce must be a fresh, caller-generated
// value never sent before — guards against a captured request being replayed
// to silently duplicate a write.
recordRouter.post('/storeRecord', async (req: Request, res: Response) => {
  try {
    const { patientDID, recordType, protocol, contentType, fileName, data, authorDID, nonce } = req.body;

    if (!patientDID || !recordType || !protocol || !contentType || data === undefined || !nonce) {
      return res.status(400).json({
        error: 'patientDID, recordType, protocol, contentType, data, and nonce are required',
      });
    }
    // patientDID is used directly as a backup-destination scope key
    // (folder name / URL segment / query value) — an unvalidated value like
    // "_protocols" (the reserved shared-bucket name) or ".."/"." would
    // poison shared backup state or write outside the intended per-patient
    // location. Must be the real UUID minted at identity issuance.
    if (!isValidPatientDID(patientDID)) {
      return res.status(400).json({ error: 'patientDID must be a valid UUID' });
    }
    if (typeof nonce !== 'string' || !consumeNonce(nonce)) {
      return res.status(409).json({ error: 'This nonce has already been used — possible replay, write rejected' });
    }

    const isBinary = BINARY_CONTENT_TYPES.includes(contentType);
    if (isBinary && typeof data === 'string') {
      // Buffer.from(data, 'base64') silently DROPS invalid characters instead
      // of throwing, so malformed input (e.g. stray spaces/symbols) gets
      // silently decoded into different, corrupted bytes with no error
      // anywhere — confirmed live via adversarial testing. Decoding then
      // re-encoding and comparing against the (whitespace/padding-stripped)
      // original catches this before it's ever persisted.
      const stripPad = (s: string) => s.replace(/=+$/, '');
      const reencoded = stripPad(Buffer.from(data, 'base64').toString('base64'));
      if (reencoded !== stripPad(data.replace(/\s/g, ''))) {
        return res.status(400).json({ error: 'data is not valid base64 for a binary contentType' });
      }
    }
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

    // Operation Fullbring: incremental backup — fires right after this
    // write succeeds, sending only this one new record (encrypted with the
    // patient's own MEK) to the configured backup destination.
    await backupWrite({
      entityType: 'record',
      patientDID,
      entityKey: `record:${record.recordId}`,
      entity: record,
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

      // accessPolicy reveals the patient's full consent graph (every DID
      // with active access) — self-reads only (grant === null): the patient
      // themselves. A non-self requester (a real grant object) must never
      // see this — it would leak the identities of every OTHER party the
      // patient has granted access to, to any single authorized grantee.
      // accessPolicy is DID-keyed (grantedToDID), not role-keyed like CLAUDE.md's
      // illustrative {"doctor": true} example — the schema has no role registry today.
      let accessPolicy: Record<string, boolean> | undefined;
      if (grant === null) {
        const activeGrants = await PermissionsInterface.listPermissions({
          patientDID: record.patientDID,
          recordType: record.recordType,
          activeOnly: true,
        });
        accessPolicy = activeGrants.reduce(
          (acc, permission) => ({ ...acc, [permission.grantedToDID]: true }),
          {} as Record<string, boolean>
        );
      }

      const { encryptedData, encryptedKey, iv, tag, ...rest } = record;
      results.push(accessPolicy ? { ...rest, data, accessPolicy } : { ...rest, data });
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
