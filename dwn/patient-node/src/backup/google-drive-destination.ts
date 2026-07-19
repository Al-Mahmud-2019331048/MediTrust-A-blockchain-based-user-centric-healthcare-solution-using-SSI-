import { google } from 'googleapis';
import { Readable } from 'stream';
import { BackupDestination, BackupEntry } from './backup-destination';

// The decided, real backup destination (not a stand-in) — data is encrypted
// client-side before it ever reaches this file (backup-service.ts does that
// for records/permissions), so Google only ever holds "keep this online"
// trust, never "read this" trust.
//
// Needs real Google Cloud OAuth credentials to actually run — this is the
// one genuine external-account dependency in this project (everything else
// runs fully locally with no signup needed anywhere). Setup, one-time:
//   1. https://console.cloud.google.com -> new project -> enable "Google Drive API"
//   2. Create an OAuth 2.0 Client ID (type: Desktop app)
//   3. Run Google's OAuth consent flow once to get a refresh token for the
//      patient's own Drive account (a small one-off script, not built here
//      yet — this class assumes a refresh token already exists)
//   4. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET,
//      GOOGLE_DRIVE_REFRESH_TOKEN in .env
// Without these three env vars, this destination throws clearly on first
// use rather than failing silently — same pattern as this project's other
// required-secret checks (signing-utils.ts, mek-store.ts).
export class GoogleDriveBackupDestination implements BackupDestination {
  private folderCache = new Map<string, string>(); // patientDID -> Drive folder ID

  private getDriveClient() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        'Google Drive backup destination requires GOOGLE_DRIVE_CLIENT_ID, ' +
          'GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN in .env — ' +
          'see google-drive-destination.ts for one-time setup steps.'
      );
    }
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  private async getOrCreatePatientFolder(patientDID: string): Promise<string> {
    const cached = this.folderCache.get(patientDID);
    if (cached) return cached;

    const drive = this.getDriveClient();
    const folderName = `MediTrust Backups - ${patientDID}`;
    const existing = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });
    const found = existing.data.files?.[0]?.id;
    if (found) {
      this.folderCache.set(patientDID, found);
      return found;
    }

    const created = await drive.files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    const folderId = created.data.id!;
    this.folderCache.set(patientDID, folderId);
    return folderId;
  }

  async putEntry(patientDID: string, entry: BackupEntry): Promise<void> {
    const drive = this.getDriveClient();
    const folderId = await this.getOrCreatePatientFolder(patientDID);
    await drive.files.create({
      requestBody: { name: entry.fileName, parents: [folderId] },
      media: { mimeType: 'application/json', body: Readable.from([entry.content]) },
    });
  }

  async listEntries(patientDID: string): Promise<BackupEntry[]> {
    const drive = this.getDriveClient();
    const folderId = await this.getOrCreatePatientFolder(patientDID);
    const list = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      orderBy: 'name',
    });

    const entries: BackupEntry[] = [];
    for (const file of list.data.files ?? []) {
      if (!file.id || !file.name) continue;
      try {
        const content = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' });
        entries.push({ fileName: file.name, content: content.data as unknown as string });
      } catch {
        console.warn(`GoogleDriveBackupDestination.listEntries: skipping unreadable file "${file.name}"`);
      }
    }
    return entries;
  }
}
