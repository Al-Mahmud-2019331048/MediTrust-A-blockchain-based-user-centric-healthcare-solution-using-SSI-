import { LevelDBAdapter } from '../storage/leveldb';
import { generateId } from '../../../../crypto/encryption/src/hash-utils';
import { signConsentReceipt } from '../../../../crypto/encryption/src/signing-utils';
import { Permission, DWNRecord } from '../../../../agents/shared/types';

const PERMISSION_KEY_PREFIX = 'permission:';

export interface GrantPermissionInput {
  patientDID: string;
  grantedToDID: string;
  recordType: DWNRecord['recordType'];
  purpose: string;
  expiresAt?: string | null;
  // Reserved for the Protocols interface (Days 11-12) to enforce; stored but
  // not consulted for redaction this session.
  allowedFields?: string[];
}

export interface RevokePermissionInput {
  permissionId?: string;
  patientDID?: string;
  grantedToDID?: string;
  recordType?: string;
}

export interface ListPermissionsFilter {
  patientDID?: string;
  grantedToDID?: string;
  recordType?: string;
  activeOnly?: boolean;
}

export interface CheckPermissionInput {
  patientDID: string;
  grantedToDID: string;
  recordType: string;
}

export interface RevokePermissionResult {
  // Current state of every permission matched by this call — returned to HTTP
  // callers so they always see the up-to-date state, even for an idempotent
  // re-revoke of something already revoked.
  permissions: Permission[];
  // The subset actually transitioned to revoked BY THIS CALL. Callers (the
  // route layer) should only audit-log this subset — logging `permissions`
  // instead would record a "revoked" event every time someone re-revokes an
  // already-revoked permission, or when two concurrent calls race.
  freshlyRevoked: Permission[];
}

function isActive(permission: Permission): boolean {
  if (permission.revokedAt !== null) return false;
  if (permission.expiresAt !== null && new Date() >= new Date(permission.expiresAt)) return false;
  return true;
}

// Minimal per-key async mutex. Node has no built-in primitive for this, and
// revokePermission's read-modify-write (get, then later put) has an await
// point in between where two concurrent calls for the same key could both
// read the pre-revoke state before either writes. Chaining each call onto the
// previous call's settled promise serializes access per key without blocking
// unrelated keys.
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  const tracker = result.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, tracker);
  tracker.finally(() => {
    if (locks.get(key) === tracker) locks.delete(key);
  });
  return result;
}

export class PermissionsInterface {
  static async grantPermission(input: GrantPermissionInput): Promise<Permission> {
    if (!input.patientDID) throw new Error('patientDID is required');
    if (!input.grantedToDID) throw new Error('grantedToDID is required');
    if (!input.recordType) throw new Error('recordType is required');
    if (!input.purpose) throw new Error('purpose is required');

    const permissionId = generateId();
    const now = new Date().toISOString();
    const expiresAt = input.expiresAt ?? null;

    const consentVCId = signConsentReceipt({
      consentId: permissionId,
      patientDid: input.patientDID,
      providerDid: input.grantedToDID,
      resourceType: input.recordType,
      grantedAt: now,
      expiresAt: expiresAt ?? undefined,
      purpose: input.purpose,
    });

    const permission: Permission = {
      permissionId,
      patientDID: input.patientDID,
      grantedToDID: input.grantedToDID,
      recordType: input.recordType,
      allowedFields: input.allowedFields ?? [],
      purpose: input.purpose,
      grantedAt: now,
      expiresAt,
      revokedAt: null,
      consentVCId,
    };

    await LevelDBAdapter.put(PERMISSION_KEY_PREFIX + permissionId, JSON.stringify(permission));

    return permission;
  }

  static async revokePermission(input: RevokePermissionInput): Promise<RevokePermissionResult> {
    if (input.permissionId) {
      const permissionId = input.permissionId;
      return withLock(`permission:${permissionId}`, async () => {
        const raw = await LevelDBAdapter.get(PERMISSION_KEY_PREFIX + permissionId);
        if (raw === null) throw new Error(`Permission ${permissionId} not found`);
        let permission: Permission;
        try {
          permission = JSON.parse(raw) as Permission;
        } catch {
          throw new Error(`Permission ${permissionId} exists but its stored data is corrupted (invalid JSON)`);
        }
        if (permission.revokedAt !== null) {
          // Already revoked (by an earlier call, or by a concurrent call that
          // won the race under this same lock) — idempotent no-op, nothing new
          // to audit.
          return { permissions: [permission], freshlyRevoked: [] };
        }
        permission.revokedAt = new Date().toISOString();
        await LevelDBAdapter.put(PERMISSION_KEY_PREFIX + permission.permissionId, JSON.stringify(permission));
        return { permissions: [permission], freshlyRevoked: [permission] };
      });
    }

    if (input.patientDID && input.grantedToDID && input.recordType) {
      const tripleKey = `triple:${input.patientDID}|${input.grantedToDID}|${input.recordType}`;
      return withLock(tripleKey, async () => {
        const matches = await PermissionsInterface.listPermissions({
          patientDID: input.patientDID,
          grantedToDID: input.grantedToDID,
          recordType: input.recordType,
          activeOnly: true,
        });
        if (matches.length === 0) {
          throw new Error('No active permission found for the given patientDID/grantedToDID/recordType');
        }
        const now = new Date().toISOString();
        for (const permission of matches) {
          permission.revokedAt = now;
          await LevelDBAdapter.put(PERMISSION_KEY_PREFIX + permission.permissionId, JSON.stringify(permission));
        }
        return { permissions: matches, freshlyRevoked: matches };
      });
    }

    throw new Error('Either permissionId or {patientDID, grantedToDID, recordType} must be provided');
  }

  static async checkPermission(input: CheckPermissionInput): Promise<boolean> {
    const matches = await PermissionsInterface.listPermissions({ ...input, activeOnly: true });
    return matches.length > 0;
  }

  // Skips (rather than throws on) any individual corrupted entry, so one bad
  // permission anywhere in the node cannot break checkPermission/listPermissions
  // — and therefore every authenticated read — for every other patient.
  static async listPermissions(filter: ListPermissionsFilter = {}): Promise<Permission[]> {
    const entries = await LevelDBAdapter.scan({ prefix: PERMISSION_KEY_PREFIX });
    const permissions: Permission[] = [];
    for (const entry of entries) {
      let permission: Permission;
      try {
        permission = JSON.parse(entry.value) as Permission;
      } catch {
        console.warn(`PermissionsInterface.listPermissions: skipping corrupted entry at key "${entry.key}" (invalid JSON)`);
        continue;
      }
      if (filter.patientDID && permission.patientDID !== filter.patientDID) continue;
      if (filter.grantedToDID && permission.grantedToDID !== filter.grantedToDID) continue;
      if (filter.recordType && permission.recordType !== filter.recordType) continue;
      if (filter.activeOnly && !isActive(permission)) continue;
      permissions.push(permission);
    }
    return permissions;
  }
}
