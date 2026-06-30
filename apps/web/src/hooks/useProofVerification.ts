'use client';
import { useState, useCallback } from 'react';
import { AgentType, getProofStatus, sendProofRequest } from '../services/apiService';
import { extractProofData, ProofResult } from '../utils/proof-parser';
import { usePolling } from './usePolling';

export type VerificationState = 'idle' | 'requesting' | 'polling' | 'verified' | 'failed';

// Extracted from doctor/page.jsx lines 86–170.
// Handles: send proof request → poll proof-status → extract proof data → done.
export function useProofVerification(agentType: AgentType, connectionId: string | null) {
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
        const result = await sendProofRequest(agentType, connectionId, proofLabel);
        setProofRecordId(result.id);
        setState('polling');
      } catch (err: any) {
        setError(err.message);
        setState('failed');
      }
    },
    [agentType, connectionId]
  );

  const checkProofStatus = useCallback(async () => {
    if (!proofRecordId) return null;
    const status = await getProofStatus(agentType, proofRecordId);
    if (status?.isVerified) return status;
    return null;
  }, [agentType, proofRecordId]);

  usePolling(checkProofStatus, (status) => {
    const parsed = extractProofData(status);
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

  return { state, proofData, error, requestVerification };
}
