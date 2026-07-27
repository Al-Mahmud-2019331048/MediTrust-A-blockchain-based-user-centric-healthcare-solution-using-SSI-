'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ConnectionSetup from '@/components/ConnectionSetup';
import { issueMedicalCredential, issuePrescription, readPatientRecords, getAgentStatus, DocumentAttachment } from '@/services/apiService';
import { useProofVerification } from '@/hooks/useProofVerification';
import { RecordCard, RECORD_TYPE_LABELS } from '@/components/RecordCard';
import type { DWNRecordSummary } from '@/services/dwnService';

interface PatientIdentity {
  patientAccountId: string;
  identityVerified: boolean;
  // The doctor-agent independently re-verifies this against its own proof
  // records rather than trusting identityVerified as sent — required for
  // identityVerified to actually be honored server-side; see
  // agents/doctor-agent/src/routes/medical-routes.ts's verifyIdentityProof.
  proofRecordId?: string;
  autoName?: string;
  autoPatientId?: string;
}

type DocType = 'medical' | 'prescription';

interface DocForm {
  patientName: string;
  patientId: string;
  diagnosis: string;
  prescription: string;
}

const EMPTY_FORM: DocForm = { patientName: '', patientId: '', diagnosis: '', prescription: '' };

const ACCEPTED_ATTACHMENT_TYPES: Record<string, DocumentAttachment['contentType']> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
};

// Server-side body limit is 25mb (base64 inflates ~33% over raw bytes) —
// stay comfortably under that.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // reader.result is a data: URL ("data:application/pdf;base64,AAAA...") — strip the prefix.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Between "connected" and "issue" — requests a proof against the patient's
// identity credential (revealing patientAccountId, the stable identifier
// minted at issuance, plus name/nationalId for auto-fill). Real verification
// will fail on a ledger-blocked network — the "enter manually" fallback is
// deliberately gated behind that failure rather than always visible, so it
// doesn't quietly recreate the same unverified-free-text problem this step
// exists to close.
function PatientVerificationPanel({
  connectionId, onResolved,
}: { connectionId: string; onResolved: (identity: PatientIdentity) => void }) {
  const { state, proofData, proofRecordId, error, requestVerification } = useProofVerification('doctor', connectionId);
  const requestSent = useRef(false);
  const [manualId, setManualId] = useState('');
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    if (!requestSent.current) {
      requestSent.current = true;
      requestVerification('doctor-identity-verification');
    }
  }, []);

  useEffect(() => {
    if (state === 'verified' && proofData) {
      const attrs = proofData.revealedAttributes;
      if (attrs.patientAccountId) {
        onResolved({
          patientAccountId: attrs.patientAccountId,
          identityVerified: true,
          proofRecordId: proofRecordId ?? undefined,
          autoName: attrs.name,
          autoPatientId: attrs.nationalId,
        });
      }
    }
  }, [state, proofData, proofRecordId]);

  return (
    <div className="mb-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Verify patient identity</p>

      {(state === 'idle' || state === 'requesting' || state === 'polling') && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          Requesting proof from patient's identity credential…
        </div>
      )}

      {state === 'verified' && proofData?.revealedAttributes.patientAccountId && (
        <p className="text-sm text-emerald-700">✓ Identity verified — patient account confirmed.</p>
      )}

      {state === 'verified' && proofData && !proofData.revealedAttributes.patientAccountId && (
        <p className="text-sm text-amber-700">
          Proof verified, but no patientAccountId was revealed (identity credential predates this feature or lacks the attribute).
          <button onClick={() => setShowManual(true)} className="ml-2 underline">Enter manually instead</button>
        </p>
      )}

      {state === 'failed' && !showManual && (
        <div className="text-sm">
          <p className="text-red-600">Verification unavailable{error ? `: ${error}` : ''} — expected on a ledger-blocked network.</p>
          <button
            onClick={() => setShowManual(true)}
            className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
          >
            Enter Patient Account ID manually
          </button>
        </div>
      )}

      {showManual && (
        <div className="mt-2 flex gap-2">
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Patient Account ID"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={() => manualId.trim() && onResolved({ patientAccountId: manualId.trim(), identityVerified: false })}
            disabled={!manualId.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Continue unverified
          </button>
        </div>
      )}
    </div>
  );
}

type RecordTypeFilter = 'all' | 'medical' | 'prescription' | 'lab_report';

