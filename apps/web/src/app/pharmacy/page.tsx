'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ConnectionSetup from '@/components/ConnectionSetup';
import {
  verifyPatientIdentity, verifyPrescription, readPrescriptionFromDWN, getAgentStatus,
  DWNPrescriptionRecord,
} from '@/services/apiService';
import { useProofVerification } from '@/hooks/useProofVerification';

interface PatientIdentity {
  patientAccountId: string;
  autoName?: string;
  autoNationalId?: string;
}

const LABEL_OVERRIDES: Record<string, string> = {
  documentId: 'Document ID',
  documentType: 'Document type',
  documentHash: 'Document hash',
  patientName: 'Patient name',
  issuedBy: 'Issued by',
  issuedAt: 'Issued at',
};

function humanizeFieldName(key: string): string {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function humanizeFieldValue(key: string, value: unknown): string {
  if ((key === 'issuedAt' || key.endsWith('At')) && typeof value === 'string' && !isNaN(Date.parse(value))) {
    return new Date(value).toLocaleString();
  }
  return String(value);
}

// Identical shape to Doctor Portal's PatientVerificationPanel — requests the
// government-issued identity credential, revealing patientAccountId (the
// stable DWN patientDID) via pharmacy-agent's own /verify-patient-identity
// route rather than the generic /send-proof-request.
function IdentityPanel({
  connectionId, onResolved,
}: { connectionId: string; onResolved: (identity: PatientIdentity) => void }) {
  const { state, proofData, error, requestVerification } = useProofVerification(
    'pharmacist', connectionId, (cid) => verifyPatientIdentity(cid)
  );
  const requestSent = useRef(false);

  useEffect(() => {
    if (!requestSent.current) {
      requestSent.current = true;
      requestVerification('patient-identity-verification');
    }
  }, []);

  useEffect(() => {
    if (state === 'verified' && proofData?.revealedAttributes.patientAccountId) {
      onResolved({
        patientAccountId: proofData.revealedAttributes.patientAccountId,
        autoName: proofData.revealedAttributes.name,
        autoNationalId: proofData.revealedAttributes.nationalId,
      });
    }
  }, [state, proofData]);

  return (
    <div className="mb-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Verify patient identity</p>

      {(state === 'idle' || state === 'requesting' || state === 'polling') && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          Requesting identity proof from patient&rsquo;s wallet…
        </div>
      )}

      {state === 'verified' && proofData?.revealedAttributes.patientAccountId && (
        <p className="text-sm text-emerald-700">✓ Identity verified — patient account confirmed.</p>
      )}

      {state === 'verified' && proofData && !proofData.revealedAttributes.patientAccountId && (
        <p className="text-sm text-amber-700">
          Proof verified, but no patientAccountId was revealed (identity credential predates this feature).
        </p>
      )}

      {state === 'failed' && (
        <p className="text-sm text-red-600">Verification unavailable{error ? `: ${error}` : ''} — expected on a ledger-blocked network.</p>
      )}
    </div>
  );
}

