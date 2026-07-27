'use client';
// Adapted from EstablishConenction.jsx (fixed filename typo).
// Generates a QR code invitation and polls for connection completion.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Image from 'next/image';
import { AgentType, createInvitation } from '../services/apiService';
import { usePolling } from '../hooks/usePolling';

interface ConnectionSetupProps {
  agentType: AgentType;
  label: string;
  onConnected: (connectionId: string) => void;
  isVerifier?: boolean;
}

const ConnectionSetup = ({ agentType, label, onConnected, isVerifier = false }: ConnectionSetupProps) => {
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [oobId, setOobId] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(180);
  const [scanning, setScanning] = useState(false);

  const generateQR = async (isStale: () => boolean) => {
    try {
      const data = await createInvitation(agentType, label, label);
      if (isStale()) return; // effect was cleaned up (Strict Mode remount) — this invitation was superseded, don't display it
      const id = data.invitation?.id ?? data.invitation?.['@id'] ?? null;
      setOobId(id);
      if (data.connection_id) setConnectionId(data.connection_id);

      const url = data.invitationUrl ?? data.invitation_url;
      const dataUrl = await QRCode.toDataURL(url, { color: { dark: '#000000', light: '#f3f4f6' } });
      if (isStale()) return;
      setQrCodeData(dataUrl);
    } catch (error) {
      console.error('Error creating invitation:', error);
    }
  };

  // React 18 Strict Mode (Next.js dev default) double-invokes mount effects,
  // which used to create two separate invitations here — whichever network
  // response resolved last silently overwrote the displayed QR/oobId with an
  // invitation nobody scanned, while polling kept checking that orphaned one
  // forever even after the real (first) invitation's connection completed.
  // The `stale` flag ensures only the invocation that survives to the end
  // (i.e. isn't cleaned up before its async work finishes) ever updates state.
  useEffect(() => {
    let stale = false;
    generateQR(() => stale);
    return () => { stale = true; };
  }, []);

  // Poll for connection completion
  usePolling(
    async () => {
      if (!oobId) return null;
      const endpoint = connectionId
        ? `/connections?connectionId=${connectionId}`
        : `/connections?outOfBandId=${oobId}`;
      const AGENT_BASES: Record<AgentType, string> = {
        government: process.env.NEXT_PUBLIC_GOVERNMENT_URL || 'http://localhost:4000',
        doctor: process.env.NEXT_PUBLIC_DOCTOR_URL || 'http://localhost:4002',
        pharmacist: process.env.NEXT_PUBLIC_PHARMACIST_URL || 'http://localhost:4004',
        'healthcare-authority': process.env.NEXT_PUBLIC_HEALTHCARE_AUTHORITY_URL || 'http://localhost:4006',
      };
      const resp = await fetch(`${AGENT_BASES[agentType]}${endpoint}`);
      const data = await resp.json();
      const items = Array.isArray(data) ? data : [data];
      const completed = items.find((c: any) => c.state === 'completed' || c.state === 'active');
      return completed ?? null;
    },
    (conn: any) => {
      setScanning(true);
      onConnected(conn.id ?? conn.connection_id);
    },
    { enabled: !!oobId, interval: 2000, timeout: 180000 }
  );

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="w-full max-w-2xl mx-auto mt-10 bg-white rounded-xl shadow-md overflow-hidden">
      <div className="flex">
        <div className="w-3/5 bg-gray-100 flex flex-col items-center justify-center p-6">
          {qrCodeData && !scanning ? (
            <>
              <Image src={qrCodeData} alt="QR Code" width={280} height={280} />
              <p className="mt-4 text-red-500 font-medium">Time remaining: {formatTime(timeLeft)}</p>
            </>
          ) : (
            <div className="text-center text-gray-600 p-8">
              <p className="text-lg font-semibold mb-2">Scanning complete</p>
              <p>Setting up connection with your wallet…</p>
            </div>
          )}
        </div>
        <div className="w-2/5 p-6 flex flex-col justify-center">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Connect with {isVerifier ? 'a verifier' : 'an issuer'}
          </p>
          <h2 className="text-xl font-bold text-gray-800 mb-3">Scan the QR code to connect</h2>
          <p className="text-sm text-gray-600">
            Open your Aries Bifold wallet and scan the QR code.{' '}
            {isVerifier
              ? 'The verifier will request a proof in the next step.'
              : 'You will receive a credential offer after connecting.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConnectionSetup;
