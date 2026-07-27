'use client';
import { useState, useCallback } from 'react';
import { AgentType, getProofData, getProofStatus, sendProofRequest } from '../services/apiService';
import { extractProofData, ProofResult } from '../utils/proof-parser';
import { usePolling } from './usePolling';

export type VerificationState = 'idle' | 'requesting' | 'polling' | 'verified' | 'failed';

// Extracted from doctor/page.jsx lines 86–170.
// Handles: send proof request → poll proof-status → extract proof data → done.
// requestFn overrides the default generic POST /send-proof-request call —
// used by the Pharmacy Portal to hit pharmacy-agent's own bespoke
// /verify-patient-identity and /verify-prescription routes instead, while
// reusing this hook's polling/extraction logic unchanged.
export function useProofVerification(
  agentType: AgentType,
  connectionId: string | null,
  requestFn?: (connectionId: string, proofLabel: string) => Promise<{ id: string }>
) {
  const [state, setState] = useState<VerificationState>('idle');
  const [proofRecordId, setProofRecordId] = useState<string | null>(null);
  const [proofData, setProofData] = useState<ProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestVerification = useCallback(
    async (proofLabel: string) => {
      if (!connectionId) return;
      setState('requesting');
      setError(null);
      try {
        const result = requestFn
          ? await requestFn(connectionId, proofLabel)
          : await sendProofRequest(agentType, connectionId, proofLabel);
        setProofRecordId(result.id);
        setState('polling');
      } catch (err: any) {
        setError(err.message);
        setState('failed');
      }
    },
    [agentType, connectionId, requestFn]
  );

  // GET /proof-status/:id only returns { state, isVerified, timestamp } — no
  // presentation data. Cheap to poll frequently, used just to detect "done."
  const checkProofStatus = useCallback(async () => {
    if (!proofRecordId) return null;
    const status = await getProofStatus(agentType, proofRecordId);
    if (status?.isVerified) return status;
    return null;
  }, [agentType, proofRecordId]);

  usePolling(checkProofStatus, async () => {
    if (!proofRecordId) return;
    // Verified per /proof-status, but the actual revealed attributes only
    // come from /proof-data — extractProofData() needs its `presentation`
    // field, which /proof-status never includes. One extra call here, only
    // once the cheap poll confirms verification, not on every poll tick.
    const data = await getProofData(agentType, proofRecordId);
    const parsed = extractProofData(data);
    if (!parsed) {
      setError('Verification succeeded but proof data could not be parsed');
      setState('failed');
      return;
    }
    setProofData(parsed);
    setState('verified');
  }, {
    enabled: state === 'polling',
    interval: 1000,
    timeout: 120000,
    onTimeout: () => {
      setError('Verification timed out');
      setState('failed');
    },
  });

  return { state, proofData, proofRecordId, error, requestVerification };
}
