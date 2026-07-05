import { AnonCredsProof } from '@credo-ts/anoncreds';
import { LevelDBAdapter } from '../storage/leveldb';
import { signVerifiablePresentation } from '../../../../crypto/encryption/src/signing-utils';
import { Protocol, VerifiablePresentation } from '../../../../agents/shared/types';

// Stored under LevelDB key `protocol:{name}` — one row per protocol name, matching
// CLAUDE.md's documented 1:1 examples (MedicalRecord/doctor, Prescription/pharmacist,
// InsuranceClaim/insurer). Calling defineProtocol() again with the same name overwrites
// the row's actorRole/allowedFields.
const PROTOCOL_KEY_PREFIX = 'protocol:';

export interface DefineProtocolInput {
  name: string;
  actorRole: string;
  allowedFields: string[];
}

export interface ListProtocolsFilter {
  name?: string;
  actorRole?: string;
}

export interface GenerateVerifiablePresentationInput {
  anoncredsProof: AnonCredsProof;
  holderDID: string;
  protocolName?: string;
}

export interface GenerateVerifiablePresentationResult {
  vpJwt: string;
  vp: VerifiablePresentation;
}

export class ProtocolsInterface {
  static async defineProtocol(input: DefineProtocolInput): Promise<Protocol> {
    if (!input.name) throw new Error('name is required');
    if (!input.actorRole) throw new Error('actorRole is required');
    if (!input.allowedFields) throw new Error('allowedFields is required');
    if (!Array.isArray(input.allowedFields)) throw new Error('allowedFields must be an array of strings');

    const now = new Date().toISOString();
    // getProtocol() throws if the existing entry at this name is corrupted —
    // but that read is only used to preserve createdAt, not to decide whether
    // the write may proceed. Treating a corrupted existing entry as "none" (with
    // a warning) lets defineProtocol() self-heal a corrupted name instead of
    // being permanently blocked from ever overwriting it.
    let existing: Protocol | null;
    try {
      existing = await ProtocolsInterface.getProtocol(input.name);
    } catch {
      console.warn(`ProtocolsInterface.defineProtocol: existing entry for "${input.name}" is corrupted, overwriting it`);
      existing = null;
    }

    const protocol: Protocol = {
      name: input.name,
      actorRole: input.actorRole,
      allowedFields: input.allowedFields,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await LevelDBAdapter.put(PROTOCOL_KEY_PREFIX + input.name, JSON.stringify(protocol));
    return protocol;
  }

  static async getProtocol(name: string): Promise<Protocol | null> {
    const raw = await LevelDBAdapter.get(PROTOCOL_KEY_PREFIX + name);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Protocol;
    } catch {
      throw new Error(`Protocol ${name} exists but its stored data is corrupted (invalid JSON)`);
    }
  }

  // Skips (rather than throws on) any individual corrupted entry, matching the
  // convention in records.ts/permissions.ts — one bad protocol definition cannot
  // break list/query reads for every other protocol.
  static async listProtocols(filter: ListProtocolsFilter = {}): Promise<Protocol[]> {
    const entries = await LevelDBAdapter.scan({ prefix: PROTOCOL_KEY_PREFIX });
    const protocols: Protocol[] = [];
    for (const entry of entries) {
      let protocol: Protocol;
      try {
        protocol = JSON.parse(entry.value) as Protocol;
      } catch {
        console.warn(`ProtocolsInterface.listProtocols: skipping corrupted entry at key "${entry.key}" (invalid JSON)`);
        continue;
      }
      if (filter.name && protocol.name !== filter.name) continue;
      if (filter.actorRole && protocol.actorRole !== filter.actorRole) continue;
      protocols.push(protocol);
    }
    return protocols;
  }

  // Pure helper: empty allowedFields means unrestricted (returns data unchanged),
  // matching the semantics already in effect before enforcement existed — no
  // existing grant silently loses access. A non-empty list picks only those
  // top-level keys.
  static applyFieldFilter(data: Record<string, unknown>, allowedFields: string[]): Record<string, unknown> {
    if (allowedFields.length === 0) return data;
    // Object.create(null) + hasOwnProperty (not the `in` operator) — `in` walks
    // the prototype chain, so a field name like "toString" or "constructor"
    // would otherwise be treated as present and leak the inherited
    // Object.prototype method as if it were real record data.
    const filtered: Record<string, unknown> = Object.create(null);
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) filtered[field] = data[field];
    }
    return filtered;
  }

  // Generates a W3C-shaped Verifiable Presentation from an AnonCreds ZKP proof
  // record (e.g. fetched by the caller from an agent's GET /proof-data/:id).
  // JWT-based, not a JSON-LD/LD-Proof VP, consistent with this repo's existing
  // JWT-only signing convention. Real patient-DID-based signing is deferred
  // until patient wallet/DID work lands — same placeholder treatment as
  // Permission.consentVCId.
  static generateVerifiablePresentation(
    input: GenerateVerifiablePresentationInput
  ): GenerateVerifiablePresentationResult {
    if (!input.anoncredsProof) throw new Error('anoncredsProof is required');
    if (!input.holderDID) throw new Error('holderDID is required');

    const credentialSubject = extractRevealedAttributes(input.anoncredsProof);
    const now = new Date().toISOString();

    const vp: VerifiablePresentation = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: input.holderDID,
      verifiableCredential: [
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', input.protocolName ?? 'SelectiveDisclosureCredential'],
          credentialSubject,
          proof: {
            type: 'AnonCredsZKP',
            anoncredsProof: input.anoncredsProof,
            identifiers: input.anoncredsProof.identifiers,
          },
        },
      ],
      issuanceDate: now,
    };

    const vpJwt = signVerifiablePresentation({ ...vp });
    return { vpJwt, vp };
  }
}

function extractRevealedAttributes(anoncredsProof: AnonCredsProof): Record<string, string> {
  const attributes: Record<string, string> = {};
  const requestedProof = anoncredsProof.requested_proof;

  for (const [name, value] of Object.entries(requestedProof.revealed_attrs ?? {})) {
    attributes[name] = value.raw;
  }

  for (const group of Object.values(requestedProof.revealed_attr_groups ?? {})) {
    for (const [name, value] of Object.entries(group.values ?? {})) {
      attributes[name] = value.raw;
    }
  }

  return attributes;
}
