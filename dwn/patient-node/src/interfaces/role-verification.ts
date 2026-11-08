import { ProofDataResponse } from '../../../../agents/shared/types';

export interface VerifyActorRoleProofInput {
  proofRecordId: string;
  expectedRole: string;
}

// Confirms a grantedToDID's claimed actorRole is backed by a verified AnonCreds
// proof (via an agent's existing sendProofRequest/getProofData/GET /proof-data/:id
// flow — no new agent-side code needed) that the DID holds a ProfessionalRoleCredential
// with the claimed role, rather than trusting a bare self-reported string.
//
// Network/parse failures throw (not a silent `false`), so a misconfigured
// VERIFIER_AGENT_BASE_URL doesn't look identical to "the proof genuinely failed."
//
// The verifier address comes ONLY from this DWN's own config (2026-11-07).
// It used to accept a caller-supplied verifierAgentBaseUrl, so a caller could
// point the check at a server they control that simply answers
// {isVerified: true, role: ...} and make any role claim pass.
export async function verifyActorRoleProof(input: VerifyActorRoleProofInput): Promise<boolean> {
  const { proofRecordId, expectedRole } = input;
  if (!proofRecordId) throw new Error('proofRecordId is required');
  if (!expectedRole) throw new Error('expectedRole is required');

  const baseUrl = process.env.VERIFIER_AGENT_BASE_URL;
  if (!baseUrl) throw new Error('Role verification is not configured: VERIFIER_AGENT_BASE_URL is not set');
  if (!/^[A-Za-z0-9-]{1,100}$/.test(proofRecordId)) {
    throw new Error('Role proof verification failed: malformed proofRecordId');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/proof-data/${proofRecordId}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new Error(`Failed to reach verifier agent at ${url}: ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new Error(`Verifier agent returned ${response.status} for proof ${proofRecordId}`);
  }

  let data: ProofDataResponse;
  try {
    data = (await response.json()) as ProofDataResponse;
  } catch (err) {
    throw new Error(`Verifier agent response for proof ${proofRecordId} was not valid JSON: ${(err as Error).message}`);
  }

  if (!data.isVerified) return false;

  const revealedRole = extractRevealedRole(data);
  return revealedRole === expectedRole;
}

function extractRevealedRole(data: ProofDataResponse): string | undefined {
  const requestedProof = data.presentation?.anoncreds?.requested_proof;
  if (!requestedProof) return undefined;

  const directAttr = requestedProof.revealed_attrs?.role;
  if (directAttr) return directAttr.raw;

  const groupedAttrs = requestedProof.revealed_attr_groups;
  if (groupedAttrs) {
    for (const group of Object.values(groupedAttrs)) {
      const roleValue = group.values?.role;
      if (roleValue) return roleValue.raw;
    }
  }

  return undefined;
}
