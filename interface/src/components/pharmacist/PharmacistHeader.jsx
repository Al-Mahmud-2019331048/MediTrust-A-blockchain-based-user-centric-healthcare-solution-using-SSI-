import React from "react";
import Navigation from "../Navigation";

const PharmacistHeader = ({
  step,
  verificationResult,
  prescriptionResult,
  onReset,
}) => {
  return (
    <>
      <Navigation />

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-xl">
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
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            🏥 Pharmacy Verification Portal
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Secure verification of patient identity and prescription credentials
            through blockchain technology
          </p>

          {/* Reset Button */}
          <div className="flex justify-center">
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Reset the verification process? This will clear your current state."
                  )
                ) {
                  onReset();
                }
              }}
              className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white font-medium rounded-xl hover:from-red-600 hover:to-red-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
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
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Reset System
            </button>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mb-12">
          <div className="flex items-center justify-center">
            {[
              { number: 1, title: "Connect Patient", icon: "🔗" },
              { number: 2, title: "Verify Identity", icon: "🆔" },
              { number: 3, title: "Verify Prescription", icon: "💊" },
              { number: 4, title: "Complete", icon: "✅" },
            ].map((stepItem, index) => (
              <React.Fragment key={stepItem.number}>
                <div className="flex flex-col items-center">
                  <div
                    className={`flex items-center justify-center w-16 h-16 rounded-2xl transition-all duration-300 ${
                      (step === 1 && stepItem.number === 1) ||
                      (step >= 2 && stepItem.number <= 2) ||
                      (verificationResult?.success && stepItem.number <= 3) ||
                      (prescriptionResult?.success && stepItem.number <= 4)
                        ? "bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-xl"
                        : "bg-white border-2 border-gray-200 text-gray-400 shadow-sm"
                    }`}
                  >
                    <span className="text-xl font-bold">
                      {(step === 1 && stepItem.number === 1) ||
                      (step >= 2 && stepItem.number <= 2) ||
                      (verificationResult?.success && stepItem.number <= 3) ||
                      (prescriptionResult?.success && stepItem.number <= 4)
                        ? stepItem.icon
                        : stepItem.number}
                    </span>
                  </div>
                  <div className="mt-3 text-center">
                    <div
                      className={`text-sm font-medium ${
                        (step === 1 && stepItem.number === 1) ||
                        (step >= 2 && stepItem.number <= 2) ||
                        (verificationResult?.success && stepItem.number <= 3) ||
                        (prescriptionResult?.success && stepItem.number <= 4)
                          ? "text-purple-600"
                          : "text-gray-400"
                      }`}
                    >
                      {stepItem.title}
                    </div>
                  </div>
                </div>
                {index < 3 && (
                  <div
                    className={`h-1 w-16 mx-4 rounded-full transition-all duration-300 ${
                      (step === 1 && stepItem.number >= 1) ||
                      (step >= 2 && stepItem.number >= 2) ||
                      (verificationResult?.success && stepItem.number >= 3) ||
                      (prescriptionResult?.success && stepItem.number >= 3)
                        ? "bg-gradient-to-r from-purple-400 to-indigo-500"
                        : "bg-gray-200"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default PharmacistHeader;
