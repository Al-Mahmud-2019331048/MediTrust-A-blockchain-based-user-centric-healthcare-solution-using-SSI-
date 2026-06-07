"use client";
import Navigation from "@/components/Navigation";
import QRCodeDisplay from "@/components/QRCodeDisplay";
import React, { useEffect, useState } from "react";

export default function GovernmentPage() {
  const [step, setStep] = useState(1);
  const [invitation, setInvitation] = useState(null);
  const [connections, setConnections] = useState([]);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [userData, setUserData] = useState({
    name: "John Doe",
    age: "30",
    email: "john.doe@example.com",
    nationalId: "123456789",
    medicalCondition: "None",
    bloodType: "O+",
    emergencyContact: "Jane Doe - +1-555-123-4567",
  });
  const [issuanceResult, setIssuanceResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Track whether we're waiting for a new connection
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  // Store IDs of connections that already existed before we started waiting
  const [ignoredConnectionIds, setIgnoredConnectionIds] = useState([]);

  // Fetch connections periodically
  useEffect(() => {
    // Always fetch connections to show existing ones
    const fetchConnections = async () => {
      try {
        // Make a direct fetch call to get connections
        const response = await fetch("http://localhost:4000/connections");

        if (!response.ok) {
          throw new Error(`Failed to fetch connections: ${response.status}`);
        }

        const data = await response.json();
        console.log("Fetched connections:", data);

        // Filter out connections that aren't in a valid state
        const validConnections = data.filter((conn) => {
          return conn && conn.id && conn.state === "completed";
        });

        console.log("Valid completed connections:", validConnections);
        setConnections(validConnections);

        // If we're in step 1 and there are valid connections, show them
        if (step === 1 && validConnections.length > 0) {
          setSuccess(
            "Found existing connections. You can create a new invitation or use an existing connection."
          );
        }

        // Only auto-detect completed connections if we're in step 2, waiting for a connection,
        // and the connection was NOT present before we created the invitation
        if (
          step === 2 &&
          waitingForConnection &&
          validConnections.length > 0 &&
          !selectedConnection
        ) {
          const completedConnection = validConnections.find(
            (conn) =>
              conn.state === "completed" &&
              conn.alias === "identity-issuance" &&
              !ignoredConnectionIds.includes(conn.id)
          );

          if (completedConnection) {
            console.log("Found completed connection:", completedConnection);
            setSelectedConnection(completedConnection);
            setWaitingForConnection(false); // No longer waiting
            setStep(3);
            setSuccess(
              "Connection with Aries Bifold detected! Moving to credential issuance..."
            );
          }
        }
      } catch (err) {
        console.error("Error fetching connections:", err);
      }
    };

    fetchConnections();
    const interval = setInterval(fetchConnections, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, [step, selectedConnection, waitingForConnection, ignoredConnectionIds]);

  const handleCreateInvitation = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("Attempting to create government invitation directly...");

      // Make a direct fetch call to the backend
      const response = await fetch("http://localhost:4000/create-invitation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: "Government Identity Issuer",
          alias: "identity-issuance",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`
        );
      }

      const data = await response.json();
      console.log("Invitation created successfully:", data);

      if (!data || !data.invitationUrl) {
        throw new Error("Invalid invitation data received");
      }

      // Format the data to match what the component expects
      const formattedData = {
        invitation_url: data.invitationUrl,
        invitation: data.invitation,
      };

      // Clear any selected connection when creating a new invitation
      setSelectedConnection(null);

      // Ignore all current completed connections so we wait for a brand-new one
      setIgnoredConnectionIds(connections.map((c) => c.id));

      setInvitation(formattedData);

      // Set the flag to indicate we're waiting for a connection
      setWaitingForConnection(true);

      // Always go to step 2 (QR code page) when creating a new invitation
      setStep(2);
      setSuccess(
        "Invitation created successfully. Scan the QR code with your Aries Bifold app."
      );
    } catch (err) {
      console.error("Detailed invitation error:", err);
      setError("Failed to create invitation: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleIssueCredential = async () => {
    if (!selectedConnection) {
      setError("Please select a connection first");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      console.log("Attempting to issue credential directly...");
      console.log("Connection ID:", selectedConnection.id);
      console.log("User data:", userData);

      // Validate user data
      if (
        !userData.name ||
        !userData.age ||
        !userData.email ||
        !userData.nationalId ||
        !userData.medicalCondition ||
        !userData.bloodType ||
        !userData.emergencyContact
      ) {
        throw new Error("Please fill in all credential fields");
      }

      // Make a direct fetch call to the backend with individual fields
      const payload = {
        connectionId: selectedConnection.id,
        name: userData.name,
        age: userData.age,
        email: userData.email,
        nationalId: userData.nationalId,
        medicalCondition: userData.medicalCondition,
        bloodType: userData.bloodType,
        emergencyContact: userData.emergencyContact,
      };

      console.log("Sending credential request payload:", payload);

      const response = await fetch("http://localhost:4000/issue-credential", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Server responded with ${response.status}: ${errorText}`
        );
      }

      const result = await response.json();
      console.log("Credential issued successfully:", result);

      // Verify the credential was actually issued by checking the result
      if (!result) {
        throw new Error(
          "Credential was not properly issued. Please try again."
        );
      }

      setIssuanceResult(result);
      setStep(4);
    } catch (err) {
      console.error("Detailed credential issuance error:", err);
      setError("Failed to issue credential: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setUserData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <Navigation />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-xl">
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
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            🏛️ Government Identity Portal
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Secure Digital Identity Credential Issuance System for Citizens
          </p>

          {/* Reset Button */}
          <div className="flex justify-center">
            <button
              onClick={async () => {
                if (
                  window.confirm(
                    "Are you sure you want to reset? This will clear your current state and start fresh."
                  )
                ) {
                  setLoading(true);
                  try {
                    // Reset the frontend state
                    setStep(1);
                    setInvitation(null);
                    setConnections([]);
                    setSelectedConnection(null);
                    setIssuanceResult(null);
                    setUserData({
                      name: "John Doe",
                      age: "30",
                      email: "john.doe@example.com",
                      nationalId: "123456789",
                      medicalCondition: "None",
                      bloodType: "O+",
                      emergencyContact: "Jane Doe - +1-555-123-4567",
                    });

                    setSuccess(
                      "Interface has been reset. You can start fresh now."
                    );
                  } catch (err) {
                    console.error("Error resetting interface:", err);
                    setError("Failed to reset: " + err.message);
                  } finally {
                    setLoading(false);
                  }
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
              { number: 1, title: "Create Connection", icon: "🔗" },
              { number: 2, title: "Establish Link", icon: "📱" },
              { number: 3, title: "Issue Credential", icon: "📋" },
              { number: 4, title: "Complete", icon: "✅" },
            ].map((stepItem, index) => (
              <React.Fragment key={stepItem.number}>
                <div className="flex flex-col items-center">
                  <div
                    className={`flex items-center justify-center w-16 h-16 rounded-2xl transition-all duration-300 ${
                      step >= stepItem.number
                        ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-xl"
                        : "bg-white border-2 border-gray-200 text-gray-400 shadow-sm"
                    }`}
                  >
                    <span className="text-xl font-bold">
                      {step >= stepItem.number
                        ? stepItem.icon
                        : stepItem.number}
                    </span>
                  </div>
                  <div className="mt-3 text-center">
                    <p
                      className={`text-sm font-medium ${
                        step >= stepItem.number
                          ? "text-blue-600"
                          : "text-gray-500"
                      }`}
                    >
                      {stepItem.title}
                    </p>
                  </div>
                </div>
                {index < 3 && (
                  <div
                    className={`w-24 h-1 mx-4 transition-all duration-300 ${
                      step > stepItem.number
                        ? "bg-gradient-to-r from-blue-500 to-indigo-600"
                        : "bg-gray-200"
                    }`}
                  ></div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-8 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center mr-4">
                <svg
                  className="w-5 h-5 text-white"
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
              <p className="text-green-800 font-medium text-lg">{success}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-8 bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center mr-4">
                <svg
                  className="w-5 h-5 text-white"
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
              <p className="text-red-800 font-medium text-lg">{error}</p>
            </div>
          </div>
        )}

        {/* Main Content Card */}
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Step 1: Create Invitation or Select Connection */}
          {step === 1 && (
            <div className="p-8 lg:p-12">
              <div className="text-center mb-10">
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
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Establish Secure Connection
                </h2>
                <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
                  Create a secure connection invitation for citizens to
                  establish their digital identity credentials through our
                  government portal.
                </p>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
                  <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center mb-4">
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
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    Government Verified
                  </h3>
                  <p className="text-sm text-gray-600">
                    Official government authentication and verification system
                  </p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-100">
                  <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center mb-4">
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
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    Secure Protocol
                  </h3>
                  <p className="text-sm text-gray-600">
                    End-to-end encryption with Aries DIDComm technology
                  </p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl p-6 border border-purple-100">
                  <div className="w-12 h-12 bg-purple-500 rounded-2xl flex items-center justify-center mb-4">
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
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    Digital First
                  </h3>
                  <p className="text-sm text-gray-600">
                    Modern digital infrastructure for citizen services
                  </p>
                </div>
              </div>

              {/* Create Connection Button */}
              <div className="text-center mb-10">
                <button
                  onClick={handleCreateInvitation}
                  disabled={loading}
                  className="inline-flex items-center px-10 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-3xl disabled:opacity-50 disabled:cursor-not-allowed text-lg"
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
                      Creating Connection...
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
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                      Create New Connection
                      <svg
                        className="w-5 h-5 ml-3"
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
              </div>

              {/* Existing Connections */}
              {connections.length > 0 && (
                <div className="border-t border-gray-200 pt-10">
                  <div className="text-center mb-8">
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">
                      📋 Active Connections
                    </h3>
                    <p className="text-lg text-gray-600">
                      Use an existing connection to issue credentials
                      immediately
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {connections.map((conn) => (
                      <div
                        key={conn.id}
                        className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-2xl p-6 border border-gray-200 hover:shadow-lg transition-all duration-200"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                            <svg
                              className="w-5 h-5 text-white"
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
                          <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                            Active
                          </span>
                        </div>
                        <div className="mb-4">
                          <p className="text-sm font-semibold text-gray-900 mb-1">
                            Connection ID: {conn.id.substring(0, 12)}...
                          </p>
                          <p className="text-xs text-gray-500 mb-1">
                            Status: {conn.state}
                          </p>
                          <p className="text-xs text-gray-500 mb-1">
                            Label: {conn.theirLabel || "Unknown"}
                          </p>
                          <p className="text-xs text-gray-500">
                            Created:{" "}
                            {new Date(conn.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedConnection(conn);
                            setStep(3);
                          }}
                          className="w-full inline-flex items-center justify-center px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-medium rounded-xl hover:from-blue-600 hover:to-indigo-600 transform hover:scale-105 transition-all duration-200 shadow-lg"
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
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          Use Connection
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Display QR Code */}
          {step === 2 && invitation && (
            <div className="p-8 lg:p-12">
              <div className="text-center mb-10">
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
                      d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V4a1 1 0 00-1-1H5a1 1 0 00-1 1v3a1 1 0 001 1zm12 0h2a1 1 0 001-1V4a1 1 0 00-1-1h-2a1 1 0 00-1 1v3a1 1 0 001 1zM5 20h2a1 1 0 001-1v-3a1 1 0 00-1-1H5a1 1 0 00-1 1v3a1 1 0 001 1z"
                    />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  📱 Citizen Connection Portal
                </h2>
                <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
                  Present this QR code to the citizen to establish a secure
                  connection with their digital wallet
                </p>
              </div>

              {/* Side by side layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
                {/* QR Code Section */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 border border-blue-200">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      Secure QR Code
                    </h3>
                    <p className="text-sm text-gray-600">
                      Government-issued connection invitation
                    </p>
                  </div>
                  <div className="flex justify-center">
                    <QRCodeDisplay
                      invitationData={invitation}
                      showDebugInfo={false}
                    />
                  </div>
                </div>

                {/* Instructions Section */}
                <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-2xl p-8 border border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900 mb-6">
                    📋 Instructions for Citizens
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-4 mt-1">
                        <span className="text-white font-bold text-sm">1</span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          Open Your Digital Wallet
                        </p>
                        <p className="text-sm text-gray-600">
                          Launch your Aries Bifold mobile application
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-4 mt-1">
                        <span className="text-white font-bold text-sm">2</span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          Scan QR Code
                        </p>
                        <p className="text-sm text-gray-600">
                          Use the camera to scan the government QR code
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-4 mt-1">
                        <span className="text-white font-bold text-sm">3</span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          Accept Connection
                        </p>
                        <p className="text-sm text-gray-600">
                          Confirm the connection request in your wallet
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center mr-4 mt-1">
                        <span className="text-white font-bold text-sm">✓</span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">
                          Connection Established
                        </p>
                        <p className="text-sm text-gray-600">
                          Wait for automatic credential issuance
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Connection Status */}
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-2xl p-6 mb-8 border border-yellow-200">
                <div className="text-center">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center mr-4">
                      <svg
                        className="w-6 h-6 text-white animate-spin"
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
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Waiting for Citizen Connection
                      </h3>
                      <p className="text-sm text-gray-600">
                        The system will automatically detect when a citizen
                        connects
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Connections Display */}
              {connections.length > 0 && (
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 mb-8 border border-green-200">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 text-center">
                    🟢 Active Connections
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {connections.map((conn) => (
                      <div
                        key={conn.id}
                        className="bg-white rounded-xl p-4 shadow-sm border border-gray-200"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              Connection: {conn.id.substring(0, 12)}...
                            </p>
                            <p className="text-xs text-gray-500">
                              Status: {conn.state}
                            </p>
                            <p className="text-xs text-gray-500">
                              DID:{" "}
                              {conn.theirDid?.substring(0, 20) || "Unknown"}...
                            </p>
                          </div>
                          {conn.state === "completed" && (
                            <button
                              onClick={() => {
                                setSelectedConnection(conn);
                                setStep(3);
                              }}
                              className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-colors"
                            >
                              Use
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="text-center space-x-4">
                <button
                  onClick={() => {
                    setStep(1);
                    setInvitation(null);
                    setConnections([]);
                    setSelectedConnection(null);
                  }}
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium rounded-xl hover:from-gray-600 hover:to-gray-700 transform hover:scale-105 transition-all duration-200 shadow-lg"
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
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  Create New Invitation
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Issue Credential Form */}
          {step === 3 && selectedConnection && (
            <div className="p-8 lg:p-12">
              <div className="text-center mb-10">
                <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <svg
                    className="w-10 h-10 text-green-600"
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
                  📋 Issue Digital Identity Credential
                </h2>
                <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
                  Complete the citizen's information to issue their official
                  government digital identity credential
                </p>
              </div>

              {/* Connection Info Card */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 mb-8 border border-blue-200">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center mr-4">
                    <svg
                      className="w-5 h-5 text-white"
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
                      Connected Citizen
                    </h3>
                    <p className="text-sm text-gray-600">
                      Connection ID: {selectedConnection.id.substring(0, 16)}...
                    </p>
                  </div>
                </div>
              </div>

              {/* Credential Form */}
              <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-2xl p-8 border border-gray-200 mb-8">
                <h3 className="text-xl font-bold text-gray-900 mb-6">
                  👤 Citizen Information
                </h3>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 text-black">
                  {/* Personal Information Section */}
                  <div className="md:col-span-2">
                    <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
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
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                      Personal Details
                    </h4>
                  </div>

                  <div>
                    <label
                      htmlFor="name"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      Full Legal Name *
                    </label>
                    <input
                      type="text"
                      name="name"
                      id="name"
                      value={userData.name}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      placeholder="Enter full legal name"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="age"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      Age *
                    </label>
                    <input
                      type="number"
                      name="age"
                      id="age"
                      value={userData.age}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      placeholder="Enter age"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="email"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      Email Address *
                    </label>
                    <input
                      type="email"
                      name="email"
                      id="email"
                      value={userData.email}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      placeholder="Enter email address"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="nationalId"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      National ID Number *
                    </label>
                    <input
                      type="text"
                      name="nationalId"
                      id="nationalId"
                      value={userData.nationalId}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      placeholder="Enter national ID"
                      required
                    />
                  </div>

                  {/* Medical Information Section */}
                  <div className="md:col-span-2 mt-6">
                    <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                      <svg
                        className="w-5 h-5 mr-2 text-red-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                        />
                      </svg>
                      Medical Information
                    </h4>
                  </div>

                  <div>
                    <label
                      htmlFor="medicalCondition"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      Medical Condition *
                    </label>
                    <input
                      type="text"
                      name="medicalCondition"
                      id="medicalCondition"
                      value={userData.medicalCondition}
                      onChange={handleInputChange}
                      placeholder="e.g., None, Diabetes, Hypertension"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="bloodType"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      Blood Type *
                    </label>
                    <select
                      name="bloodType"
                      id="bloodType"
                      value={userData.bloodType}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      required
                    >
                      <option value="">Select Blood Type</option>
                      <option value="A+">A+</option>
                      <option value="A-">A-</option>
                      <option value="B+">B+</option>
                      <option value="B-">B-</option>
                      <option value="AB+">AB+</option>
                      <option value="AB-">AB-</option>
                      <option value="O+">O+</option>
                      <option value="O-">O-</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label
                      htmlFor="emergencyContact"
                      className="block text-sm font-semibold text-gray-700 mb-2"
                    >
                      Emergency Contact *
                    </label>
                    <input
                      type="text"
                      name="emergencyContact"
                      id="emergencyContact"
                      value={userData.emergencyContact}
                      onChange={handleInputChange}
                      placeholder="e.g., John Doe - +1234567890"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Quick Fill Section */}
              {/* <div className="text-center mb-8">
                <button
                  type="button"
                  onClick={() => {
                    setUserData({
                      name: "Alice Johnson",
                      age: "28",
                      email: "alice.johnson@email.com",
                      nationalId: "987654321",
                      medicalCondition: "Diabetes Type 1",
                      bloodType: "A+",
                      emergencyContact: "Bob Johnson - +1-555-987-6543",
                    });
                  }}
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium rounded-xl hover:from-gray-600 hover:to-gray-700 transform hover:scale-105 transition-all duration-200 shadow-lg"
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
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Fill Sample Data
                </button>
              </div> */}

              {/* Issue Credential Button */}
              <div className="text-center">
                <button
                  onClick={handleIssueCredential}
                  disabled={loading}
                  className="inline-flex items-center justify-center px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-2xl transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-3xl disabled:opacity-50 disabled:cursor-not-allowed text-lg w-full max-w-md mx-auto"
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
                      <span>Issuing Credential...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-6 h-6 mr-3 flex-shrink-0"
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
                      <span className="flex-1">
                        Issue Government Credential
                      </span>
                      <svg
                        className="w-5 h-5 ml-3 flex-shrink-0"
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
                  This will create a verifiable digital identity credential
                </p>
              </div>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && issuanceResult && (
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
                  {/* Animated success rings */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-32 h-32 border-4 border-green-300 rounded-full animate-ping opacity-20"></div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-40 h-40 border-2 border-green-200 rounded-full animate-pulse opacity-30"></div>
                  </div>
                </div>

                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                  🎉 Credential Successfully Issued!
                </h2>
                <p className="text-xl text-gray-600 mb-2 max-w-2xl mx-auto">
                  Digital identity credential has been securely issued to the
                  citizen's wallet
                </p>
                <p className="text-lg text-gray-500 max-w-xl mx-auto">
                  The citizen can now use this credential for verified
                  government services
                </p>
              </div>

              {/* Success Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                {/* Issuance Status */}
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
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Issuance Status
                      </h3>
                      <p className="text-sm text-gray-600">
                        Successfully Completed
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                      <span className="text-sm font-medium text-gray-700">
                        Credential Active
                      </span>
                    </div>
                  </div>
                </div>

                {/* Security Level */}
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
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Security Level
                      </h3>
                      <p className="text-sm text-gray-600">Government Grade</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                      <span className="text-sm font-medium text-gray-700">
                        High Security
                      </span>
                    </div>
                  </div>
                </div>

                {/* Verification Status */}
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
                          d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h2m0 0h6a2 2 0 002-2V7a2 2 0 00-2-2h-6m0 0v5m0 0V9a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H9z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Verification
                      </h3>
                      <p className="text-sm text-gray-600">
                        Cryptographically Signed
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
                      <span className="text-sm font-medium text-gray-700">
                        Verifiable
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Credential Details */}
              <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-2xl p-8 border border-gray-200 mb-8">
                <div className="flex items-center mb-6">
                  <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center mr-4">
                    <svg
                      className="w-5 h-5 text-white"
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
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">
                      📄 Credential Issuance Details
                    </h3>
                    <p className="text-sm text-gray-600">
                      Technical information about the issued credential
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <div className="overflow-auto">
                    <pre className="text-sm text-gray-800 font-mono leading-relaxed whitespace-pre-wrap">
                      {JSON.stringify(issuanceResult, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="text-center space-y-4">
                <button
                  onClick={() => {
                    setStep(1);
                    setInvitation(null);
                    setSelectedConnection(null);
                    setIssuanceResult(null);
                    setUserData({
                      name: "John Doe",
                      age: "30",
                      email: "john.doe@example.com",
                      nationalId: "123456789",
                      medicalCondition: "None",
                      bloodType: "O+",
                      emergencyContact: "Jane Doe - +1-555-123-4567",
                    });
                  }}
                  className="inline-flex items-center px-10 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-300 shadow-2xl hover:shadow-3xl text-lg"
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
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  Issue Another Credential
                  <svg
                    className="w-5 h-5 ml-3"
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
                </button>

                <p className="text-sm text-gray-500">
                  Ready to issue credentials for more citizens
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
