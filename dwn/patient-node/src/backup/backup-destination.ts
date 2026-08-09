// A backup destination just needs to store and list small named entries per
// patient — it doesn't need to know anything about encryption, sequencing,
// or what a "record" or "permission" is. That logic lives in
// backup-service.ts; a destination is a dumb, swappable place to put/get
// opaque locked files.
export interface BackupEntry {
  fileName: string;
  content: string;
}

export interface BackupDestination {
  putEntry(patientDID: string, entry: BackupEntry): Promise<void>;
  // limit, when given, is a genuine bound on the underlying scan (not just a
  // post-hoc truncation) — a caller that only needs to confirm at least one
  // entry exists (e.g. key-recovery verification) shouldn't force a full-
  // history read. Omitted entirely, this returns full history.
  listEntries(patientDID: string, limit?: number): Promise<BackupEntry[]>;
}
