'use client';
// Adapted from ShareProof.jsx — sends a proof request and displays the result.
import React, { useEffect, useRef } from 'react';
import { AgentType } from '../services/apiService';
import { useProofVerification } from '../hooks/useProofVerification';

interface ProofVerificationProps {
  agentType: AgentType;
  connectionId: string;
  proofLabel: string;
  onVerified: (attributes: Record<string, string>) => void;
  onNext?: () => void;
}

const ProofVerification = ({
  agentType,
  connectionId,
  proofLabel,
  onVerified,
  onNext,
}: ProofVerificationProps) => {
  const { state, proofData, error, requestVerification } = useProofVerification(agentType, connectionId);
  const requestSent = useRef(false);

  useEffect(() => {
    if (!requestSent.current && connectionId) {
      requestSent.current = true;
      requestVerification(proofLabel);
    }
  }, [connectionId]);

  useEffect(() => {
    if (state === 'verified' && proofData) {
      onVerified(proofData.revealedAttributes);
    }
  }, [state, proofData]);

  return (
    <div className="w-full max-w-xl mx-auto mt-10 bg-white rounded-xl shadow-md p-8">
      <h2 className="text-xl font-bold text-gray-800 mb-2">Proof Verification</h2>
      <p className="text-sm text-gray-500 mb-6">
        A proof request has been sent to your Bifold wallet. Please share your credential.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4">
          {error}
        </div>
      )}

      {(state === 'idle' || state === 'requesting' || state === 'polling') && (
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>{state === 'requesting' ? 'Sending proof request…' : 'Waiting for response…'}</span>
        </div>
      )}

      {state === 'verified' && proofData && (
        <div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-green-700 font-semibold">Verification successful</p>
          </div>

          <div className="space-y-2 mb-6">
            {Object.entries(proofData.revealedAttributes).map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm border-b pb-1">
                <span className="font-medium text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                <span className="text-gray-800">{value}</span>
              </div>
            ))}
            {proofData.predicates.map((pred, i) => (
              <div key={i} className="flex justify-between text-sm border-b pb-1">
                <span className="font-medium text-gray-600 capitalize">{pred.name}</span>
                <span className="text-gray-800">{pred.pType} {pred.value}</span>
              </div>
            ))}
          </div>

          {onNext && (
            <button
              onClick={onNext}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ProofVerification;
