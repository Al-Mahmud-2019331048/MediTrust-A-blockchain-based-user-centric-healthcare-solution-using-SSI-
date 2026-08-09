import crypto from 'crypto';
import { BackupDestination, BackupEntry } from './backup-destination';
import { getOrCreateSigningKey, getPublicKey } from '../encryption/patient-signing-key';
import { PROTOCOL_BACKUP_BUCKET } from './backup-service';
import { LevelDBAdapter } from '../storage/leveldb';
import { signWithPatientKey, verifyWithPatientKey } from '../../../../crypto/encryption/src/signing-utils';
import { AuditService } from '../../../../audit/src/services/audit-service';

// Replaces Google Drive as a decentralization-strengthening backup
// destination: instead of handing encrypted files to one centralized
// company, this pushes to a server this project itself runs
// (backup-provider/), which is storage-only — it never sees plaintext, and
// it cryptographically cannot fabricate or silently modify an entry, because
// every entry pushed here is a JWT signed with a key tied to the scope it
// belongs to, and every entry read back is re-verified against that same
// key before ever being trusted. A compromised or malicious provider can
// withhold data; it cannot forge it.
//
// getDestination() (backup-service.ts) instantiates a fresh destination per
// call, so this class holds no state of its own — registration is just
// re-asserted (cheap, idempotent on the provider side) before every push
// rather than cached.

function baseUrl(): string {
  return (process.env.BACKUP_PROVIDER_URL || 'http://localhost:4010').replace(/\/$/, '');
}

const SYSTEM_KEY_STORAGE_KEY = 'dwn-provider-system-key';

// PROTOCOL_BACKUP_BUCKET ('_protocols') is a shared, non-patient scope —
// protocol definitions are non-secret schema metadata with no MEK to key by
// (see backup-service.ts). getOrCreateSigningKey() is fundamentally
// patient-MEK-coupled: calling it for a scope that isn't a real patient
// would recursively trigger its own backupWrite({entityType:'signing_key'}),
// which would then get encrypted with getOrCreateMEK('_protocols') — a MEK
// that has nothing to do with any real patient's MEK, and would silently
// break decryption the moment that entry gets merged into a REAL patient's
// restore (gatherForRestore decrypts every merged entry with the one real
// patient MEK it was given). Confirmed live: this exact mismatch produced
// an "authentication tag mismatch" error during a real restore. Fixed by
// giving the shared bucket its own simple keypair — no MEK wrapping, no
// backupWrite recursion, since this data was already unencrypted/non-secret
// to begin with, so a plain locally-stored keypair adds no new exposure.
async function getOrCreateSystemKey(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const existing = await LevelDBAdapter.get(SYSTEM_KEY_STORAGE_KEY);
  if (existing) return JSON.parse(existing) as { privateKeyPem: string; publicKeyPem: string };

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const result = { privateKeyPem: privateKey as unknown as string, publicKeyPem: publicKey as unknown as string };
  await LevelDBAdapter.put(SYSTEM_KEY_STORAGE_KEY, JSON.stringify(result));
  return result;
}

async function getOrCreateScopeKey(scope: string): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  if (scope === PROTOCOL_BACKUP_BUCKET) return getOrCreateSystemKey();
  return getOrCreateSigningKey(scope);
}

async function getScopePublicKey(scope: string): Promise<string | null> {
  if (scope === PROTOCOL_BACKUP_BUCKET) {
    const existing = await LevelDBAdapter.get(SYSTEM_KEY_STORAGE_KEY);
    return existing ? (JSON.parse(existing) as { publicKeyPem: string }).publicKeyPem : null;
  }
  return getPublicKey(scope);
}

async function ensureRegistered(patientDID: string, privateKeyPem: string, publicKeyPem: string): Promise<void> {
  const proof = signWithPatientKey({ patientDID, publicKeyPem }, privateKeyPem);
  const response = await fetch(`${baseUrl()}/backup/patients/${encodeURIComponent(patientDID)}/register-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKeyPem, proof }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backup provider key registration failed with status ${response.status}: ${body}`);
  }
}

