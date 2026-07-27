// Server-side port of apps/web/src/utils/proof-parser.ts's extraction logic
// (kept in sync deliberately — same shape, same two response formats) so an
// agent can independently verify what a real AnonCreds proof actually
// revealed, instead of trusting a client-asserted patientDID/identityVerified
// claim. See agents/doctor-agent/src/routes/medical-routes.ts for the
// verification this backs.
export interface ProofResult {
  revealedAttributes: Record<string, string>;
}

export function extractRevealedAttributes(proofData: any): ProofResult {
  const presentation =
    proofData?.presentation?.anoncreds ??
    proofData?.data?.by_format?.pres?.indy ??
    null;

  const revealedAttributes: Record<string, string> = {};
  if (!presentation) return { revealedAttributes };

  const attrGroups = presentation.requested_proof?.revealed_attr_groups ?? {};
  for (const groupKey of Object.keys(attrGroups)) {
    const values = attrGroups[groupKey].values ?? {};
    for (const [attrName, attrVal] of Object.entries<any>(values)) {
      revealedAttributes[attrName] = attrVal.raw;
    }
  }

  const flatAttrs = presentation.requested_proof?.revealed_attrs ?? {};
  for (const [attrName, attrVal] of Object.entries<any>(flatAttrs)) {
    revealedAttributes[attrName] = attrVal.raw;
  }

  return { revealedAttributes };
}
