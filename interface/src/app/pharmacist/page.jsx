"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

// Import new components
import DocumentManagement from "@/components/pharmacist/DocumentManagement";
import IdentityVerification from "@/components/pharmacist/IdentityVerification";
import PatientConnectionSection from "@/components/pharmacist/PatientConnectionSection";
import PharmacistHeader from "@/components/pharmacist/PharmacistHeader";
import PrescriptionVerification from "@/components/pharmacist/PrescriptionVerification";
import StatusMessages from "@/components/pharmacist/StatusMessages";

const PHARMACIST_API_URL = "http://localhost:4004";

export default function PharmacistPage() {
  const [step, setStep] = useState(1);
  const [connections, setConnections] = useState([]);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [prescriptionResult, setPrescriptionResult] = useState(null);
  const [documentData, setDocumentData] = useState(null);

  // Dummy data for testing
  const [verificationData, setVerificationData] = useState({
    documentId: "doc-1734567890-abc123def",
    documentHash: "mock-hash-1734567890",
  });

  // Fetch connections periodically
  useEffect(() => {
    if (step >= 2) {
      const fetchConnections = async () => {
        try {
          const response = await fetch(`${PHARMACIST_API_URL}/connections`);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          setConnections(data);

          // Auto-detect completed connections
          if (data.length > 0 && !selectedConnection) {
            const completedConnection = data.find(
              (conn) => conn.state === "completed"
            );
            if (completedConnection) {
              setSelectedConnection(completedConnection);
              setStep(3);
              setSuccess(
                "Connection with Aries Bifold detected! Moving to patient verification..."
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

  useEffect(() => {
    generateQRCode();
    fetchConnections();
  }, []);

  const generateQRCode = async () => {
    try {
      const response = await fetch(`${PHARMACIST_API_URL}/create-invitation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "Pharmacist Agent",
          alias: "pharmacist-connection",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const qrCodeDataURL = await QRCode.toDataURL(data.invitationUrl);
      setQrCodeUrl(qrCodeDataURL);
    } catch (error) {
      console.error("Error generating QR code:", error);
      setError(`Failed to generate QR code: ${error.message}`);
    }
  };

  const fetchConnections = async () => {
    try {
      const response = await fetch(`${PHARMACIST_API_URL}/connections`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setConnections(data);
    } catch (error) {
      console.error("Error fetching connections:", error);
      setError(`Failed to fetch connections: ${error.message}`);
    }
  };

  const handleReset = () => {
    setStep(1);
    setVerificationResult(null);
    setPrescriptionResult(null);
    setDocumentData(null);
    setSelectedConnection(null);
    setError(null);
    setSuccess(null);
  };

  const verifyPatientIdentity = async () => {
    if (!selectedConnection) {
      setError("Please select a connection first");
      return;
    }

    setLoading(true);
    setError("");
    setVerificationResult(null);

    try {
      console.log("🏥 Starting patient identity verification...");

      const response = await fetch(
        `${PHARMACIST_API_URL}/verify-patient-identity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId: selectedConnection.id,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      console.log("✅ Identity verification request sent:", data);

      // Poll for verification result
      const proofRecordId = data.proofRecordId;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout

      const pollForResult = async () => {
        try {
          const statusResponse = await fetch(
            `${PHARMACIST_API_URL}/proof-status/${proofRecordId}`
          );

          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            console.log("Proof status:", statusData);

            if (statusData.isVerified) {
              // Get the actual proof data
              const proofResponse = await fetch(
                `${PHARMACIST_API_URL}/proof-data/${proofRecordId}`
              );

              if (proofResponse.ok) {
                const proofData = await proofResponse.json();
                console.log("✅ Identity verification completed:", proofData);

                setVerificationResult({
                  success: true,
                  proofData,
                  message: "Patient identity verified successfully",
                });
                setLoading(false);
                return;
              }
            }
          }

          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(pollForResult, 1000); // Poll every second
          } else {
            setVerificationResult({
              success: false,
              message: "Identity verification timed out. Please try again.",
            });
            setLoading(false);
          }
        } catch (error) {
          console.error("Error polling for verification result:", error);
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(pollForResult, 1000);
          } else {
            setVerificationResult({
              success: false,
              message: `Identity verification failed: ${error.message}`,
            });
            setLoading(false);
          }
        }
      };

      // Start polling
      setTimeout(pollForResult, 2000); // Wait 2 seconds before first poll
    } catch (error) {
      console.error("Error verifying patient identity:", error);
      setError(`Identity verification failed: ${error.message}`);
      setLoading(false);
    }
  };

  const verifyPrescription = async () => {
    if (!selectedConnection) {
      setError("Please select a connection first");
      return;
    }

    setLoading(true);
    setError("");
    setPrescriptionResult(null);

    try {
      console.log("🏥 Starting prescription verification...");

      const response = await fetch(
        `${PHARMACIST_API_URL}/verify-prescription`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId: selectedConnection.id,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      console.log("✅ Prescription verification request sent:", data);

      // Poll for verification result
      const proofRecordId = data.proofRecordId;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout

      const pollForResult = async () => {
        try {
          const statusResponse = await fetch(
            `${PHARMACIST_API_URL}/proof-status/${proofRecordId}`
          );

          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            console.log("Prescription proof status:", statusData);

            if (statusData.isVerified) {
              // Get the actual proof data
              const proofResponse = await fetch(
                `${PHARMACIST_API_URL}/proof-data/${proofRecordId}`
              );

              if (proofResponse.ok) {
                const proofData = await proofResponse.json();
                console.log(
                  "✅ Prescription verification completed:",
                  proofData
                );

                // Extract document information from the proof data
                let extractedDocumentId = null;
                let extractedDocumentHash = null;

                try {
                  // Check if we have revealed attribute groups (AnonCreds format)
                  if (
                    proofData.presentation?.anoncreds?.requested_proof
                      ?.revealed_attr_groups?.prescription_info?.values
                  ) {
                    const values =
                      proofData.presentation.anoncreds.requested_proof
                        .revealed_attr_groups.prescription_info.values;
                    extractedDocumentId = values.documentId?.raw;
                    extractedDocumentHash = values.documentHash?.raw;

                    console.log("📋 Extracted from AnonCreds proof:");
                    console.log("Document ID:", extractedDocumentId);
                    console.log("Document Hash:", extractedDocumentHash);
                  }
                  // Check if we have revealed attributes (alternative format)
                  else if (
                    proofData.presentation?.anoncreds?.requested_proof
                      ?.revealed_attrs
                  ) {
                    const attrs =
                      proofData.presentation.anoncreds.requested_proof
                        .revealed_attrs;
                    extractedDocumentId = attrs.documentId?.raw;
                    extractedDocumentHash = attrs.documentHash?.raw;

                    console.log("📋 Extracted from revealed attributes:");
                    console.log("Document ID:", extractedDocumentId);
                    console.log("Document Hash:", extractedDocumentHash);
                  }
                } catch (extractError) {
                  console.warn(
                    "⚠️ Could not extract document info from proof:",
                    extractError
                  );
                }

                setPrescriptionResult({
                  success: true,
                  proofData,
                  message: "Prescription verified successfully",
                  documentId: extractedDocumentId,
                  documentHash: extractedDocumentHash,
                });

                // Auto-populate the verification data if we extracted the info
                if (extractedDocumentId && extractedDocumentHash) {
                  console.log(
                    "🔄 Auto-populating document verification data..."
                  );
                  setVerificationData({
                    documentId: extractedDocumentId,
                    documentHash: extractedDocumentHash,
                  });

                  // Automatically fetch the document from database
                  console.log("📥 Auto-fetching document from database...");
                  try {
                    const fetchResponse = await fetch(
                      `${PHARMACIST_API_URL}/fetch-prescription-document`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          documentId: extractedDocumentId,
                          documentHash: extractedDocumentHash,
                        }),
                      }
                    );

                    if (fetchResponse.ok) {
                      const fetchData = await fetchResponse.json();
                      console.log(
                        "✅ Document auto-fetched successfully:",
                        fetchData
                      );
                      setDocumentData(fetchData);
                    } else {
                      const errorData = await fetchResponse.json();
                      console.warn("⚠️ Auto-fetch failed:", errorData.error);
                    }
                  } catch (fetchError) {
                    console.warn("⚠️ Auto-fetch error:", fetchError.message);
                  }
                }

                setLoading(false);
                return;
              }
            }
          }

          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(pollForResult, 1000); // Poll every second
          } else {
            setPrescriptionResult({
              success: false,
              message: "Prescription verification timed out. Please try again.",
            });
            setLoading(false);
          }
        } catch (error) {
          console.error("Error polling for prescription result:", error);
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(pollForResult, 1000);
          } else {
            setPrescriptionResult({
              success: false,
              message: `Prescription verification failed: ${error.message}`,
            });
            setLoading(false);
          }
        }
      };

      // Start polling
      setTimeout(pollForResult, 2000); // Wait 2 seconds before first poll
    } catch (error) {
      console.error("Error verifying prescription:", error);
      setError(`Prescription verification failed: ${error.message}`);
      setLoading(false);
    }
  };

  const fetchPrescriptionDocument = async () => {
    if (!verificationData.documentId) {
      setError("Please provide document ID");
      return;
    }

    setLoading(true);
    setError("");
    setDocumentData(null);

    try {
      console.log("🏥 Fetching prescription document from database...");

      const response = await fetch(
        `${PHARMACIST_API_URL}/fetch-prescription-document`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: verificationData.documentId,
            documentHash: verificationData.documentHash,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      console.log("✅ Document fetched successfully:", data);

      setDocumentData(data);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching prescription document:", error);
      setError(`Failed to fetch document: ${error.message}`);
      setLoading(false);
    }
  };

  const downloadDocument = async () => {
    if (!verificationData.documentId) {
      setError("Please provide document ID");
      return;
    }

    try {
      console.log("🏥 Downloading prescription document...");

      const response = await fetch(
        `${PHARMACIST_API_URL}/download-prescription/${verificationData.documentId}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `prescription-${verificationData.documentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      console.log("✅ Document downloaded successfully");
    } catch (error) {
      console.error("Error downloading document:", error);
      setError(`Failed to download document: ${error.message}`);
    }
  };

  const fillDummyData = () => {
    setVerificationData({
      documentId: "doc-1734567890-xyz789abc",
      documentHash:
        "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <PharmacistHeader
        step={step}
        verificationResult={verificationResult}
        prescriptionResult={prescriptionResult}
        onReset={handleReset}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <StatusMessages error={error} success={success} />

        <PatientConnectionSection
          qrCodeUrl={qrCodeUrl}
          connections={connections}
          selectedConnection={selectedConnection}
          onConnectionSelect={setSelectedConnection}
          onRefreshConnections={fetchConnections}
        />

        <IdentityVerification
          selectedConnection={selectedConnection}
          loading={loading}
          verificationResult={verificationResult}
          onVerifyIdentity={verifyPatientIdentity}
        />

        <PrescriptionVerification
          selectedConnection={selectedConnection}
          loading={loading}
          prescriptionResult={prescriptionResult}
          verificationResult={verificationResult}
          onVerifyPrescription={verifyPrescription}
        />

        <DocumentManagement
          prescriptionResult={prescriptionResult}
          verificationData={verificationData}
          setVerificationData={setVerificationData}
          loading={loading}
          documentData={documentData}
          onFetchDocument={fetchPrescriptionDocument}
          onDownloadDocument={downloadDocument}
          onFillDummyData={fillDummyData}
        />
      </main>
    </div>
  );
}