// Pathway 1 (existing): ask the wallet to present a ZKP proof of the
// doctor-issued prescription credential — no DWN involved at all.
function ZkpPrescriptionPanel({ connectionId }: { connectionId: string }) {
  const { state, proofData, error, requestVerification } = useProofVerification(
    'pharmacist', connectionId, (cid) => verifyPrescription(cid)
  );

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Wallet proof (ZKP)</p>
        {state === 'idle' && (
          <button
            onClick={() => requestVerification('prescription-verification')}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
          >
            Request proof
          </button>
        )}
      </div>

      {(state === 'requesting' || state === 'polling') && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          Waiting for the patient&rsquo;s wallet to respond…
        </div>
      )}

      {state === 'verified' && proofData && (
        <dl className="space-y-1 text-sm">
          {Object.entries(proofData.revealedAttributes).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4">
              <dt className="text-gray-500">{humanizeFieldName(key)}</dt>
              <dd className="text-right text-gray-900">{humanizeFieldValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {state === 'failed' && (
        <p className="text-sm text-red-600">Verification unavailable{error ? `: ${error}` : ''} — expected on a ledger-blocked network.</p>
      )}
    </div>
  );
}

// Pathway 2 (new): read the prescription straight from the patient's DWN,
// using PHARMACY_DID as the requester. Only succeeds once the patient has
// granted PHARMACY_DID access via the Patient Portal's Consent Manager —
// completely independent of the ZKP pathway above.
function DwnPrescriptionPanel({ patientDID, pharmacyDid }: { patientDID: string; pharmacyDid: string | null }) {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<DWNPrescriptionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRead = async () => {
    setLoading(true);
    setError(null);
    setRecords(null);
    try {
      const result = await readPrescriptionFromDWN(patientDID);
      setRecords(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">DWN vault read</p>
        <button
          onClick={handleRead}
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? 'Reading…' : 'Read from DWN'}
        </button>
      </div>

      {pharmacyDid && (
        <p className="mb-2 text-xs text-gray-400">
          Reads as <code className="font-mono">{pharmacyDid.slice(0, 24)}…</code> — the patient must have granted this DID
          access to their prescription records via the Patient Portal&rsquo;s Consent Manager first.
        </p>
      )}

      {records && records.length === 0 && (
        <p className="text-sm text-gray-500">No prescription records found for this patient.</p>
      )}

      {records && records.length > 0 && (
        <div className="space-y-3">
          {records.map((record) => (
            <div key={record.recordId} className="rounded-lg bg-gray-50 p-3">
              <p className="mb-2 text-xs text-gray-400">{new Date(record.createdAt).toLocaleString()}</p>
              {typeof record.data === 'string' ? (
                <p className="text-sm text-gray-700">{record.data}</p>
              ) : (
                <dl className="space-y-1 text-sm">
                  {Object.entries(record.data).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-4">
                      <dt className="text-gray-500">{humanizeFieldName(key)}</dt>
                      <dd className="text-right text-gray-900">{humanizeFieldValue(key, value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600">
          {error.includes('403') ? 'Access denied — the patient hasn’t granted this pharmacy access yet.' : error}
        </p>
      )}
    </div>
  );
}

export default function PharmacyPortal() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [patientIdentity, setPatientIdentity] = useState<PatientIdentity | null>(null);
  const [pharmacyDid, setPharmacyDid] = useState<string | null>(null);

  useEffect(() => {
    getAgentStatus('pharmacist').then((status) => setPharmacyDid(status?.agentDid ?? null));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">&larr; Back</Link>
      <div className="mt-2 mb-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-500">Verifier</span>
        <h1 className="text-3xl font-bold text-gray-900">Pharmacy Portal</h1>
        <p className="mt-1 text-gray-500">
          Verify a patient&rsquo;s identity and prescription, either as a wallet-presented proof or read straight from their DWN vault.
        </p>
      </div>

      {!connectionId ? (
        <ConnectionSetup agentType="pharmacist" label="Pharmacy Agent" isVerifier onConnected={setConnectionId} />
      ) : !patientIdentity ? (
        <div className="animate-fadeIn rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-700">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            Connected to wallet — connection <code className="font-mono text-xs">{connectionId.slice(0, 12)}…</code>
          </div>
          <IdentityPanel connectionId={connectionId} onResolved={setPatientIdentity} />
        </div>
      ) : (
        <div className="animate-fadeIn rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-700">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            Verified: {patientIdentity.autoName ?? patientIdentity.patientAccountId}
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Identity verified
            </span>
          </div>

          <p className="mb-4 text-sm font-medium text-gray-700">Verify prescription — two independent pathways:</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ZkpPrescriptionPanel connectionId={connectionId} />
            <DwnPrescriptionPanel patientDID={patientIdentity.patientAccountId} pharmacyDid={pharmacyDid} />
          </div>
        </div>
      )}
    </main>
  );
}
