'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  queryRecords, shareRecord, revokeAccess, initiateSelfCustody, restoreSelfCustody,
  getMekStatus, restoreData, getSigningKeyStatus, DWNRecordSummary, SelfCustodyShare,
} from '@/services/dwnService';
import { RecordCard } from '@/components/RecordCard';

export default function PatientDashboard() {
  const [patientDID, setPatientDID] = useState('');
  const [activeDID, setActiveDID] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('meditrust-patient-did');
    if (saved) {
      setPatientDID(saved);
      setActiveDID(saved);
    }
  }, []);

  const connect = () => {
    if (!patientDID.trim()) return;
    localStorage.setItem('meditrust-patient-did', patientDID.trim());
    setActiveDID(patientDID.trim());
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">&larr; Back</Link>
      <div className="mt-2 mb-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-500">Data Owner</span>
        <h1 className="text-3xl font-bold text-gray-900">Patient Dashboard</h1>
        <p className="mt-1 text-gray-500">
          View your DWN-stored records, manage who has consent, and back up your key recovery shares.
        </p>
      </div>

      {!activeDID ? (
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
          <p className="mb-3 text-sm text-gray-500">
            Enter your Patient Account ID — the identifier shown when your identity credential was first issued at
            the Government Portal. It stays the same across every visit and every connection, unlike a raw
            connection ID.
          </p>
          <div className="flex gap-2">
            <input
              value={patientDID}
              onChange={(e) => setPatientDID(e.target.value)}
              placeholder="Patient Account ID"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button
              onClick={connect}
              className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-violet-700"
            >
              Open
            </button>
          </div>
        </div>
      ) : (
        <div className="animate-fadeIn space-y-8">
          <div className="flex items-center justify-between rounded-lg bg-violet-50 px-4 py-3 text-sm text-violet-700">
            <BlurredDID did={activeDID} />
            <button
              onClick={() => { localStorage.removeItem('meditrust-patient-did'); setActiveDID(null); }}
              className="text-xs text-violet-500 underline hover:text-violet-700"
            >
              switch
            </button>
          </div>

          <RecordsPanel patientDID={activeDID} />
          <ConsentPanel patientDID={activeDID} />
          <KeyRecoveryPanel patientDID={activeDID} />
        </div>
      )}
    </main>
  );
}

function BlurredDID({ did }: { did: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span>
      Viewing account{' '}
      <button
        onClick={() => setRevealed((v) => !v)}
        title={revealed ? 'Click to hide' : 'Click to reveal'}
        className="rounded font-mono text-xs transition-[filter] duration-150"
        style={{ filter: revealed ? 'none' : 'blur(4px)' }}
      >
        {did}
      </button>
      {!revealed && <span className="ml-1.5 text-[11px] text-violet-400">(tap to reveal)</span>}
    </span>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RecordsPanel({ patientDID }: { patientDID: string }) {
  const [records, setRecords] = useState<DWNRecordSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await queryRecords(patientDID));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [patientDID]);

  return (
    <Card title="Your records" subtitle="Encrypted at rest in your DWN vault — decrypted only for you, the owner.">
      <button
        onClick={load}
        disabled={loading}
        className="mb-4 rounded-lg bg-violet-100 px-4 py-1.5 text-sm font-medium text-violet-700 transition-colors duration-200 hover:bg-violet-200"
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && records.length === 0 && !loading && (
        <p className="text-sm text-gray-400">No records yet — issue one from the Doctor Portal.</p>
      )}
      <ul className="space-y-3">
        {records.map((r) => (
          <RecordCard key={r.recordId} record={r} />
        ))}
      </ul>
    </Card>
  );
}

