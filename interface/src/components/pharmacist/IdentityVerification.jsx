import { CheckCircle, XCircle } from "lucide-react";
import React from "react";

const IdentityVerification = ({
  selectedConnection,
  loading,
  verificationResult,
  onVerifyIdentity,
}) => {
  if (!selectedConnection) return null;

  return (
    <div className="border-t border-gray-200 p-8 lg:p-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
          🆔 Patient Identity Verification
        </h3>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Verify government-issued identity credentials to ensure patient
          authenticity
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 border border-blue-200 shadow-lg">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center mr-4">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <div className="text-left">
                <h4 className="text-lg font-bold text-gray-900">
                  Government ID Verification
                </h4>
                <p className="text-sm text-gray-600">
                  Blockchain-verified identity credentials
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={onVerifyIdentity}
            disabled={!selectedConnection || loading}
            className="w-full inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-3 h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Verifying Identity...</span>
              </>
            ) : (
              <>
                <svg
                  className="w-6 h-6 mr-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                Verify Patient Identity
              </>
            )}
          </button>

          {verificationResult && (
            <div className="mt-6">
              <div
                className={`p-6 rounded-xl shadow-lg ${
                  verificationResult.success
                    ? "bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200"
                    : "bg-gradient-to-r from-red-50 to-red-100 border border-red-200"
                }`}
              >
                <div className="flex items-center mb-3">
                  {verificationResult.success ? (
                    <CheckCircle className="w-6 h-6 text-green-500 mr-3" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-500 mr-3" />
                  )}
                  <h5
                    className={`text-lg font-bold ${
                      verificationResult.success
                        ? "text-green-800"
                        : "text-red-800"
                    }`}
                  >
                    {verificationResult.success
                      ? "✅ Identity Verified"
                      : "❌ Verification Failed"}
                  </h5>
                </div>
                <p
                  className={`${
                    verificationResult.success
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  {verificationResult.message}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IdentityVerification;
