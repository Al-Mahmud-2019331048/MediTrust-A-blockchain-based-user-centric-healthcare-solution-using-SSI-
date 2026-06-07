// API service for interacting with SSI agents

// Agent endpoints
const AGENT_ENDPOINTS = {
  government: "http://localhost:4000",
  doctor: "http://localhost:4002",
  pharmacist: "http://localhost:4004",
};

// Check if agent is available
const checkAgentAvailability = async (agentType) => {
  try {
    const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/connections`, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    console.error(`Agent ${agentType} is not available:`, error);
    return false;
  }
};

// Create a connection invitation
export const createInvitation = async (agentType, label, alias) => {
  console.log(`Starting createInvitation for agent: ${agentType}`);
  try {
    // Check if the agent is available
    console.log(`Checking if agent ${agentType} is available...`);
    const isAvailable = await checkAgentAvailability(agentType);
    console.log(`Agent ${agentType} availability check result:`, isAvailable);

    if (!isAvailable) {
      console.error(`Agent ${agentType} is not available.`);
      throw new Error(
        `Agent ${agentType} is not available. Please ensure the agent service is running.`
      );
    }

    console.log(
      `Creating invitation for ${agentType} at ${AGENT_ENDPOINTS[agentType]}/create-invitation`
    );

    const requestBody = { label, alias };
    console.log("Request body:", requestBody);

    // Make the API request
    const response = await fetch(
      `${AGENT_ENDPOINTS[agentType]}/create-invitation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        // Add these options to help with CORS issues
        mode: "cors",
        credentials: "same-origin",
      }
    );

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Server error response: ${errorText}`);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Invitation created successfully:", data);
    return data;
  } catch (error) {
    console.error("Error creating invitation:", error);
    throw new Error(`Failed to create invitation: ${error.message}`);
  }
};

// Get connections
export const getConnections = async (agentType, connectionId = null) => {
  try {
    // Check if the agent is available
    const isAvailable = await checkAgentAvailability(agentType);
    if (!isAvailable) {
      console.warn(
        `Agent ${agentType} is not available. Returning empty connections list.`
      );
      return [];
    }

    console.log(`Getting connections for ${agentType}`);

    const url = connectionId
      ? `${AGENT_ENDPOINTS[agentType]}/connections?connectionId=${connectionId}`
      : `${AGENT_ENDPOINTS[agentType]}/connections`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error getting connections:", error);
    // Return empty array instead of throwing to prevent UI errors during polling
    return [];
  }
};

// Issue patient credential (government only)
export const issuePatientCredential = async (connectionId, patientData) => {
  try {
    // Check if the government agent is available
    const isAvailable = await checkAgentAvailability("government");
    if (!isAvailable) {
      throw new Error(
        "Government agent is not available. Please ensure the agent service is running."
      );
    }

    console.log(`Issuing patient credential for connection ${connectionId}`);

    const response = await fetch(
      `${AGENT_ENDPOINTS.government}/issue-credential`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          connectionId,
          name: patientData.name,
          age: patientData.age,
          email: patientData.email,
          nationalId: patientData.nationalId,
          medicalCondition: patientData.medicalCondition,
          bloodType: patientData.bloodType,
          emergencyContact: patientData.emergencyContact,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Patient credential issued successfully:", data);
    return data;
  } catch (error) {
    console.error("Error issuing patient credential:", error);
    throw new Error(`Failed to issue patient credential: ${error.message}`);
  }
};

// Send proof request
export const sendProofRequest = async (
  agentType,
  connectionId,
  proofRequestlabel
) => {
  try {
    const response = await fetch(
      `${AGENT_ENDPOINTS[agentType]}/send-proof-request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          connectionId,
          proofRequestlabel,
          version: "1.0",
        }),
      }
    );

    return await response.json();
  } catch (error) {
    console.error("Error sending proof request:", error);
    throw error;
  }
};