function ConsentPanel({ patientDID }: { patientDID: string }) {
  const [grantedToDID, setGrantedToDID] = useState('');
  const [recordType, setRecordType] = useState('medical');
  const [purpose, setPurpose] = useState('treatment');
  const [status, setStatus] = useState<string | null>(null);

  const grant = async () => {
    if (!grantedToDID.trim()) return;
    setStatus(null);
    try {
      await shareRecord({ patientDID, grantedToDID: grantedToDID.trim(), recordType, purpose });
      setStatus('Access granted.');
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  const revoke = async () => {
    if (!grantedToDID.trim()) return;
    setStatus(null);
    try {
      await revokeAccess({ patientDID, grantedToDID: grantedToDID.trim(), recordType });
      setStatus('Access revoked.');
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <Card title="Consent management" subtitle="Grant or revoke another party's access to a record type.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          value={grantedToDID}
          onChange={(e) => setGrantedToDID(e.target.value)}
          placeholder="Grantee DID"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400"
        />
        <select
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400"
        >
          <option value="medical">medical</option>
          <option value="prescription">prescription</option>
          <option value="lab_report">lab_report</option>
        </select>
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Purpose"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400"
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={grant}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-violet-700"
        >
          Grant access
        </button>
        <button
          onClick={revoke}
          className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition-colors duration-200 hover:bg-red-100"
        >
          Revoke access
        </button>
      </div>
      {status && <p className="mt-3 text-sm text-gray-600">{status}</p>}
    </Card>
  );
}

const HOLDER_LABELS: Record<SelfCustodyShare['holder'], string> = {
  primary_device: 'Your phone',
  paper_backup: 'Printed paper backup',
  secondary_device: 'A second device',
};

const HOLDER_INSTRUCTIONS: Record<SelfCustodyShare['holder'], string> = {
  primary_device: 'Save this on your phone — e.g. in a notes app or password manager.',
  paper_backup: 'Print this or write it down, and store it somewhere safe, like a drawer or a safe.',
  secondary_device: 'Save this on a second device you own — a tablet, laptop, or another phone.',
};

function ShareCard({ share }: { share: SelfCustodyShare }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const text = JSON.stringify(share);

  const copy = async () => {
    // This share is security-sensitive recovery material the UI explicitly
    // warns "won't be shown again" — a silent clipboard failure (denied
    // permission, or an insecure-origin restriction, both plausible during
    // phone/LAN testing over plain HTTP per this project's setup) must never
    // look identical to a successful copy.
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 3000);
    }
  };

  return (
    <li className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800">{HOLDER_LABELS[share.holder]}</p>
        <button
          onClick={copy}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
            copyFailed ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'
          }`}
        >
          {copyFailed ? 'Copy failed — select text below' : copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">{HOLDER_INSTRUCTIONS[share.holder]}</p>
      <textarea
        readOnly
        value={text}
        className="mt-2 h-14 w-full resize-none rounded bg-gray-50 p-1.5 font-mono text-[10px] text-gray-400"
      />
    </li>
  );
}

function isValidShare(value: unknown): value is SelfCustodyShare {
  const v = value as Partial<SelfCustodyShare> | null;
  return (
    !!v && typeof v === 'object' &&
    typeof v.shareId === 'string' &&
    typeof v.shareIndex === 'number' &&
    typeof v.shareData === 'string' &&
    (v.holder === 'primary_device' || v.holder === 'paper_backup' || v.holder === 'secondary_device')
  );
}

function RestoreShareBox({
  index, value, onChange,
}: { index: number; value: string; onChange: (v: string) => void }) {
  let parsed: SelfCustodyShare | null = null;
  let invalid = false;
  if (value.trim()) {
    try {
      const j = JSON.parse(value);
      if (isValidShare(j)) parsed = j;
      else invalid = true;
    } catch {
      invalid = true;
    }
  }

  return (
    <div className="mb-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Paste share ${index + 1} here`}
        className={`h-16 w-full resize-none rounded-lg border p-2 font-mono text-[10px] outline-none focus:ring-2 ${
          parsed ? 'border-emerald-300 focus:ring-emerald-400' : invalid ? 'border-red-300 focus:ring-red-400' : 'border-gray-200 focus:ring-violet-400'
        }`}
      />
      <p className={`mt-0.5 text-[11px] ${parsed ? 'text-emerald-600' : invalid ? 'text-red-500' : 'text-gray-400'}`}>
        {parsed
          ? `✓ Recognized — ${HOLDER_LABELS[parsed.holder]}`
          : invalid
            ? '✗ Not a recognizable share — check you copied the whole thing'
            : 'Waiting for a share…'}
      </p>
    </div>
  );
}

