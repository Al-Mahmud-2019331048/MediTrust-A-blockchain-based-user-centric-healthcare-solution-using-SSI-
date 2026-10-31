'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSimulatedSms } from '@/services/apiService';

// SIMULATED SMS inbox — stands in for the patient's phone, since this PoC has
// no real SMS gateway. A real deployment has no such page: the code arrives
// only on the SIM itself.
export default function SmsInbox() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ message: string; sentAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Read ?phone= directly instead of useSearchParams, which would need a
  // Suspense boundary for this otherwise fully client-side page.
  useEffect(() => {
    const phone = new URLSearchParams(window.location.search).get('phone');
    if (phone) {
      setPhoneNumber(phone);
      setActivePhone(phone);
    }
  }, []);

  useEffect(() => {
    if (!activePhone) return;
    let cancelled = false;
    const load = async () => {
      try {
        const inbox = await getSimulatedSms(activePhone);
        if (!cancelled) {
          setMessages(inbox.messages);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activePhone]);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-12">
      <Link href="/government" className="text-sm text-gray-400 hover:text-gray-600">&larr; Government Portal</Link>
      <div className="mt-2 mb-6">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">Simulation</span>
        <h1 className="text-3xl font-bold text-gray-900">SMS Inbox</h1>
        <p className="mt-1 text-gray-500">
          Shows the text messages a phone number would receive. This stands in for the patient's real phone — there is no real SMS service in this demo.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setActivePhone(phoneNumber.trim() || null);
          }}
        >
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="01XXXXXXXXX"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            type="submit"
            disabled={!phoneNumber.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            Open
          </button>
        </form>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {activePhone && !error && (
          <div className="mt-6">
            <p className="mb-3 text-xs text-gray-400">Messages for {activePhone} · refreshes every 3 seconds</p>
            {messages.length === 0 ? (
              <p className="text-sm text-gray-500">No messages yet.</p>
            ) : (
              <ul className="space-y-3">
                {messages.map((m) => (
                  <li key={m.sentAt + m.message} className="rounded-xl bg-gray-100 px-4 py-3">
                    <p className="text-sm text-gray-900">{m.message}</p>
                    <p className="mt-1 text-xs text-gray-400">{new Date(m.sentAt).toLocaleTimeString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
