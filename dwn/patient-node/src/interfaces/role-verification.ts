import { ProofDataResponse } from '../../../../agents/shared/types';

export interface VerifyActorRoleProofInput {
  proofRecordId: string;
  expectedRole: string;
  verifierAgentBaseUrl?: string;
}

// Confirms a grantedToDID's claimed actorRole is backed by a verified AnonCreds
// proof (via an agent's existing sendProofRequest/getProofData/GET /proof-data/:id
// flow — no new agent-side code needed) that the DID holds a ProfessionalRoleCredential
// with the claimed role, rather than trusting a bare self-reported string.
//
// Network/parse failures throw (not a silent `false`), so a misconfigured
// verifierAgentBaseUrl doesn't look identical to "the proof genuinely failed."
export async function verifyActorRoleProof(input: VerifyActorRoleProofInput): Promise<boolean> {
  const { proofRecordId, expectedRole } = input;
  if (!proofRecordId) throw new Error('proofRecordId is required');
  if (!expectedRole) throw new Error('expectedRole is required');

  const baseUrl = input.verifierAgentBaseUrl ?? process.env.VERIFIER_AGENT_BASE_URL;
  if (!baseUrl) throw new Error('No verifierAgentBaseUrl provided and VERIFIER_AGENT_BASE_URL is not set');

  const url = `${baseUrl.replace(/\/$/, '')}/proof-data/${proofRecordId}`;
  let response: Response;
  try {
    response = await fetch(url);
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
