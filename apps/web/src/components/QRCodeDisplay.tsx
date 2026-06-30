'use client';
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeDisplayProps {
  invitationUrl?: string;
  invitationData?: {
    invitation_url?: string;
    invitationUrl?: string;
    [key: string]: unknown;
  } | null;
  showDebugInfo?: boolean;
}

const QRCodeDisplay = ({ invitationUrl, invitationData, showDebugInfo = true }: QRCodeDisplayProps) => {
  const getInvitationUrl = (): string => {
    if (invitationUrl) return invitationUrl;
    if (invitationData?.invitation_url) return invitationData.invitation_url;
    if (invitationData?.invitationUrl) return invitationData.invitationUrl as string;
    return '';
  };

  const qrValue = getInvitationUrl();

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Scan with Aries Bifold</h3>

      <div className="flex justify-center mb-6">
        <div className="p-4 bg-white rounded-lg border-2 border-gray-200">
          <QRCodeSVG value={qrValue} size={300} level="L" includeMargin />
        </div>
      </div>

      {showDebugInfo && (
        <>
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-900 mb-1">QR Code Content:</h4>
            <div className="bg-gray-50 p-3 rounded-md break-all text-xs text-gray-900 max-h-32 overflow-auto">
              {qrValue}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-1">Invitation JSON:</h4>
            <div className="bg-gray-50 p-3 rounded-md overflow-auto max-h-60">
              <pre className="text-xs text-gray-900">{JSON.stringify(invitationData, null, 2)}</pre>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default QRCodeDisplay;