// Reads a patient's records straight from their DWN — the read counterpart
// to the issuance flow above, using this doctor's own DID as the requester
// (same DWN-selective-sharing pathway the Pharmacy Portal's DWN-read panel
// uses). Only shows what the patient has actually granted this doctor
// access to; an empty result reads as "nothing granted yet," not an error.
function PatientRecordsPanel({ patientDID }: { patientDID: string }) {
  const [filter, setFilter] = useState<RecordTypeFilter>('all');
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<DWNRecordSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctorDid, setDoctorDid] = useState<string | null>(null);

  useEffect(() => {
    getAgentStatus('doctor').then((status) => setDoctorDid(status?.agentDid ?? null));
  }, []);

  // Accepts an explicit filter override so filter-chip clicks can pass the
  // new value directly, instead of reading `filter` from closure state —
  // setFilter() is async/batched, so reading `filter` right after calling it
  // would still see the OLD value. Previously the chips only called
  // setFilter() and never refetched at all, leaving the displayed records
  // unfiltered (and visually inconsistent with the highlighted chip) until
  // the separate "Refresh" button was clicked.
  const load = async (filterOverride?: RecordTypeFilter) => {
    const effectiveFilter = filterOverride ?? filter;
    setLoading(true);
    setError(null);
    try {
      const result = await readPatientRecords(patientDID, effectiveFilter === 'all' ? undefined : effectiveFilter);
      setRecords(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'medical', 'prescription', 'lab_report'] as RecordTypeFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setFilter(t);
              if (records) load(t);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
              filter === t ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'all' ? 'All types' : RECORD_TYPE_LABELS[t]}
          </button>
        ))}
        <button
          onClick={() => load()}
          disabled={loading}
          className="ml-auto rounded-lg bg-emerald-100 px-4 py-1.5 text-sm font-medium text-emerald-700 transition-colors duration-200 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Loading…' : records ? 'Refresh' : 'Load records'}
        </button>
      </div>

      {doctorDid && (
        <p className="mb-4 text-xs text-gray-400">
          Reads as <code className="font-mono">{doctorDid.slice(0, 24)}…</code> — the patient must grant this DID
          access via the Patient Portal&rsquo;s Consent Manager before any records appear here.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {records && records.length === 0 && !error && (
        <p className="text-sm text-gray-400">No records visible — nothing has been granted to this doctor yet for this type.</p>
      )}
      {records && records.length > 0 && (
        <ul className="space-y-3">
          {records.map((r) => (
            <RecordCard key={r.recordId} record={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DoctorPortal() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [patientIdentity, setPatientIdentity] = useState<PatientIdentity | null>(null);
  const [viewMode, setViewMode] = useState<'issue' | 'records'>('issue');
  const [docType, setDocType] = useState<DocType>('medical');
  const [form, setForm] = useState<DocForm>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; dwnRecordId?: string; dwnAttachmentRecordId?: string } | null>(null);

  const handleChange = (field: keyof DocForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleIdentityResolved = (identity: PatientIdentity) => {
    setPatientIdentity(identity);
    setForm((f) => ({
      ...f,
      patientName: identity.autoName ?? f.patientName,
      patientId: identity.autoPatientId ?? identity.patientAccountId,
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFileError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_ATTACHMENT_TYPES[selected.type]) {
      setFileError('Only PDF, JPEG, or PNG files are accepted.');
      setFile(null);
      return;
    }
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      setFileError(`File is too large (${(selected.size / 1024 / 1024).toFixed(1)}MB) — max 15MB.`);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleIssue = async () => {
    if (!connectionId || !patientIdentity) return;
    setIssuing(true);
    setResult(null);
    try {
      const documentId = `${docType}-${Date.now()}`;

      let attachment: DocumentAttachment | undefined;
      if (file) {
        attachment = {
          contentType: ACCEPTED_ATTACHMENT_TYPES[file.type],
          fileName: file.name,
          data: await fileToBase64(file),
        };
      }

      const identity = {
        patientDID: patientIdentity.patientAccountId,
        identityVerified: patientIdentity.identityVerified,
        proofRecordId: patientIdentity.proofRecordId,
      };

      const res =
        docType === 'medical'
          ? await issueMedicalCredential(connectionId, {
              documentId,
              documentType: 'medical_record',
              patientName: form.patientName,
              patientId: form.patientId,
              diagnosis: form.diagnosis,
              prescription: form.prescription,
              issuedBy: 'doctor-agent',
            }, attachment, identity)
          : await issuePrescription(connectionId, {
              documentId,
              patientName: form.patientName,
              patientId: form.patientId,
              diagnosis: form.diagnosis,
              prescription: form.prescription,
            }, attachment, identity);

      setResult({
        success: true,
        message:
          res.credentialType === 'StructuredMessage'
            ? 'Document sent (structured message fallback — no live AnonCreds credDef on this network).'
            : 'Credential issued via AnonCreds.',
        dwnRecordId: res.dwnRecordId,
        dwnAttachmentRecordId: res.dwnAttachmentRecordId,
      });
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setIssuing(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">&larr; Back</Link>
      <div className="mt-2 mb-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500">Issuer</span>
        <h1 className="text-3xl font-bold text-gray-900">Doctor Portal</h1>
        <p className="mt-1 text-gray-500">
          Connect with a patient's wallet, issue a medical record or prescription, and write it to their DWN vault.
        </p>
      </div>

      {!connectionId ? (
        <ConnectionSetup agentType="doctor" label="Doctor Agent" onConnected={setConnectionId} />
      ) : !patientIdentity ? (
        <div className="animate-fadeIn rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Connected to wallet — connection <code className="font-mono text-xs">{connectionId.slice(0, 12)}…</code>
          </div>
          <PatientVerificationPanel connectionId={connectionId} onResolved={handleIdentityResolved} />
        </div>
      ) : (
        <div className="animate-fadeIn rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Connected to wallet — connection <code className="font-mono text-xs">{connectionId.slice(0, 12)}…</code>
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                patientIdentity.identityVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {patientIdentity.identityVerified ? 'Identity verified' : 'Unverified (manual ID)'}
            </span>
          </div>

          <div className="mb-6 flex gap-2 border-b border-gray-100 pb-4">
            {(['issue', 'records'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200 ${
                  viewMode === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {m === 'issue' ? 'Issue record' : 'View records'}
              </button>
            ))}
          </div>

          {viewMode === 'records' ? (
            <PatientRecordsPanel patientDID={patientIdentity.patientAccountId} />
          ) : (
            <>
              <div className="mb-6 flex gap-2">
                {(['medical', 'prescription'] as DocType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDocType(t)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200 ${
                      docType === t ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t === 'medical' ? 'Medical record' : 'Prescription'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Patient name" value={form.patientName} onChange={handleChange('patientName')} />
                <Field label="Patient ID" value={form.patientId} onChange={handleChange('patientId')} />
                <div className="sm:col-span-2">
                  <Field label="Diagnosis" value={form.diagnosis} onChange={handleChange('diagnosis')} />
                </div>
                <div className="sm:col-span-2">
                  <Field label="Prescription" value={form.prescription} onChange={handleChange('prescription')} />
                </div>
              </div>

              <div className="mt-4">
                <span className="mb-1 block text-xs font-medium text-gray-500">Attach a file (optional)</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
                />
                {file && !fileError && (
                  <p className="mt-1 text-xs text-gray-500">{file.name} ({(file.size / 1024).toFixed(0)}KB)</p>
                )}
                {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
              </div>

              <button
                onClick={handleIssue}
                disabled={issuing || !form.patientName}
                className="mt-6 w-full rounded-lg bg-emerald-600 py-3 font-medium text-white transition-colors duration-200 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {issuing ? 'Issuing…' : `Issue ${docType === 'medical' ? 'medical record' : 'prescription'}`}
              </button>

              {result && (
                <div
                  className={`mt-4 space-y-1 rounded-lg px-4 py-3 text-sm ${
                    result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  <p>{result.message}</p>
                  {result.dwnRecordId && (
                    <p className="text-xs text-emerald-600">
                      Written to patient DWN — record <code className="font-mono">{result.dwnRecordId}</code>
                    </p>
                  )}
                  {result.dwnAttachmentRecordId && (
                    <p className="text-xs text-emerald-600">
                      File attached to vault — record <code className="font-mono">{result.dwnAttachmentRecordId}</code>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}

function Field({
  label, value, onChange,
}: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        value={value}
        onChange={onChange}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition-shadow duration-150 focus:ring-2 focus:ring-emerald-400"
      />
    </label>
  );
}