export class DWNProviderBackupDestination implements BackupDestination {
  async putEntry(patientDID: string, entry: BackupEntry): Promise<void> {
    const { privateKeyPem, publicKeyPem } = await getOrCreateScopeKey(patientDID);
    await ensureRegistered(patientDID, privateKeyPem, publicKeyPem);

    const token = signWithPatientKey(
      { patientDID, fileName: entry.fileName, content: entry.content },
      privateKeyPem
    );

    const response = await fetch(`${baseUrl()}/backup/patients/${encodeURIComponent(patientDID)}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backup provider push failed with status ${response.status}: ${body}`);
    }
  }

  async listEntries(patientDID: string, limit?: number): Promise<BackupEntry[]> {
    // The normal, strongly-trusted case: this device already has its own
    // locally-known public key (from having pushed at least once before) and
    // never needs to ask the provider what to trust.
    let publicKeyPem = await getScopePublicKey(patientDID);

    if (!publicKeyPem) {
      // Restore-time bootstrap: a genuinely fresh device — the whole point
      // of restoring — has no local key yet to verify against. Falling back
      // to whatever key the provider has registered is a necessarily weaker
      // trust step than the normal case above (an accepted, named
      // limitation of this PoC, the same class as the first-registration
      // TOFU race: a provider that was malicious from a device's very
      // first-ever contact could still hand back a self-consistent
      // fabricated identity, since there's no external root of trust here).
      // Ongoing operation is unaffected — it never reaches this branch once
      // a local key exists.
      const keyRes = await fetch(`${baseUrl()}/backup/patients/${encodeURIComponent(patientDID)}/public-key`);
      if (!keyRes.ok) return [];
      const keyBody = (await keyRes.json()) as { publicKeyPem: string | null };
      if (!keyBody.publicKeyPem) return [];
      publicKeyPem = keyBody.publicKeyPem;
    }

    const query = limit ? `?limit=${limit}` : '';
    const response = await fetch(`${baseUrl()}/backup/patients/${encodeURIComponent(patientDID)}/entries${query}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Backup provider list failed with status ${response.status}: ${body}`);
    }
    const { tokens } = (await response.json()) as { tokens: string[] };

    const entries: BackupEntry[] = [];
    for (const token of tokens) {
      try {
        const decoded = verifyWithPatientKey(token, publicKeyPem) as {
          patientDID: string;
          fileName: string;
          content: string;
        };
        if (decoded.patientDID !== patientDID) {
          throw new Error('patientDID inside token does not match the requested scope');
        }
        entries.push({ fileName: decoded.fileName, content: decoded.content });
      } catch (err) {
        console.warn(
          `DWNProviderBackupDestination.listEntries: rejecting unverifiable/tampered entry for ${patientDID}: ${(err as Error).message}`
        );
        await AuditService.record({
          eventType: 'backup_integrity_check_failed',
          actorDid: 'backup-provider',
          targetDid: patientDID,
          resourceId: patientDID,
          resourceType: 'backup_entry',
          action: 'listEntries',
          metadata: { reason: (err as Error).message },
        });
      }
    }
    return entries;
  }
}

// Not part of the BackupDestination interface (which stays exactly 2
// methods) — a separate, explicit capability, since real deletion is the
// concrete reason this destination is preferable to an immutable-ledger-
// style backend (BigchainDB was considered and rejected specifically for
// being unable to offer this).
export async function deleteAllProviderBackups(patientDID: string): Promise<void> {
  const { privateKeyPem } = await getOrCreateSigningKey(patientDID);
  const token = signWithPatientKey({ patientDID, action: 'delete-all', timestamp: new Date().toISOString() }, privateKeyPem);

  const response = await fetch(`${baseUrl()}/backup/patients/${encodeURIComponent(patientDID)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backup provider delete failed with status ${response.status}: ${body}`);
  }
}
