import { Router, Request, Response } from 'express';
import { RecordsInterface, CreateRecordInput } from '../interfaces/records';
import { PermissionsInterface } from '../interfaces/permissions';
import { ProtocolsInterface } from '../interfaces/protocols';
import { backupWrite } from '../backup/backup-service';
import { AuditService } from '../../../../audit/src/services/audit-service';
import { attemptAnchor } from '../../../../audit/src/services/anchor-client';
import { DWNRecord, Permission } from '../../../../agents/shared/types';
import { isValidPatientDID, isValidRecordType, isValidContentType } from '../utils/validation';
import { consumeNonce } from '../utils/nonce-guard';
import { isRateLimited } from '../utils/rate-limit';
import { sha256, sha256String } from '../../../../crypto/encryption/src/hash-utils';

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
    // Found via fuzz testing (2026-08-12): a non-string recordType/protocol/
    // contentType (a number, boolean, array, object) previously passed the
    // bare truthiness check above, got persisted into the DWN as-is, and
    // only THEN crashed the audit-log write with an unhandled 500 (Prisma's
    // schema requires a String column) — the caller saw "failure" while the
    // malformed record was actually already saved. A non-string contentType
    // additionally breaks the `=== 'application/json'` check on read,
    // silently serving real JSON back as opaque base64. See validation.ts
    // for why these are checked against the real enum, not just typeof.
    if (!isValidRecordType(recordType)) {
      return res.status(400).json({ error: "recordType must be one of 'medical', 'prescription', 'lab_report'" });
    }
    if (!isValidContentType(contentType)) {
      return res.status(400).json({ error: "contentType must be one of 'application/json', 'application/pdf', 'image/jpeg', 'image/png'" });
    }
    if (typeof protocol !== 'string' || !protocol) {
      return res.status(400).json({ error: 'protocol must be a non-empty string' });
    }
    if (fileName !== undefined && fileName !== null && typeof fileName !== 'string') {
      return res.status(400).json({ error: 'fileName must be a string' });
    }
    if (authorDID !== undefined && authorDID !== null && typeof authorDID !== 'string') {
      return res.status(400).json({ error: 'authorDID must be a string' });
    }
    if (typeof nonce !== 'string') {
      return res.status(400).json({ error: 'nonce must be a string' });
    }
    // storeRecord has no caller-identity check at all (writes are
    // deliberately unauthenticated — see CLAUDE.md's "sovereignty enforced
    // at the READ layer only"), and accepts up to a 25MB body with no
    // throttling — found during 2026-08-12 stress testing to be a real,
    // unbounded disk/memory-exhaustion vector against a single patientDID.
    // Scoped per-patientDID (not global), same convention as the existing
    // self-custody/mpoa rate limits — bounds repeated abuse of one patient's
    // vault without touching legitimate multi-patient write throughput.
    if (isRateLimited(`storeRecord:${patientDID}`, 30, 60_000)) {
      return res.status(429).json({ error: 'Too many writes for this patient — try again in a minute.' });
    }
    const requestFingerprint = sha256String(JSON.stringify({ patientDID, recordType, protocol, contentType, fileName, data, authorDID }));
    const { accepted, mismatchedReplay } = consumeNonce(nonce, requestFingerprint);
    if (!accepted) {
      return res.status(409).json({
        error: mismatchedReplay
          ? 'This nonce was already used for a different request — possible tampering, write rejected'
          : 'This nonce has already been used — possible replay, write rejected',
      });
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

    // On-chain anchoring: best-effort, fire-and-forget — NOT awaited before
    // responding, same reasoning as every other anchoring call site in this
    // codebase (attemptAnchor()'s own 5s timeout would otherwise make every
    // document write as slow as the ledger's — see permission-routes.ts for
    // the live-regression numbers that established this pattern). Anchors
    // record.hash directly — the same real SHA-256 already recomputed and
    // compared on every read below — so integrityVCId (a documented,
    // deferred placeholder) gets replaced with a real ledger transaction
    // reference once this resolves, instead of staying fake forever.
    //
    // Re-pushes the now-anchored record to backup once markRecordAnchored()
    // resolves — found live 2026-08-31 during a device-loss recovery drill
    // that without this, the backup entry pushed below (at write time,
    // necessarily before this async anchor resolves) permanently froze the
    // pre-anchor placeholder: recovering the record later always brought
    // the placeholder back, even if the original had a real anchor by the
    // time the device was lost. Still fire-and-forget — a failed re-push
    // just leaves backup one step behind the live copy, same best-effort
    // treatment as the anchor itself.
    attemptAnchor(record.hash)
      .then((anchor) => RecordsInterface.markRecordAnchored(record.recordId, anchor))
      .then((updatedRecord) => {
        if (!updatedRecord) return;
        return backupWrite({
          entityType: 'record',
          patientDID,
          entityKey: `record:${updatedRecord.recordId}`,
          entity: updatedRecord,
        });
      })
      .catch(() => {});

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
    // Every real caller already knows which patient they're asking about
    // (a self-read passes its own patientDID, a grant-based read passes the
    // specific patientDID the grant is for) — recordId is the only other
    // legitimate way to scope a query. Without this, patientDID and recordId
    // both omitted meant a full, unauthenticated scan of every record for
    // every patient in the DWN plus a permission-lookup per non-owned
    // record — confirmed live during 2026-08-12 stress testing to cost real,
    // unbounded server time (scaled linearly with total DB size) triggered
    // by one unauthenticated GET with an arbitrary requesterDID.
    if (!recordId && !patientDID) {
      return res.status(400).json({ error: 'Either recordId or patientDID is required' });
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
    const tamperedRecordIds: string[] = [];
    for (const record of authorized) {
      const { plaintext } = await RecordsInterface.decryptRecord(record);

      // record.hash is the SHA-256 of the plaintext at write time — recomputed
      // here and compared on every read. This is independent of AES-GCM's own
      // auth tag (which only proves the ciphertext blob wasn't corrupted): a
      // party with direct LevelDB write access could swap in a *different*,
      // still-validly-encrypted blob under the same key, which the auth tag
      // alone would not catch. A mismatch here is never served — the record is
      // excluded from results and logged rather than silently returned.
      const computedHash = sha256(plaintext);
      if (computedHash !== record.hash) {
        tamperedRecordIds.push(record.recordId);
        await AuditService.record({
          eventType: 'document_integrity_check_failed',
          actorDid: requesterDID,
          targetDid: record.patientDID,
          resourceId: record.recordId,
          resourceType: record.recordType,
          action: 'readRecord',
          metadata: { expectedHash: record.hash, computedHash },
        });
        continue;
      }

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

    if (recordId && tamperedRecordIds.length > 0) {
      return res.status(409).json({
        error: `Record ${recordId} failed integrity verification — its stored content does not match its recorded fingerprint. This may indicate tampering or corruption.`,
      });
    }

    await AuditService.record({
      eventType: 'document_read',
      actorDid: requesterDID,
      targetDid: patientDID ?? records[0]?.patientDID ?? 'unknown',
      resourceId: recordId ?? `query:patientDID=${patientDID ?? '*'}:recordType=${recordType ?? '*'}`,
      resourceType: recordType ?? 'record',
      action: 'readRecord',
      metadata: { resultCount: results.length, deniedCount: denied.length, tamperedCount: tamperedRecordIds.length, redactionsApplied },
    });

    res.json(recordId ? results[0] : results);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