function SigningKeySection({ patientDID }: { patientDID: string }) {
  const [status, setStatus] = useState<{ hasKey: boolean; publicKeyFingerprint: string | null } | null>(null);

  useEffect(() => {
    getSigningKeyStatus(patientDID).then(setStatus).catch(() => setStatus(null));
  }, [patientDID]);

  const formatted = status?.publicKeyFingerprint
    ? status.publicKeyFingerprint.match(/.{1,4}/g)?.join(' ')
    : null;

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-700">Your signing key</h3>
      <p className="mb-2 text-xs text-gray-500">
        Proves that actions like granting access or restoring data were really done by you. The private half never
        leaves this device unencrypted and is never shown — only its public fingerprint below is safe to display.
      </p>
      {status === null && <p className="text-xs text-gray-400">Loading…</p>}
      {status && !status.hasKey && (
        <p className="text-xs text-amber-600">No signing key yet — one is created automatically the first time you take an action.</p>
      )}
      {status?.hasKey && formatted && (
        <p className="rounded bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-600">{formatted}…</p>
      )}
    </div>
  );
}

function KeyRecoveryPanel({ patientDID }: { patientDID: string }) {
  const [hasMEK, setHasMEK] = useState<boolean | null>(null);
  const [shares, setShares] = useState<SelfCustodyShare[] | null>(null);
  const [restoreInput, setRestoreInput] = useState(['', '']);
  const [status, setStatus] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const refreshStatus = async () => {
    try {
      const s = await getMekStatus(patientDID);
      setHasMEK(s.hasMEK);
    } catch {
      setHasMEK(null);
    }
  };

  useEffect(() => { refreshStatus(); }, [patientDID]);

  const setup = async () => {
    setStatus(null);
    try {
      const res = await initiateSelfCustody(patientDID);
      setShares(res.shares);
      setStatus(`Split your key into ${res.total} shares (any ${res.threshold} recover it) in ${res.splitTimeMs}ms. Save all ${res.total} now — they won't be shown again.`);
      refreshStatus();
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  const validShares = restoreInput
    .map((v) => { try { const j = JSON.parse(v); return isValidShare(j) ? j : null; } catch { return null; } })
    .filter((s): s is SelfCustodyShare => s !== null);
  // Distinct shareIds only — pasting the same share into both boxes shouldn't
  // count as 2 toward the threshold.
  const distinctValidCount = new Set(validShares.map((s) => s.shareId)).size;
  const canRestore = distinctValidCount >= 2;

  const restore = async () => {
    if (!canRestore) return;
    setStatus(null);
    setRestoring(true);
    try {
      await restoreSelfCustody(patientDID, validShares);
      setStatus('Key recovered — restoring data next…');
      const res = await restoreData(patientDID);
      setStatus(`Key recovered and data restored: ${res.recordsRestored} records, ${res.permissionsRestored} permissions.`);
      refreshStatus();
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Card
      title="Key recovery & backup"
      subtitle="Self-custody: your key is split 3 ways across your own devices/paper backup — any 2 recover it. Your data is backed up incrementally on every write."
    >
      <p className="mb-4 text-sm">
        Local key status:{' '}
        {hasMEK === null ? '…' : hasMEK ? (
          <span className="font-medium text-emerald-600">present on this device</span>
        ) : (
          <span className="font-medium text-amber-600">not present — set up or restore below</span>
        )}
      </p>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Set up (new device / first time)</h3>
          <button
            onClick={setup}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-violet-700"
          >
            Generate 3 recovery shares
          </button>
          {shares && (
            <>
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                You won&rsquo;t be able to see these again after leaving this page — copy or save all 3 now.
              </p>
              <ul className="mt-3 space-y-2">
                {shares.map((s) => (
                  <ShareCard key={s.shareId} share={s} />
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Restore (lost device)</h3>
          {restoreInput.map((val, i) => (
            <RestoreShareBox
              key={i}
              index={i}
              value={val}
              onChange={(v) => setRestoreInput((prev) => prev.map((p, j) => (j === i ? v : p)))}
            />
          ))}
          <p className="mb-2 text-xs text-gray-500">{distinctValidCount} of 2 minimum shares provided</p>
          <button
            onClick={restore}
            disabled={!canRestore || restoring}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {restoring ? 'Reconstructing…' : 'Reconstruct key & restore data'}
          </button>
        </div>
      </div>

      {status && <p className="mt-4 text-sm text-gray-600">{status}</p>}

      <SigningKeySection patientDID={patientDID} />
    </Card>
  );
}
