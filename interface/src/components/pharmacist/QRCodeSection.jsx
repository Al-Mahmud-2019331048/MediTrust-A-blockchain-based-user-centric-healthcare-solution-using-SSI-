import React from "react";

const QRCodeSection = ({ qrCodeUrl }) => {
  return (
    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-8 border border-purple-200">
      <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
        <svg
          className="w-6 h-6 mr-3 text-purple-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
          />
        </svg>
        Patient QR Code
      </h3>

      <div className="bg-white rounded-xl p-6 shadow-lg border border-purple-100">
        {qrCodeUrl ? (
          <div className="text-center">
            <img
              src={qrCodeUrl}
              alt="QR Code"
              className="w-48 h-48 mx-auto rounded-lg shadow-md"
            />
            <p className="text-sm text-gray-600 mt-4">
              Patient scans this QR code with their SSI wallet
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-48 h-48 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg mx-auto">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mb-4"></div>
            <span className="text-gray-500 text-sm">Generating QR Code...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default QRCodeSection;