// Upload medical document (doctor only)
export const uploadMedicalDocument = async (file, patientDid, documentType) => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("patientDid", patientDid);
    formData.append("documentType", documentType);

    const response = await fetch(
      `${AGENT_ENDPOINTS.doctor}/medical-document/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    return await response.json();
  } catch (error) {
    console.error("Error uploading medical document:", error);
    throw error;
  }
};

// Verify medical document (pharmacist only)
export const verifyMedicalDocument = async (documentId, documentHash) => {
  try {
    const response = await fetch(
      `${AGENT_ENDPOINTS.pharmacist}/medical-document/verify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId,
          documentHash,
        }),
      }
    );

    return await response.json();
  } catch (error) {
    console.error("Error verifying medical document:", error);
    throw error;
  }
};

// Get medical document by ID
export const getMedicalDocument = async (documentId) => {
  try {
    const response = await fetch(
      `${AGENT_ENDPOINTS.pharmacist}/medical-document/${documentId}`
    );
    return await response.blob();
  } catch (error) {
    console.error("Error retrieving medical document:", error);
    throw error;
  }
};

// Send message
export const sendMessage = async (agentType, connectionId, message) => {
  try {
    const response = await fetch(`${AGENT_ENDPOINTS[agentType]}/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connectionId,
        message,
      }),
    });

    return await response.json();
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
};

// Get proof records
export const getProofRecords = async (agentType, proofRecordId = null) => {
  try {
    // Check if the agent is available
    const isAvailable = await checkAgentAvailability(agentType);
    if (!isAvailable) {
      console.warn(
        `Agent ${agentType} is not available. Returning empty proof records list.`
      );
      return [];
    }

    console.log(
      `Getting proof records for ${agentType}${
        proofRecordId ? ` with ID ${proofRecordId}` : ""
      }`
    );

    // For GET requests, we should use query parameters instead of a request body
    const url = proofRecordId
      ? `${AGENT_ENDPOINTS[agentType]}/proof-records?proofRecordId=${proofRecordId}`
      : `${AGENT_ENDPOINTS[agentType]}/proof-records`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error getting proof records:", error);
    // Return empty array instead of throwing to prevent UI errors during polling
    return [];
  }
};

// Get proof data
export const getProofData = async (agentType, proofRecordId) => {
  try {
    // Check if the agent is available
    const isAvailable = await checkAgentAvailability(agentType);
    if (!isAvailable) {
      console.warn(
        `Agent ${agentType} is not available. Returning empty proof data.`
      );
      return null;
    }

    console.log(`Getting proof data for ${agentType} with ID ${proofRecordId}`);

    const url = `${AGENT_ENDPOINTS[agentType]}/proof-data/${proofRecordId}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Add a convenience property to check verification status
    if (data) {
      // The Credo framework returns verification result in the data
      // We'll add an isVerified property for easier checking
      data.isVerified = true; // If we got data back, it's verified (the endpoint only returns data for verified proofs)
    }

    return data;
  } catch (error) {
    console.error("Error getting proof data:", error);
    return null;
  }
};

// Get proof verification status
export const getProofStatus = async (agentType, proofRecordId) => {
  try {
    // Check if the agent is available
    const isAvailable = await checkAgentAvailability(agentType);
    if (!isAvailable) {
      console.warn(
        `Agent ${agentType} is not available. Returning empty proof status.`
      );
      return {
        isVerified: false,
        state: "unknown",
        error: "Agent not available",
      };
    }

    console.log(
      `Getting proof status for ${agentType} with ID ${proofRecordId}`
    );

    const url = `${AGENT_ENDPOINTS[agentType]}/proof-status/${proofRecordId}`;

    const response = await fetch(url);

    if (!response.ok) {
      // If 404, the proof doesn't exist yet or anymore
      if (response.status === 404) {
        return { isVerified: false, state: "not_found" };
      }

      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error getting proof status:", error);
    return { isVerified: false, state: "error", error: error.message };
  }
};
