// Extracted from ShareProof.jsx lines 49–90.
// Parses AnonCreds proof presentations from both Credo and ACA-Py response shapes.

export interface ProofResult {
  revealedAttributes: Record<string, string>;
  predicates: Array<{ name: string; pType: string; value: number }>;
  raw: unknown;
}

export function extractProofData(proofData: any): ProofResult | null {
  if (!proofData) return null;

  // Support both Credo and ACA-Py response shapes
  const presentation =
    proofData.presentation?.anoncreds ??
    proofData.data?.by_format?.pres?.indy ??
    null;

  if (!presentation) return null;

  const revealedAttributes: Record<string, string> = {};
  const attrGroups = presentation.requested_proof?.revealed_attr_groups ?? {};
  for (const groupKey of Object.keys(attrGroups)) {
    const values = attrGroups[groupKey].values ?? {};
    for (const [attrName, attrVal] of Object.entries<any>(values)) {
      revealedAttributes[attrName] = attrVal.raw;
    }
  }

  // Also handle flat revealed_attrs (non-grouped format)
  const flatAttrs = presentation.requested_proof?.revealed_attrs ?? {};
  for (const [attrName, attrVal] of Object.entries<any>(flatAttrs)) {
    revealedAttributes[attrName] = attrVal.raw;
  }

  const predicates: ProofResult['predicates'] = [];
  const proofs = presentation.proof?.proofs ?? [];
  for (const proof of proofs) {
    const geProofs = proof.primary_proof?.ge_proofs ?? [];
    for (const geProof of geProofs) {
      const pred = geProof.predicate;
      if (pred) {
        predicates.push({
          name: pred.attr_name,
          pType: pred.p_type === 'GE' ? '>=' : pred.p_type === 'LE' ? '<=' : pred.p_type,
          value: pred.value,
        });
      }
    }
  }

  return { revealedAttributes, predicates, raw: presentation };
}
