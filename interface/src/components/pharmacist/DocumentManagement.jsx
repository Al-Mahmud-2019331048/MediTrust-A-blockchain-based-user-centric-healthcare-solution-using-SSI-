import { CheckCircle, XCircle } from "lucide-react";

const DocumentManagement = ({
  prescriptionResult,
  verificationData,
  setVerificationData,
  loading,
  documentData,
  onFetchDocument,
  onDownloadDocument,
  onFillDummyData,
}) => {
  if (!prescriptionResult?.success) return null;

  return (
    <div className="border-t border-gray-200 p-8 lg:p-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
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
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
          📄 Document Retrieval & Download
        </h3>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Fetch and download verified prescription documents from the secure
          database
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Document Information Panel */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-8 border border-green-200 shadow-lg">
            <h4 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <svg
                className="w-6 h-6 mr-3 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Document Verification
            </h4>

            {/* Quick Test Data Button */}
            <div className="mb-6">
              <button
                onClick={onFillDummyData}
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium rounded-xl hover:from-gray-600 hover:to-gray-700 transform hover:scale-105 transition-all duration-200 shadow-lg"
              >
                <svg
                  className="w-4 h-4 mr-2"
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
                Fill Test Data
              </button>
            </div>

            {/* Auto-population status */}
            {verificationData.documentId && verificationData.documentHash && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
                <p className="text-green-700 text-sm flex items-center">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Document verification data auto-populated from prescription
                  verification
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Document ID
                </label>
                <input
                  type="text"
                  value={verificationData.documentId}
                  onChange={(e) =>
                    setVerificationData({
                      ...verificationData,
                      documentId: e.target.value,
                    })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white shadow-sm"
                  placeholder="Enter document ID from verified credential"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Document Hash
                </label>
                <input
                  type="text"
                  value={verificationData.documentHash}
                  onChange={(e) =>
                    setVerificationData({
                      ...verificationData,
                      documentHash: e.target.value,
                    })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white shadow-sm"
                  placeholder="Enter document hash from verified credential"
                />
              </div>

              <button
                onClick={onFetchDocument}
                disabled={
                  loading ||
                  !verificationData.documentId ||
                  !verificationData.documentHash
                }
                className="w-full inline-flex items-center justify-center px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
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
                    <span>Fetching Document...</span>
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
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    {documentData
                      ? "Re-fetch Document"
                      : "Fetch Document from Database"}
                  </>
                )}
              </button>

              {/* Auto-fetch status */}
              {documentData && prescriptionResult?.documentId && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-blue-700 text-sm flex items-center">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Document automatically fetched after prescription
                    verification
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Document Results Panel */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 border border-blue-200 shadow-lg">
            <h4 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <svg
                className="w-6 h-6 mr-3 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Document Details
            </h4>

            {documentData ? (
              <div className="space-y-6">
                {/* Verification Status */}
                <div
                  className={`p-6 rounded-xl shadow-lg ${
                    documentData.verified
                      ? "bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200"
                      : "bg-gradient-to-r from-red-50 to-red-100 border border-red-200"
                  }`}
                >
                  <div className="flex items-center mb-3">
                    {documentData.verified ? (
                      <CheckCircle className="w-6 h-6 text-green-500 mr-3" />
                    ) : (
                      <XCircle className="w-6 h-6 text-red-500 mr-3" />
                    )}
                    <h5
                      className={`text-lg font-bold ${
                        documentData.verified
                          ? "text-green-800"
                          : "text-red-800"
                      }`}
                    >
                      {documentData.verified
                        ? "✅ Document Verified"
                        : "❌ Document Not Verified"}
                    </h5>
                  </div>
                  <p
                    className={`${
                      documentData.verified ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {documentData.message}
                  </p>
                </div>

                {/* Download Button */}
                {documentData.verified && (
                  <button
                    onClick={onDownloadDocument}
                    className="w-full inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-emerald-600 to-green-600 text-black font-bold rounded-xl hover:from-emerald-700 hover:to-green-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
                  >
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
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    📥 Download Verified Document
                  </button>
                )}

                {/* Document Metadata */}
                {documentData.documentMetadata && (
                  <div className="bg-white rounded-xl p-6 shadow-sm border border-blue-100">
                    <h6 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                      <svg
                        className="w-5 h-5 mr-2 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      Document Metadata
                    </h6>
                    <div className="grid grid-cols-1 gap-3 text-sm">
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="font-medium text-gray-600">
                          Patient DID:
                        </span>
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded text-gray-800">
                          {documentData.documentMetadata.patientDid}
                        </span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="font-medium text-gray-600">
                          File Name:
                        </span>
                        <span className="text-gray-800 font-medium">
                          {documentData.documentMetadata.fileName}
                        </span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="font-medium text-gray-600">
                          Issued By:
                        </span>
                        <span className="text-gray-800 font-medium">
                          {documentData.documentMetadata.issuedBy}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl p-8 text-center border border-blue-100">
                <svg
                  className="w-12 h-12 text-gray-400 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-gray-500 text-lg">
                  No document data available
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Fetch a document to see details and download options
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentManagement;
