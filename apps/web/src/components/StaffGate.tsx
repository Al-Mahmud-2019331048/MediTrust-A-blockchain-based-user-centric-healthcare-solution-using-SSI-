'use client';
// Staff access gate for the Doctor and Pharmacy portals (2026-11-19).
// Their agents accept requests only with the staff access code configured on
// the agent (agents/shared/staff-auth.ts). This asks staff for the code once
// per browser tab and checks it with the agent before showing the portal.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { StaffAgentType, checkStaffAccess, getStaffToken, setStaffToken } from '../services/apiService';

interface StaffGateProps {
  agentType: StaffAgentType;
  portalName: string;
  children: React.ReactNode;
}

const StaffGate = ({ agentType, portalName, children }: StaffGateProps) => {
  const [status, setStatus] = useState<'checking' | 'locked' | 'open'>('checking');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getStaffToken(agentType)) {
      setStatus('locked');
      return;
    }
    checkStaffAccess(agentType).then((result) => {
      if (result.ok) {
        setStatus('open');
        return;
      }
      setStaffToken(agentType, null);
      setError(result.error ?? null);
      setStatus('locked');
    });
  }, [agentType]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entered = code.trim();
    if (!entered) return;
    setSubmitting(true);
    setError(null);
    setStaffToken(agentType, entered);
    const result = await checkStaffAccess(agentType);
    setSubmitting(false);
    if (result.ok) {
      setCode('');
      setStatus('open');
    } else {
      setStaffToken(agentType, null);
      setError(result.error ?? 'Access code not accepted');
    }
  };

  if (status === 'open') return <>{children}</>;

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-12">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">&larr; Back</Link>
      <h1 className="mt-2 text-3xl font-bold text-gray-900">{portalName}</h1>
      {status === 'checking' ? (
        <p className="mt-6 text-sm text-gray-500">Checking staff access…</p>
      ) : (
        <form onSubmit={submit} className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label htmlFor="staff-code" className="text-sm font-medium text-gray-700">Staff access code</label>
          <p className="mt-1 text-xs text-gray-500">Only staff can use this portal. The code is kept for this browser tab only.</p>
          <input
            id="staff-code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="current-password"
            className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-400"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !code.trim()}
            className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}
    </main>
  );
};

export default StaffGate;
