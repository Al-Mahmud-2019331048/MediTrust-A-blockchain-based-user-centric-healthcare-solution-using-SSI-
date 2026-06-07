"use client";
import Navigation from "@/components/Navigation";
import QRCodeDisplay from "@/components/QRCodeDisplay";
import {
  createInvitation,
  getConnections,
  getProofData,
  getProofStatus,
  sendMessage,
  sendProofRequest,
  uploadMedicalDocument,
} from "@/services/apiService";
import React, { useEffect, useRef, useState } from "react";

export default function DoctorPage() {
  const [step, setStep] = useState(1);
  const [invitation, setInvitation] = useState(null);
  const [connections, setConnections] = useState([]);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);
  const [documentType, setDocumentType] = useState("prescription");
  const [documentDescription, setDocumentDescription] = useState(
    "Patient diagnosed with common cold. Prescribed rest, fluids, and over-the-counter pain relief as needed. Follow up in 1 week if symptoms persist."
  );
  const [uploadResult, setUploadResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fileInputRef = useRef(null);

  // Fetch connections periodically
  useEffect(() => {
    if (step >= 2) {
      const fetchConnections = async () => {
        try {
          const data = await getConnections("doctor");
          setConnections(data);

          if (data.length > 0 && !selectedConnection) {
            const completedConnection = data.find(
              (conn) => conn.state === "completed"
            );
            if (completedConnection) {
              setSelectedConnection(completedConnection);
              setStep(3);
              setSuccess(
                "🎉 Patient connected successfully! Ready to verify identity."
              );
            }
          }
        } catch (err) {
          console.error("Error fetching connections:", err);
        }
      };

      fetchConnections();
      const interval = setInterval(fetchConnections, 3000);
      return () => clearInterval(interval);
    }
  }, [step, selectedConnection]);

  const handleCreateInvitation = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const data = await createInvitation(
        "doctor",
        "Doctor Office",
        "medical-services"
      );

      setInvitation(data);
      setStep(2);
      setSuccess("✅ Secure connection ready! Show QR code to patient.");
    } catch (err) {
      console.error("Error creating invitation:", err);
      setError("Failed to create secure connection. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyIdentity = async () => {
    if (!selectedConnection) {
      setError("No patient connection found");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await sendMessage(
        "doctor",
        selectedConnection.id,
        "🔐 Please share your identity credentials for verification."
      );

      const result = await sendProofRequest(
        "doctor",
        selectedConnection.id,
        "identity-verification"
      );

      const proofRecordId = result.id;

      if (!proofRecordId) {
        throw new Error("Failed to initiate verification process");
      }

      setSuccess(
        "🔍 Verification request sent. Patient will receive notification in their wallet app..."
      );

      setVerificationResult({
        ...result,
        status: "pending",
        proofRecordId,
      });

      let proofVerified = false;
      let attempts = 0;
      const maxAttempts = 60;

      const checkProofVerification = async () => {
        try {
          const statusResult = await getProofStatus("doctor", proofRecordId);

          if (!statusResult) {
            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(checkProofVerification, 1000);
            } else {
              setError("⏰ Verification timed out. Please try again.");
            }
            return;
          }

          if (statusResult.isVerified) {
            try {
              const proofData = await getProofData("doctor", proofRecordId);

              proofVerified = true;
              setVerificationResult({
                ...result,
                status: "verified",
                state: statusResult.state,
                proofData,
              });
              setSuccess(
                "🎉 Identity verified successfully! Ready to issue medical document."
              );
              setStep(4);
              return;
            } catch (proofDataError) {
              console.error("Error getting proof data:", proofDataError);
              proofVerified = true;
              setVerificationResult({
                ...result,
                status: "verified",
                state: statusResult.state,
              });
              setSuccess(
                "🎉 Identity verified successfully! Ready to issue medical document."
              );
              setStep(4);
              return;
            }
          }

          if (
            statusResult.state === "declined" ||
            statusResult.state === "abandoned" ||
            statusResult.state === "problem-report-received"
          ) {
            setError(
              `❌ Verification failed: ${statusResult.state}. Please try again.`
            );
            setVerificationResult({
              ...result,
              status: "failed",
              state: statusResult.state,
            });
            return;
          }

          if (statusResult.state === "presentation-received") {
            setSuccess("📋 Credentials received, verifying...");
          }

          attempts++;
          if (!proofVerified && attempts < maxAttempts) {
            setTimeout(checkProofVerification, 1000);
          } else if (!proofVerified) {
            setError("⏰ Verification timed out. Please try again.");
          }
        } catch (err) {
          console.error("Error checking proof verification:", err);
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(checkProofVerification, 1000);
          } else {
            setError("⏰ Verification timed out. Please try again.");
          }
        }
      };

      checkProofVerification();
    } catch (err) {
      console.error("Error in verification process:", err);
      setError("❌ Failed to start verification. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadDocument = async (e) => {
    e.preventDefault();

    if (!selectedConnection || !verificationResult) {
      setError("Patient identity must be verified first");
      return;
    }

    if (
      !fileInputRef.current ||
      !fileInputRef.current.files ||
      !fileInputRef.current.files[0]
    ) {
      setError("Please select a document file to upload");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const file = fileInputRef.current.files[0];
      const patientDid = selectedConnection.theirDid;

      const result = await uploadMedicalDocument(
        file,
        patientDid,
        documentType
      );
      setUploadResult(result);

      await sendMessage(
        "doctor",
        selectedConnection.id,
        `📄 Your ${documentType} has been securely issued. Document ID: ${result.documentId}`
      );

      setStep(5);
      setSuccess("🎉 Medical document successfully issued to patient!");
    } catch (err) {
      console.error("Document upload error:", err);
      setError("❌ Failed to issue document. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setStep(1);
    setInvitation(null);
    setSelectedConnection(null);
    setVerificationResult(null);
    setUploadResult(null);
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <Navigation />

      <main className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-10 h-10 text-white"
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
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">
            Doctor Portal
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Securely verify patient identity and issue medical documents using
            blockchain technology
          </p>
        </div>

        {/* Progress Indicator */}
        <div className="mb-12">
          <div className="flex items-center justify-center space-x-4 mb-6">
            {[
              {
                num: 1,
                title: "Connect",
                icon: "🔗",
                desc: "Establish secure connection",
              },
              {
                num: 2,
                title: "Wait",
                icon: "⏳",
                desc: "Patient scans QR code",
              },
              {
                num: 3,
                title: "Verify",
                icon: "🔍",
                desc: "Confirm patient identity",
              },
              {
                num: 4,
                title: "Issue",
                icon: "📄",
                desc: "Create medical document",
              },
              {
                num: 5,
                title: "Complete",
                icon: "✅",
                desc: "Process finished",
              },
            ].map((stepInfo, index) => (
              <React.Fragment key={stepInfo.num}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl transition-all duration-300 ${
                      step >= stepInfo.num
                        ? "bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg transform scale-110"
                        : "bg-gray-200"
                    }`}
                  >
                    {step >= stepInfo.num ? "✅" : stepInfo.icon}
                  </div>
                  <div className="mt-3 text-center">
                    <p
                      className={`text-sm font-semibold ${
                        step >= stepInfo.num ? "text-blue-600" : "text-gray-500"
                      }`}
                    >
                      {stepInfo.title}
                    </p>
                    <p className="text-xs text-gray-400 hidden sm:block max-w-20">
                      {stepInfo.desc}
                    </p>
                  </div>
                </div>
                {index < 4 && (
                  <div
                    className={`h-1 w-12 sm:w-16 transition-all duration-300 ${
                      step > stepInfo.num
                        ? "bg-gradient-to-r from-blue-500 to-indigo-600"
                        : "bg-gray-200"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Status Messages */}
        {success && (
          <div className="mb-8 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-lg font-semibold text-green-800">
                  {success}
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-8 bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-2xl p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-lg font-semibold text-red-800">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Step 1: Create Connection */}
          {step === 1 && (
            <div className="p-8 lg:p-12 text-center">
              <div className="mb-8">
                <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <svg
                    className="w-12 h-12 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Start Secure Patient Connection
                </h2>
                <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
                  Create a secure, encrypted connection with your patient. This
                  ensures all medical data and credentials are transmitted
                  safely using blockchain technology.
                </p>
              </div>

              <button
                onClick={handleCreateInvitation}
                disabled={loading}
                className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
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
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Creating Secure Connection...
                  </>
                ) : (
                  <>
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
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Create Secure Connection
                  </>
                )}
              </button>

              <div className="mt-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  🔒 Security Features
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-2"></div>
                    End-to-end encryption
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full mr-2"></div>
                    Blockchain verified
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mr-2"></div>
                    HIPAA compliant
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Show QR Code */}
          {step === 2 && invitation && (
            <div className="p-8 lg:p-12">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Patient Connection QR Code
                </h2>
                <p className="text-lg text-gray-600 mb-6">
                  Show this QR code to your patient. They'll scan it with their
                  digital wallet app to establish a secure connection.
                </p>
              </div>

              <div className="flex flex-col lg:flex-row items-center justify-center gap-12">
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-8 rounded-3xl shadow-inner">
                  <QRCodeDisplay
                    invitationUrl={invitation.invitationUrl}
                    invitationData={invitation}
                  />
                </div>

                <div className="max-w-md">
                  <h3 className="text-xl font-semibold text-gray-900 mb-6">
                    📱 Patient Instructions
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3 mt-1">
                        1
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          Open Digital Wallet
                        </p>
                        <p className="text-sm text-gray-600">
                          Launch your Aries Bifold or compatible wallet app
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3 mt-1">
                        2
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          Scan QR Code
                        </p>
                        <p className="text-sm text-gray-600">
                          Use your wallet's scanner to scan this QR code
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3 mt-1">
                        3
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          Accept Connection
                        </p>
                        <p className="text-sm text-gray-600">
                          Confirm the connection request in your wallet
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4">
                    <div className="flex items-center">
                      <svg
                        className="w-5 h-5 text-amber-600 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                        />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-amber-800">
                          Waiting for Patient
                        </p>
                        <p className="text-xs text-amber-700">
                          Connection will complete automatically when patient
                          scans QR code
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Connection Established */}
          {step === 3 && selectedConnection && (
            <div className="p-8 lg:p-12">
              {/* Success Celebration Header */}
              <div className="text-center mb-10">
                <div className="relative mb-8">
                  <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-2xl">
                    <svg
                      className="w-12 h-12 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  {/* Animated pulse rings */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-32 h-32 border-4 border-green-300 rounded-full animate-ping opacity-20"></div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-40 h-40 border-2 border-green-200 rounded-full animate-pulse opacity-30"></div>
                  </div>
                </div>

                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                  🎉 Connection Successful!
                </h2>
                <p className="text-xl text-gray-600 mb-2 max-w-2xl mx-auto">
                  Patient's wallet is now securely connected
                </p>
                <p className="text-lg text-gray-500 max-w-xl mx-auto">
                  Ready to proceed with identity verification
                </p>
              </div>

              {/* Connection Status Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
                {/* Security Status Card */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200 shadow-lg">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center mr-4">
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
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Connection Status
                      </h3>
                      <p className="text-sm text-gray-600">
                        Securely Established
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                      <span className="text-sm font-medium text-gray-700">
                        Active Connection
                      </span>
                    </div>
                  </div>
                </div>

                {/* Encryption Card */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200 shadow-lg">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center mr-4">
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
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Encryption
                      </h3>
                      <p className="text-sm text-gray-600">
                        End-to-End Security
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                      <span className="text-sm font-medium text-gray-700">
                        AES-256 Active
                      </span>
                    </div>
                  </div>
                </div>

                {/* Protocol Card */}
                <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl p-6 border border-purple-200 shadow-lg">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center mr-4">
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
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Protocol
                      </h3>
                      <p className="text-sm text-gray-600">Aries DIDComm</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
                      <span className="text-sm font-medium text-gray-700">
                        SSI Compliant
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Next Steps Section */}
              <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-8 mb-8 border border-indigo-200">
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-3">
                    Next: Verify Patient Identity
                  </h3>
                  <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                    Before issuing medical documents, we need to verify the
                    patient's government-issued identity credentials
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  <div className="flex items-center bg-white rounded-xl p-4 shadow-sm">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mr-3">
                      <span className="text-indigo-600 font-bold">1</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Request Credentials
                      </p>
                      <p className="text-xs text-gray-600">
                        Send verification request
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center bg-white rounded-xl p-4 shadow-sm">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mr-3">
                      <span className="text-indigo-600 font-bold">2</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Patient Shares
                      </p>
                      <p className="text-xs text-gray-600">Via wallet app</p>
                    </div>
                  </div>
                  <div className="flex items-center bg-white rounded-xl p-4 shadow-sm">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mr-3">
                      <span className="text-indigo-600 font-bold">3</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Verify & Proceed
                      </p>
                      <p className="text-xs text-gray-600">
                        Issue medical docs
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="text-center">
                <button
                  onClick={handleVerifyIdentity}
                  disabled={loading}
                  className="inline-flex items-center px-10 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold rounded-2xl hover:from-indigo-700 hover:to-blue-700 transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-3xl disabled:opacity-50 disabled:cursor-not-allowed text-lg"
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
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Initiating Verification...
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
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Start Identity Verification
                      <svg
                        className="w-5 h-5 ml-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    </>
                  )}
                </button>

                <p className="text-sm text-gray-500 mt-4">
                  This process is secure and HIPAA compliant
                </p>
              </div>
            </div>
          )}

          {/* Step 4: Issue Medical Document */}
          {step === 4 && verificationResult && (
            <div className="p-8 lg:p-12">
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <svg
                    className="w-10 h-10 text-blue-600"
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
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Issue Medical Document
                </h2>
                <p className="text-lg text-gray-600 mb-8">
                  Patient identity verified! Create and issue a secure medical
                  document credential to the patient.
                </p>
              </div>

              <form
                onSubmit={handleUploadDocument}
                className="max-w-2xl mx-auto"
              >
                <div className="space-y-8">
                  {/* Quick Fill Buttons */}
                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      ⚡ Quick Fill Templates
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentType("prescription");
                          setDocumentDescription(
                            "Patient: Sarah Wilson, Age: 35. Diagnosed with acute bronchitis. Prescribed: Amoxicillin 500mg, 3 times daily for 7 days. Cough suppressant as needed. Rest and increased fluid intake recommended. Return if symptoms worsen or persist beyond 10 days."
                          );
                        }}
                        className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-xl hover:bg-blue-200 transition-colors duration-200"
                      >
                        💊 Prescription Template
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentType("labReport");
                          setDocumentDescription(
                            "Lab Report for Michael Chen, DOB: 1985-03-15. Blood work completed on 2024-12-19. Results: Cholesterol 195 mg/dL (normal), Blood glucose 88 mg/dL (normal), Hemoglobin A1C 5.2% (normal). All values within normal ranges. Continue current diet and exercise regimen."
                          );
                        }}
                        className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-xl hover:bg-green-200 transition-colors duration-200"
                      >
                        🧪 Lab Report Template
                      </button>
                    </div>
                  </div>

                  {/* Document Type */}
                  <div>
                    <label
                      htmlFor="documentType"
                      className="block text-lg font-semibold text-gray-900 mb-3"
                    >
                      📋 Document Type
                    </label>
                    <select
                      id="documentType"
                      name="documentType"
                      value={documentType}
                      onChange={(e) => setDocumentType(e.target.value)}
                      className="block w-full px-4 py-3 text-base text-gray-900 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                    >
                      <option value="prescription">💊 Prescription</option>
                      <option value="labReport">🧪 Lab Report</option>
                      <option value="medicalRecord">📄 Medical Record</option>
                      <option value="referral">👨‍⚕️ Referral</option>
                    </select>
                  </div>

                  {/* Document Description */}
                  <div>
                    <label
                      htmlFor="documentDescription"
                      className="block text-lg font-semibold text-gray-900 mb-3"
                    >
                      📝 Medical Description
                    </label>
                    <textarea
                      id="documentDescription"
                      name="documentDescription"
                      rows={6}
                      value={documentDescription}
                      onChange={(e) => setDocumentDescription(e.target.value)}
                      className="block w-full px-4 py-3 text-base text-gray-900 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                      placeholder="Enter detailed medical information, diagnosis, treatment plan, or other relevant details..."
                    />
                  </div>

                  {/* File Upload */}
                  <div>
                    <label className="block text-lg font-semibold text-gray-900 mb-3">
                      📎 Upload Document File
                    </label>
                    <div className="mt-1 flex justify-center px-6 pt-8 pb-8 border-2 border-gray-300 border-dashed rounded-2xl hover:border-gray-400 transition-colors duration-200">
                      <div className="space-y-1 text-center">
                        <svg
                          className="mx-auto h-16 w-16 text-gray-400"
                          stroke="currentColor"
                          fill="none"
                          viewBox="0 0 48 48"
                        >
                          <path
                            d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <div className="flex text-base text-gray-600">
                          <label
                            htmlFor="file-upload"
                            className="relative cursor-pointer bg-white rounded-xl font-semibold text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500 px-3 py-1"
                          >
                            <span>Choose file</span>
                            <input
                              id="file-upload"
                              name="file-upload"
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg,.gif"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  const fileNameElement =
                                    document.getElementById(
                                      "selected-filename"
                                    );
                                  if (fileNameElement) {
                                    fileNameElement.textContent = `📄 ${e.target.files[0].name}`;
                                    fileNameElement.classList.remove("hidden");
                                  }
                                }
                              }}
                              className="sr-only"
                              ref={fileInputRef}
                            />
                          </label>
                          <p className="pl-1">or drag and drop</p>
                        </div>
                        <p
                          id="selected-filename"
                          className="text-base text-blue-600 mt-3 font-medium hidden"
                        ></p>
                        <p className="text-sm text-gray-500">
                          PDF, PNG, JPG, GIF up to 10MB
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-10 text-center">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <svg
                          className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
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
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Issuing Document...
                      </>
                    ) : (
                      <>
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
                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        Issue Medical Document
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Step 5: Success */}
          {step === 5 && uploadResult && (
            <div className="p-8 lg:p-12 text-center">
              <div className="mb-8">
                <div className="w-24 h-24 bg-gradient-to-br from-green-100 to-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <svg
                    className="w-12 h-12 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  🎉 Document Successfully Issued!
                </h2>
                <p className="text-lg text-gray-600 mb-8">
                  The medical document has been securely issued to the patient
                  and stored on the blockchain. The patient will receive a
                  notification in their digital wallet.
                </p>
              </div>

              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 mb-8 max-w-2xl mx-auto">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  📄 Document Details
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Document ID
                    </p>
                    <p className="text-sm text-gray-600 font-mono bg-white px-2 py-1 rounded">
                      {uploadResult.documentId}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Document Type
                    </p>
                    <p className="text-sm text-gray-600">{documentType}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Blockchain Hash
                    </p>
                    <p className="text-sm text-gray-600 font-mono bg-white px-2 py-1 rounded truncate">
                      {uploadResult.documentHash}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Status</p>
                    <p className="text-sm text-green-600 font-semibold">
                      ✅ Issued Successfully
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={resetFlow}
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
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
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  Issue Another Document
                </button>
                <button
                  onClick={() => (window.location.href = "/")}
                  className="inline-flex items-center px-6 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
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
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  </svg>
                  Return to Home
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
