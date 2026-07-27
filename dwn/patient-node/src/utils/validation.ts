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
