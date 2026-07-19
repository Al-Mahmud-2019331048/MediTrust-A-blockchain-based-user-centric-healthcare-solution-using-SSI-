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
  listEntries(patientDID: string): Promise<BackupEntry[]>;
}
