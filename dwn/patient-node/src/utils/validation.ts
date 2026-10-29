// patientDID in this DWN is not a W3C DID string — it's the opaque UUID
// minted by generateId() (crypto.randomUUID(), see government-agent's
// credential-routes.ts) as the patient's stable account identifier. It's
// used directly as a backup-destination scope key (a folder name for
// LocalBackupDestination, a URL path segment for DWNProviderBackupDestination,
// a query-filter value for GoogleDriveBackupDestination) — never validated
// before this, which meant a caller-supplied patientDID of "_protocols"
// (the reserved bucket name for shared, non-patient-specific protocol
// backups) would poison the shared bucket and break restore for every
// other patient, and values like "." or ".." could write outside the
// intended per-patient backup directory. A UUID can never collide with
// either, so this is a complete, root-cause fix, not a blocklist.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPatientDID(patientDID: unknown): patientDID is string {
  return typeof patientDID === 'string' && UUID_V4_PATTERN.test(patientDID);
}

// recordType/contentType previously reached RecordsInterface.createRecord()
// (and shareRecord's equivalent audit call) with only a truthiness check —
// `!input.recordType` lets any truthy non-string (123, true, [], {}) through.
// Found via fuzz testing (2026-08-12): a non-string value gets persisted as
// the record's/permission's real recordType, and the audit write for that
// same request then throws (Prisma's schema requires a String column),
// surfacing as a misleading 500 AFTER the malformed write already
// succeeded — the caller sees "failure" but the DWN is left holding a
// corrupted record. Separately, a non-string contentType breaks the
// `record.contentType === 'application/json'` identity check on read,
// silently serving legitimate JSON back as opaque base64. Enumerated
// against the real DWNRecord type (agents/shared/types/index.ts) rather
// than just checking `typeof === 'string'`, since an arbitrary string
// contentType would hit the exact same read-path bug.
const VALID_RECORD_TYPES = ['medical', 'prescription', 'lab_report'] as const;
const VALID_CONTENT_TYPES = ['application/json', 'application/pdf', 'image/jpeg', 'image/png'] as const;

export function isValidRecordType(recordType: unknown): recordType is 'medical' | 'prescription' | 'lab_report' {
  return typeof recordType === 'string' && (VALID_RECORD_TYPES as readonly string[]).includes(recordType);
}

export function isValidContentType(contentType: unknown): contentType is 'application/json' | 'application/pdf' | 'image/jpeg' | 'image/png' {
  return typeof contentType === 'string' && (VALID_CONTENT_TYPES as readonly string[]).includes(contentType);
}
