import React from "react";

const StatusMessages = ({ error, success }) => {
  if (!error && !success) return null;

  return (
    <>
      {/* Error Messages */}
      {error && (
        <div className="mb-8 max-w-2xl mx-auto">
          <div className="bg-gradient-to-r from-red-50 to-red-100 border-l-4 border-red-500 rounded-xl p-6 shadow-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg
                  className="w-6 h-6 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-medium text-red-800 mb-1">
                  ⚠️ Verification Error
                </h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Messages */}
      {success && (
        <div className="mb-8 max-w-2xl mx-auto">
          <div className="bg-gradient-to-r from-green-50 to-emerald-100 border-l-4 border-green-500 rounded-xl p-6 shadow-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg
                  className="w-6 h-6 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-medium text-green-800 mb-1">
                  ✅ Success
                </h3>
                <p className="text-green-700">{success}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StatusMessages;
