import { CheckCircle, XCircle } from "lucide-react";
import React from "react";

const PrescriptionVerification = ({
  selectedConnection,
  loading,
  prescriptionResult,
  verificationResult,
  onVerifyPrescription,
}) => {
  if (!verificationResult?.success) return null;

  return (
    <div className="border-t border-gray-200 p-8 lg:p-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
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
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 9.172V5L8 4z"
            />
          </svg>
        </div>
        <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
          💊 Prescription Verification
        </h3>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Verify doctor-issued prescription credentials and medical documents
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-8 border border-purple-200 shadow-lg">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center mr-4">
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
                    d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h2m0 0h6a2 2 0 002-2V7a2 2 0 00-2-2h-6m0 0v5m0 0V9a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H9z"
                  />
                </svg>
              </div>
              <div className="text-left">
                <h4 className="text-lg font-bold text-gray-900">
                  Medical Document Verification
                </h4>
                <p className="text-sm text-gray-600">
                  Doctor-issued prescription credentials
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={onVerifyPrescription}
            disabled={!selectedConnection || loading}
            className="w-full inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl hover:from-purple-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
                    d="M4 12a8 8 0 818-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Verifying Prescription...</span>
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
                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 9.172V5L8 4z"
                  />
                </svg>
                Verify Prescription
              </>
            )}
          </button>

          {prescriptionResult && (
            <div className="mt-6">
              <div
                className={`p-6 rounded-xl shadow-lg ${
                  prescriptionResult.success
                    ? "bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200"
                    : "bg-gradient-to-r from-red-50 to-red-100 border border-red-200"
                }`}
              >
                <div className="flex items-center mb-3">
                  {prescriptionResult.success ? (
                    <CheckCircle className="w-6 h-6 text-green-500 mr-3" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-500 mr-3" />
                  )}
                  <h5
                    className={`text-lg font-bold ${
                      prescriptionResult.success
                        ? "text-green-800"
                        : "text-red-800"
                    }`}
                  >
                    {prescriptionResult.success
                      ? "✅ Prescription Verified"
                      : "❌ Verification Failed"}
                  </h5>
                </div>
                <p
                  className={`${
                    prescriptionResult.success
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  {prescriptionResult.message}
                </p>

                {prescriptionResult.success &&
                  prescriptionResult.documentId && (
                    <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200">
                      <h5 className="font-bold text-blue-800 mb-3 flex items-center">
                        <svg
                          className="w-5 h-5 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h2m0 0h6a2 2 0 002-2V7a2 2 0 00-2-2h-6m0 0v5m0 0V9a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H9z"
                          />
                        </svg>
                        📋 Extracted Document Information
                      </h5>
                      <div className="space-y-1 text-sm text-black">
                        <p>
                          <span className="font-medium">Document ID:</span>{" "}
                          {prescriptionResult.documentId}
                        </p>
                        <p>
                          <span className="font-medium">Document Hash:</span>{" "}
                          {prescriptionResult.documentHash}
                        </p>
                        <p className="text-blue-600 mt-2">
                          ✅ Document verification data auto-populated below
                        </p>
                      </div>
                    </div>
                  )}

                {prescriptionResult.success && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
                      View Full Verification Details
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto max-h-40">
                      {JSON.stringify(prescriptionResult.proofData, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrescriptionVerification;
