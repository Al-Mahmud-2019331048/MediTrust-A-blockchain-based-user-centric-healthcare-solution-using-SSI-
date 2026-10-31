'use client';

import { useState } from 'react';
import Link from 'next/link';
import ConnectionSetup from '@/components/ConnectionSetup';
import {
  issuePatientCredential,
  startIdentityVerification,
  confirmIdentityVerification,
  VerifiedCitizen,
} from '@/services/apiService';

// Self-declared fields only — name, age and National ID come from the
// government's own records once the patient's phone is verified.
interface ProfileForm {
  email: string;
  medicalCondition: string;
  bloodType: string;
  emergencyContact: string;
}

const EMPTY_PROFILE: ProfileForm = {
  email: '',
  medicalCondition: '',
  bloodType: '',
  emergencyContact: '',
};

type Step = 'identify' | 'code' | 'issue';

export default function GovernmentPortal() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('identify');
  const [nationalId, setNationalId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [code, setCode] = useState('');
  const [citizen, setCitizen] = useState<VerifiedCitizen | null>(null);
  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string; patientAccountId?: string; extendedProfileIssued?: boolean } | null>(null);

  const handleProfileChange = (field: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleSendCode = async () => {
    if (!connectionId) return;
    setBusy(true);
    setStepError(null);
    try {
      const res = await startIdentityVerification(connectionId, nationalId.trim(), phoneNumber.trim());
      setVerificationId(res.verificationId);
      setMaskedPhone(res.maskedPhone);
      setCode('');
      setStep('code');
    } catch (err) {
      setStepError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCode = async () => {
    if (!verificationId) return;
    setBusy(true);
    setStepError(null);
    try {
      setCitizen(await confirmIdentityVerification(verificationId, code.trim()));
      setStep('issue');
    } catch (err) {
      setStepError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartOver = () => {
    setStep('identify');
    setVerificationId(null);
    setCode('');
    setCitizen(null);
    setStepError(null);
    setResult(null);
  };

  const handleIssue = async () => {
    if (!connectionId || !verificationId) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await issuePatientCredential(connectionId, verificationId, profile);
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
      setBusy(false);
    }
  };

  const issued = result?.success === true;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">&larr; Back</Link>
      <div className="mt-2 mb-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-blue-500">Issuer</span>
        <h1 className="text-3xl font-bold text-gray-900">Government Portal</h1>
        <p className="mt-1 text-gray-500">Connect with a patient's wallet, verify who they are, and issue an identity credential.</p>
      </div>

      {!connectionId ? (
        <ConnectionSetup agentType="government" label="Government Identity Office" onConnected={setConnectionId} />
      ) : (
        <div className="animate-fadeIn rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Connected to wallet — connection <code className="font-mono text-xs">{connectionId.slice(0, 12)}…</code>
          </div>

          <StepIndicator step={step} />

          {step === 'identify' && (
            <section>
              <h2 className="mb-1 text-lg font-semibold text-gray-900">Verify identity</h2>
              <p className="mb-4 text-sm text-gray-500">
                Enter your National ID and one phone number registered to it. A one-time code will be sent to that number.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="National ID" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
                <Field label="Registered phone number" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} type="tel" placeholder="01XXXXXXXXX" />
              </div>
              <button
                onClick={handleSendCode}
                disabled={busy || !nationalId.trim() || !phoneNumber.trim()}
                className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {busy ? 'Checking…' : 'Send verification code'}
              </button>
            </section>
          )}

          {step === 'code' && (
            <section>
              <h2 className="mb-1 text-lg font-semibold text-gray-900">Enter the code</h2>
              <p className="mb-4 text-sm text-gray-500">
                A 6-digit code was sent to <span className="font-mono">{maskedPhone}</span>. It expires in 5 minutes.
              </p>
              <a
                href={`/sms-inbox?phone=${encodeURIComponent(phoneNumber.trim())}`}
                target="_blank"
                rel="noreferrer"
                className="mb-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Open simulated SMS inbox &rarr;
              </a>
              <Field
                label="Verification code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
              />
              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleStartOver}
                  disabled={busy}
                  className="rounded-lg px-4 py-3 text-sm font-medium text-gray-600 ring-1 ring-gray-200 transition-colors duration-200 hover:bg-gray-50"
                >
                  Start over
                </button>
                <button
                  onClick={handleConfirmCode}
                  disabled={busy || code.length !== 6}
                  className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {busy ? 'Verifying…' : 'Verify code'}
                </button>
              </div>
            </section>
          )}

          {step === 'issue' && citizen && (
            <section>
              <div className="mb-6 rounded-lg bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Verified from government records</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-blue-600">Name</dt><dd className="font-medium text-gray-900">{citizen.name}</dd></div>
                  <div><dt className="text-xs text-blue-600">Age</dt><dd className="font-medium text-gray-900">{citizen.age}</dd></div>
                  <div><dt className="text-xs text-blue-600">National ID</dt><dd className="font-mono text-gray-900">{citizen.nationalId}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-blue-600">These can't be edited — they come from the National ID record.</p>
              </div>

              <h2 className="mb-1 text-lg font-semibold text-gray-900">Additional details</h2>
              <p className="mb-4 text-sm text-gray-500">Provided by the patient. These are not checked against any government record.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email" value={profile.email} onChange={handleProfileChange('email')} type="email" disabled={issued} />
                <Field label="Blood type" value={profile.bloodType} onChange={handleProfileChange('bloodType')} disabled={issued} />
                <Field label="Emergency contact" value={profile.emergencyContact} onChange={handleProfileChange('emergencyContact')} disabled={issued} />
                <Field label="Medical condition" value={profile.medicalCondition} onChange={handleProfileChange('medicalCondition')} disabled={issued} />
              </div>

              <button
                onClick={handleIssue}
                disabled={busy || issued}
                className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {busy ? 'Issuing credential…' : issued ? 'Credential issued' : 'Issue identity credential'}
              </button>
              {result && !result.success && (
                <button onClick={handleStartOver} className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">
                  Verification expired or failed? Start over
                </button>
              )}
            </section>
          )}

          {stepError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{stepError}</p>}

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

const STEPS: { key: Step; label: string }[] = [
  { key: 'identify', label: 'National ID & phone' },
  { key: 'code', label: 'Verify code' },
  { key: 'issue', label: 'Issue credential' },
];

function StepIndicator({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold ${
              i < current ? 'bg-emerald-500 text-white' : i === current ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </span>
          <span className={i === current ? 'font-medium text-gray-900' : 'text-gray-400'}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, inputMode, disabled,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition-shadow duration-150 focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
      />
    </label>
  );
}
