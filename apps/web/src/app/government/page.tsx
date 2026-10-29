'use client';

import { useState } from 'react';
import Link from 'next/link';
import ConnectionSetup from '@/components/ConnectionSetup';
import { issuePatientCredential } from '@/services/apiService';

interface PatientForm {
  name: string;
  age: string;
  email: string;
  nationalId: string;
  medicalCondition: string;
  bloodType: string;
  emergencyContact: string;
}

const EMPTY_FORM: PatientForm = {
  name: '',
  age: '',
  email: '',
  nationalId: '',
  medicalCondition: '',
  bloodType: '',
  emergencyContact: '',
};

export default function GovernmentPortal() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [form, setForm] = useState<PatientForm>(EMPTY_FORM);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; patientAccountId?: string; extendedProfileIssued?: boolean } | null>(null);

  const handleChange = (field: keyof PatientForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleIssue = async () => {
    if (!connectionId) return;
    setIssuing(true);
    setResult(null);
    try {
      const res = await issuePatientCredential(connectionId, form);
      // PoC convenience: this assumes the browser generating the QR is also
      // the patient's own device — saving here means the Patient Dashboard
      // (same localStorage key) can pick it up automatically in that case.
      // Only auto-save when nothing else is already saved, or it's the same
      // patient being re-issued to — never silently overwrite a DIFFERENT
      // patient's saved ID (found live 2026-07-25: issuing to a second
      // patient in the same browser session used to clobber the first
      // patient's saved ID with no warning, risking a shared/kiosk browser
      // later showing the wrong patient's dashboard).
      let skippedAutoSave = false;
      if (res.patientAccountId) {
        const existing = localStorage.getItem('meditrust-patient-did');
        if (!existing || existing === res.patientAccountId) {
          localStorage.setItem('meditrust-patient-did', res.patientAccountId);
        } else {
          skippedAutoSave = true;
        }
      }
      setResult({
        success: true,
        message:
          (res.isW3C
            ? 'Identity credential sent (structured message fallback — no live AnonCreds credDef on this network).'
            : 'Identity credential issued via AnonCreds.') +
          (res.extendedProfileCredentialId
            ? ' Medical condition, blood type, and emergency contact were issued as a separate extended-profile credential, so identity checks alone can never receive them.'
            : ' Note: the separate extended-profile credential (medical condition, blood type, emergency contact) was not issued this time — its credential definition was not available.') +
          (skippedAutoSave
            ? ' Note: a different patient ID was already saved in this browser, so it was NOT auto-loaded into the Patient Portal — copy the ID below manually if needed.'
            : ''),
        patientAccountId: res.patientAccountId,
        extendedProfileIssued: Boolean(res.extendedProfileCredentialId),
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
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-500">Issuer</span>
        <h1 className="text-3xl font-bold text-gray-900">Government Portal</h1>
        <p className="mt-1 text-gray-500">Connect with a patient's wallet and issue a verified identity credential.</p>
      </div>

      {!connectionId ? (
        <ConnectionSetup agentType="government" label="Government Identity Office" onConnected={setConnectionId} />
      ) : (
        <div className="animate-fadeIn rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Connected to wallet — connection <code className="font-mono text-xs">{connectionId.slice(0, 12)}…</code>
          </div>

          <h2 className="mb-4 text-lg font-semibold text-gray-900">Identity details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" value={form.name} onChange={handleChange('name')} />
            <Field label="Age" value={form.age} onChange={handleChange('age')} type="number" />
            <Field label="Email" value={form.email} onChange={handleChange('email')} type="email" />
            <Field label="National ID" value={form.nationalId} onChange={handleChange('nationalId')} />
            <Field label="Blood type" value={form.bloodType} onChange={handleChange('bloodType')} />
            <Field label="Emergency contact" value={form.emergencyContact} onChange={handleChange('emergencyContact')} />
            <div className="sm:col-span-2">
              <Field label="Medical condition" value={form.medicalCondition} onChange={handleChange('medicalCondition')} />
            </div>
          </div>

          <button
            onClick={handleIssue}
            disabled={issuing || !form.name}
            className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {issuing ? 'Issuing credential…' : 'Issue identity credential'}
          </button>

          {result && (
            <div
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              <p>{result.message}</p>
              {result.patientAccountId && (
                <div className="mt-3 rounded-lg bg-white/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Save this — you'll need it to view your own records
                  </p>
                  <code className="mt-1 block break-all font-mono text-sm text-emerald-900">
                    {result.patientAccountId}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Field({
  label, value, onChange, type = 'text',
}: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition-shadow duration-150 focus:ring-2 focus:ring-blue-400"
      />
    </label>
  );
}
