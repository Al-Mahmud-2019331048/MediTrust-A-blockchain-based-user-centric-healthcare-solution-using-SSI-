import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import multer from "multer";
import { BaseAgent } from "./agent";

// Import document handling functionality
import { initDatabase } from "./src/lib/database";
import { setupDocumentRoutes } from "./src/routes/document-routes";
import { DocumentService } from "./src/services/document-service";

dotenv.config();

// Determine agent type from command line arguments
const agentType = process.argv[2];
console.log(`Starting server with agent type: ${agentType}`);
console.log(
  "Agent public endpoint: ",
  process.env.ISSUER_AGENT_PUBLIC_ENDPOINT
);

// Configure ports based on agent type
const port =
  agentType === "--issuer"
    ? parseInt(process.env.ISSUER_API_PORT || "4000")
    : agentType === "--doctor"
    ? parseInt(process.env.DOCTOR_API_PORT || "4002")
    : parseInt(process.env.PHARMACIST_API_PORT || "4004");

// Configure agent endpoints
const agentPublicEndpoint =
  (agentType === "--issuer"
    ? process.env.ISSUER_AGENT_PUBLIC_ENDPOINT
    : agentType === "--doctor"
    ? process.env.DOCTOR_AGENT_PUBLIC_ENDPOINT
    : process.env.PHARMACIST_AGENT_PUBLIC_ENDPOINT) ||
  `http://localhost:${port}`;

// Configure agent labels
const agentLabel =
  (agentType === "--issuer"
    ? process.env.ISSUER_AGENT_LABEL
    : agentType === "--doctor"
    ? process.env.DOCTOR_AGENT_LABEL
    : process.env.PHARMACIST_AGENT_LABEL) || "MyAgent";

// Configure agent DIDs
const agentDid =
  agentType === "--issuer"
    ? process.env.ISSUER_DID!
    : agentType === "--doctor"
    ? process.env.DOCTOR_DID!
    : process.env.PHARMACIST_DID!;

const agentSeed =
  agentType === "--issuer"
    ? process.env.ISSUER_SEED!
    : agentType === "--doctor"
    ? process.env.DOCTOR_SEED!
    : process.env.PHARMACIST_SEED!;

// Log the agent configuration for debugging
console.log(`Initializing agent with the following configuration:`);
console.log(`- Agent Type: ${agentType}`);
console.log(`- API Port: ${port}`);
console.log(`- Agent Port: ${port + 1}`);
console.log(`- Public Endpoint: ${agentPublicEndpoint}`);

// Initialize the agent
const agent = new BaseAgent({
  port: port + 1,
  label: agentLabel,
  publicEndpoint: agentPublicEndpoint,
});

// Cache for proof verification status
interface ProofStatusCache {
  [proofId: string]: {
    state: string;
    isVerified: boolean;
    timestamp: number;
    connectionId?: string;
  };
}

// In-memory cache for proof verification status
const proofStatusCache: ProofStatusCache = {};

// Update proof status in cache
const updateProofStatus = (
  proofId: string,
  state: string,
  isVerified: boolean = false,
  connectionId?: string
) => {
  proofStatusCache[proofId] = {
    state,
    isVerified,
    timestamp: Date.now(),
    connectionId,
  };
  console.log(
    `Updated proof status cache for ${proofId}: ${state}, verified: ${isVerified}`
  );
};

// Clear the proof status cache
const clearProofStatusCache = () => {
  const count = Object.keys(proofStatusCache).length;
  Object.keys(proofStatusCache).forEach((key) => {
    delete proofStatusCache[key];
  });
  console.log(`Cleared proof status cache (${count} entries removed)`);
  return count;
};

// Store credential definition ID for later use
let credentialDefinitionId: string = "";

// Initialize Express app
const app = express();
app.use(express.json());
// Configure CORS to allow requests from any origin
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Initialize agent and create schemas/credential definitions
const initializeAgent = async () => {
  try {
    // Initialize MongoDB database connection
    await initDatabase();
    console.log("MongoDB database initialized successfully");

    // Initialize agent
    await agent.init();
    console.log(`${agentLabel} Agent initialized successfully.`);

    // Set up proof state change listener using the public method
    agent.registerProofStateListener((proofRecord) => {
      console.log(
        `Proof state change detected: ${proofRecord.state} for ID: ${proofRecord.id}`
      );

      // Consider these states as verified
      const verifiedStates = [
        "done",
        "presentation-received",
        "request-received",
        "presentation-sent",
      ];
      const isVerified = verifiedStates.includes(proofRecord.state);

      console.log(
        `Updating proof status: ${proofRecord.state} (verified: ${isVerified})`
      );
      updateProofStatus(
        proofRecord.id,
        proofRecord.state,
        isVerified,
        proofRecord.connectionId
      );
    });

    if (agentType === "--issuer") {
      try {
        // Import the DID for the issuer agent
        await agent.importDid(agentDid, agentSeed);
        console.log("DID imported successfully.");

        // Create a schema for patient credentials
        const schemaTemplate = {
          name: "patient_credential",
          version: `1.1.${Math.floor(Math.random() * 100)}`,
          attrNames: [
            "name",
            "age",
            "email",
            "nationalId",
            "medicalCondition",
            "bloodType",
            "emergencyContact",
          ],
          issuerId: agentDid,
        };

        console.log("Creating patient schema with template:", schemaTemplate);
        const schemaResp = await agent.createSchema(agentDid, schemaTemplate);
        console.log("Patient schema creation response:", schemaResp);

        if (schemaResp.schemaState.state !== "finished") {
          throw new Error(
            "Patient schema creation error: " + JSON.stringify(schemaResp)
          );
        }

        const schemaId = schemaResp.schemaState.schemaId;
        console.log(`Patient schema created successfully with ID: ${schemaId}`);

        // Create a credential definition for patient credentials
        console.log(
          `Creating patient credential definition with schema ID: ${schemaId}`
        );
        const credDefResp = await agent.createCredentialDefinition(
          agentDid,
          schemaId,
          "patient_id_credential"
        );
        console.log("Patient credential definition response:", credDefResp);

        if (credDefResp.credentialDefinitionState.state !== "finished") {
          throw new Error(
            "Patient credential definition creation error: " +
              JSON.stringify(credDefResp)
          );
        }

        credentialDefinitionId =
          credDefResp.credentialDefinitionState.credentialDefinitionId;
        console.log(
          `Patient credential definition created successfully with ID: ${credentialDefinitionId}`
        );

        // Set up issuer-specific routes after credentialDefinitionId is available
        setupIssuerRoutes();
      } catch (error) {
        console.error("Error initializing issuer agent:", error);
      }
    } else if (agentType === "--doctor") {
      try {
        console.log("=== STARTING DOCTOR AGENT INITIALIZATION ===");

        // Import the DID for the doctor agent (same approach as government)
        await agent.importDid(agentDid, agentSeed);
        console.log("✅ Doctor DID imported successfully.");

        // Create medical document schema (similar to government's patient schema)
        const medicalSchemaTemplate = {
          name: "medical_document_credential",
          version: `1.0.${Math.floor(Math.random() * 100)}`,
          attrNames: [
            "documentId",
            "documentType",
            "documentHash",
            "patientName",
            "patientId",
            "diagnosis",
            "prescription",
            "issuedBy",
            "issuedAt",
          ],
          issuerId: agentDid,
        };

        console.log(
          "📋 Creating medical document schema with template:",
          medicalSchemaTemplate
        );
        const schemaResp = await agent.createSchema(
          agentDid,
          medicalSchemaTemplate
        );
        console.log(
          "📋 Medical document schema creation response:",
          schemaResp
        );

        if (schemaResp.schemaState.state !== "finished") {
          throw new Error(
            "Medical document schema creation error: " +
              JSON.stringify(schemaResp)
          );
        }

        const schemaId = schemaResp.schemaState.schemaId;
        console.log(
          `✅ Medical document schema created successfully with ID: ${schemaId}`
        );

        // Create a credential definition for medical document credentials
        console.log(
          `🏗️ Creating medical document credential definition with schema ID: ${schemaId}`
        );
        const credDefResp = await agent.createCredentialDefinition(
          agentDid,
          schemaId,
          "medical_document_credential"
        );
        console.log(
          "🏗️ Medical document credential definition response:",
          credDefResp
        );

        if (credDefResp.credentialDefinitionState.state !== "finished") {
          throw new Error(
            "Medical document credential definition creation error: " +
              JSON.stringify(credDefResp)
          );
        }

        credentialDefinitionId =
          credDefResp.credentialDefinitionState.credentialDefinitionId;
        console.log(
          `✅ Medical document credential definition created successfully with ID: ${credentialDefinitionId}`
        );

        // Store the credential definition ID in the environment for reference
        process.env.DOCTOR_MEDICAL_CRED_DEF_ID = credentialDefinitionId;

        // Set up doctor-specific routes (similar to issuer routes)
        setupDoctorRoutes();

        console.log(
          "✅ Doctor agent initialized successfully with medical document credentials"
        );
      } catch (error) {
        console.error("❌ Error initializing doctor agent:", error);

        // Fallback: use a dummy credential definition ID
        credentialDefinitionId = "dummy-credential-definition-id-for-doctor";
        process.env.DOCTOR_MEDICAL_CRED_DEF_ID = credentialDefinitionId;

        // Still set up routes even if initialization failed
        setupDoctorRoutes();

        console.log("⚠️ Doctor agent running with fallback configuration");
      }
    } else if (agentType === "--pharmacist") {
      try {
        console.log("=== STARTING PHARMACIST AGENT INITIALIZATION ===");

        // Import the DID for the pharmacist agent
        await agent.importDid(agentDid, agentSeed);
        console.log("✅ Pharmacist DID imported successfully.");

        // Pharmacist doesn't need to create schemas/credential definitions
        // It acts as a verifier only
        credentialDefinitionId = "pharmacist-verifier-only";

        // Set up pharmacist-specific routes
        setupPharmacistRoutes();

        console.log("✅ Pharmacist agent initialized successfully as verifier");
      } catch (error) {
        console.error("❌ Error initializing pharmacist agent:", error);

        // Fallback: use a dummy credential definition ID
        credentialDefinitionId =
          "dummy-credential-definition-id-for-pharmacist";

        // Still set up routes even if initialization failed
        setupPharmacistRoutes();

        console.log("⚠️ Pharmacist agent running with fallback configuration");
      }
    }

    // NOW that credentialDefinitionId is finalized for this agent, set up document routes
    console.log(
      `Setting up document routes with credential definition ID: ${credentialDefinitionId}`
    );
    setupDocumentRoutes(app, agent, agentDid, credentialDefinitionId, upload);
  } catch (error) {
    console.error("Error initializing agent:", error);
  }
};

// Function to set up issuer-specific routes
const setupIssuerRoutes = () => {
  console.log("Setting up issuer-specific routes...");

  // Issue identity credential
  app.post("/issue-credential", async (req: Request, res: Response) => {
    const {
      connectionId,
      name,
      email,
      age,
      nationalId,
      medicalCondition,
      bloodType,
      emergencyContact,
    } = req.body;
    if (!connectionId) {
      return res.status(400).send({ error: "connectionId is required" });
    }
    if (!credentialDefinitionId) {
      return res
        .status(400)
        .send({ error: "credentialDefinitionId is required" });
    }

    // Validate attribute values
    if (
      !name ||
      !email ||
      !age ||
      !nationalId ||
      !medicalCondition ||
      !bloodType ||
      !emergencyContact
    ) {
      console.log("Missing attributes, using default values where needed");
    }

    // Prepare attributes for credential
    const attributes = [
      {
        name: "name",
        value: `${name ?? "John Doe"}`,
      },
      {
        name: "age",
        value: `${age ?? 30}`,
      },
      {
        name: "email",
        value: `${email ?? "patient@example.com"}`,
      },
      {
        name: "nationalId",
        value: `${nationalId ?? "123456789"}`,
      },
      {
        name: "medicalCondition",
        value: `${medicalCondition ?? "None"}`,
      },
      {
        name: "bloodType",
        value: `${bloodType ?? "O+"}`,
      },
      {
        name: "emergencyContact",
        value: `${emergencyContact ?? "555-123-4567"}`,
      },
    ];

    // Validate attribute format
    for (const attribute of attributes) {
      if (!attribute.name || !attribute.value) {
        return res
          .status(400)
          .send({ error: "All attributes must have a name and value" });
      }
    }

    try {
      console.log(
        `Issuing credential with definition ID: ${credentialDefinitionId}`
      );
      console.log("Attributes:", attributes);

      // Issue the credential using the AnonCreds format
      const result = await agent.issueAnonCredsCredential(
        connectionId,
        credentialDefinitionId,
        attributes
      );

      console.log("Credential issuance initiated successfully:", result.id);
      res.status(200).send({
        success: true,
        credentialId: result.id,
        message: "Identity credential issuance initiated successfully",
        state: result.state,
      });
    } catch (error) {
      console.error("Error issuing credential:", error);

      // Attempt to issue W3C credential as fallback
      try {
        console.log("Attempting to issue W3C credential as fallback...");
        if (typeof agent.offerW3cCredential === "function") {
          const w3cCredential = {
            type: ["VerifiableCredential", "IdentityCredential"],
            issuer: agentDid,
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
              id: connectionId,
              name: attributes.find((a) => a.name === "name")?.value,
              age: attributes.find((a) => a.name === "age")?.value,
              email: attributes.find((a) => a.name === "email")?.value,
              nationalId: attributes.find((a) => a.name === "nationalId")
                ?.value,
              medicalCondition: attributes.find(
                (a) => a.name === "medicalCondition"
              )?.value,
              bloodType: attributes.find((a) => a.name === "bloodType")?.value,
              emergencyContact: attributes.find(
                (a) => a.name === "emergencyContact"
              )?.value,
            },
          };

          const w3cResult = await agent.offerW3cCredential(
            connectionId,
            w3cCredential
          );
          console.log("W3C credential offered as fallback:", w3cResult.id);

          return res.status(200).send({
            success: true,
            credentialId: w3cResult.id,
            message: "W3C credential issuance initiated as fallback",
            isW3C: true,
          });
        }
      } catch (w3cError) {
        console.error("Error issuing W3C credential fallback:", w3cError);
      }

      res.status(500).send({ error: error.message });
    }
  });

  // Debug endpoint for credential definitions
  app.get(
    "/debug-credential-definitions",
    async (req: Request, res: Response) => {
      try {
        // Get all credential definitions
        const credDefs = await agent.getCredentialDefinition();
        console.log("All credential definitions:", credDefs);

        // Get the current credential definition if available
        let currentCredDef = null;
        if (credentialDefinitionId) {
          currentCredDef = await agent.getCredentialDefinition(
            credentialDefinitionId
          );
          console.log("Current credential definition:", currentCredDef);
        }

        res.status(200).send({
          success: true,
          allCredentialDefinitions: credDefs,
          currentCredentialDefinitionId: credentialDefinitionId,
          currentCredentialDefinition: currentCredDef,
        });
      } catch (error) {
        console.error("Error getting credential definitions:", error);
        res.status(500).send({ error: error.message });
      }
    }
  );

  // Get issued credentials
  app.get("/issued-credentials", async (req: Request, res: Response) => {
    const { credentialId } = req.query;

    try {
      const result = await agent.getIssuedCredenitalRecords(
        credentialId as string
      );
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Add endpoint to register doctor DID with ENDORSER role
  app.post("/register-doctor-did", async (req: Request, res: Response) => {
    try {
      const { doctorDid, doctorVerkey, alias } = req.body;

      console.log(`Manual DID registration required for: ${doctorDid}`);
      console.log(`Verkey: ${doctorVerkey}`);

      // Return instructions for manual registration
      return res.status(200).json({
        success: true,
        message: "Doctor DID needs to be registered manually",
        instructions: [
          "The doctor DID needs ENDORSER role to create schemas/credential-definitions",
          "Options to register:",
          "1. Use indy-cli to submit a NYM transaction",
          "2. Use the BCovrin Test Network web interface",
          "3. Ask a steward to register the DID with ENDORSER role",
          "For now, the doctor will fall back to using government's credential definition",
        ],
        doctorDid,
        doctorVerkey,
        fallbackStrategy: "Use government's existing credential definition",
      });
    } catch (error) {
      console.error("Error registering doctor DID:", error);
      return res.status(500).json({
        error: "Failed to register doctor DID",
        details: error.message,
      });
    }
  });

  // Create medical document schema and credential definition for doctor use
  app.post(
    "/create-medical-credential-definition",
    async (req: Request, res: Response) => {
      try {
        console.log(
          "🏥 Creating medical document schema and credential definition..."
        );

        // Create medical document schema
        const medicalSchema = {
          name: "medical_document_credential",
          version: "1.0.0",
          attrNames: [
            "documentId",
            "documentType",
            "documentHash",
            "documentCid",
            "issuedBy",
            "issuedAt",
          ],
          issuerId: agentDid,
        };

        console.log("📋 Creating medical document schema:", medicalSchema);
        const schemaResp = await agent.createSchema(agentDid, medicalSchema);
        console.log("📋 Medical document schema response:", schemaResp);

        if (schemaResp.schemaState.state !== "finished") {
          throw new Error(
            "Medical document schema creation failed: " +
              JSON.stringify(schemaResp)
          );
        }

        const schemaId = schemaResp.schemaState.schemaId;
        console.log("✅ Medical document schema created with ID:", schemaId);

        // Create credential definition for medical documents
        console.log("🏗️ Creating medical document credential definition...");
        const credDefResp = await agent.createCredentialDefinition(
          agentDid,
          schemaId,
          "medical_document"
        );
        console.log(
          "🏗️ Medical document credential definition response:",
          credDefResp
        );

        if (credDefResp.credentialDefinitionState.state !== "finished") {
          throw new Error(
            "Medical document credential definition creation failed: " +
              JSON.stringify(credDefResp)
          );
        }

        const medicalCredDefId =
          credDefResp.credentialDefinitionState.credentialDefinitionId;
        console.log(
          "✅ Medical document credential definition created with ID:",
          medicalCredDefId
        );

        // Store in environment for reference
        process.env.GOVERNMENT_MEDICAL_CRED_DEF_ID = medicalCredDefId;

        return res.status(200).json({
          success: true,
          message:
            "Medical document credential definition created successfully",
          schemaId,
          credentialDefinitionId: medicalCredDefId,
          instructions: [
            "The doctor agent can now use this credential definition to issue medical document credentials",
            `Set GOVERNMENT_MEDICAL_CRED_DEF_ID=${medicalCredDefId} in doctor's environment`,
            "Restart the doctor agent to use this credential definition",
          ],
        });
      } catch (error) {
        console.error(
          "❌ Error creating medical credential definition:",
          error
        );
        return res.status(500).json({
          error: "Failed to create medical credential definition",
          details: error.message,
        });
      }
    }
  );

  // Add endpoint for government to issue medical document credentials
  app.post("/issue-medical-credential", async (req: Request, res: Response) => {
    const {
      connectionId,
      documentId,
      documentType,
      documentHash,
      documentCid,
      issuedBy,
      issuedAt,
    } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required" });
    }

    const governmentCredDefId = process.env.GOVERNMENT_MEDICAL_CRED_DEF_ID;
    if (!governmentCredDefId) {
      return res.status(400).json({
        error:
          "Medical credential definition not found. Run setup-medical-credentials.js first",
      });
    }

    // Validate required attributes
    if (
      !documentId ||
      !documentType ||
      !documentHash ||
      !issuedBy ||
      !issuedAt
    ) {
      return res.status(400).json({
        error:
          "Missing required attributes: documentId, documentType, documentHash, issuedBy, issuedAt",
      });
    }

    try {
      console.log("🏥 Government issuing medical document credential...");
      console.log("Connection ID:", connectionId);
      console.log("Credential Definition ID:", governmentCredDefId);

      // Prepare attributes for medical document credential
      const attributes = [
        { name: "documentId", value: documentId },
        { name: "documentType", value: documentType },
        { name: "documentHash", value: documentHash },
        { name: "documentCid", value: documentCid || "N/A" },
        { name: "issuedBy", value: issuedBy },
        { name: "issuedAt", value: issuedAt },
      ];

      console.log("Credential attributes:", attributes);

      const result = await agent.issueAnonCredsCredential(
        connectionId,
        governmentCredDefId,
        attributes
      );

      console.log("✅ Medical document credential issued successfully");

      res.status(200).json({
        success: true,
        message: "Medical document credential issued successfully",
        credentialExchangeId: result.id,
        threadId: result.threadId,
        state: result.state,
      });
    } catch (error) {
      console.error("❌ Error issuing medical document credential:", error);
      res.status(500).json({
        error: "Failed to issue medical document credential",
        details: error.message,
      });
    }
  });

  console.log("Issuer-specific routes set up successfully");
};

// Function to set up doctor-specific routes (similar to issuer routes)
const setupDoctorRoutes = () => {
  console.log("Setting up doctor-specific routes...");

  // Issue medical document credential directly from doctor
  app.post("/issue-medical-credential", async (req: Request, res: Response) => {
    const {
      connectionId,
      documentId,
      documentType,
      documentHash,
      patientName,
      patientId,
      diagnosis,
      prescription,
      issuedBy,
      issuedAt,
    } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required" });
    }

    if (
      !credentialDefinitionId ||
      credentialDefinitionId.startsWith("dummy-")
    ) {
      return res.status(400).json({
        error:
          "Medical credential definition not available. Doctor agent initialization may have failed.",
      });
    }

    // Validate required attributes
    if (!documentId || !documentType || !issuedBy || !issuedAt) {
      return res.status(400).json({
        error:
          "Missing required attributes: documentId, documentType, issuedBy, issuedAt",
      });
    }

    try {
      console.log("🏥 Doctor issuing medical document credential...");
      console.log("Connection ID:", connectionId);
      console.log("Credential Definition ID:", credentialDefinitionId);

      // Prepare attributes for medical document credential
      const attributes = [
        { name: "documentId", value: documentId },
        { name: "documentType", value: documentType },
        { name: "documentHash", value: documentHash || `hash-${Date.now()}` },
        { name: "patientName", value: patientName || "Unknown Patient" },
        { name: "patientId", value: patientId || "Unknown ID" },
        { name: "diagnosis", value: diagnosis || "Not specified" },
        { name: "prescription", value: prescription || "Not specified" },
        { name: "issuedBy", value: issuedBy },
        { name: "issuedAt", value: issuedAt },
      ];

      console.log("Credential attributes:", attributes);

      const result = await agent.issueAnonCredsCredential(
        connectionId,
        credentialDefinitionId,
        attributes
      );

      console.log("✅ Medical document credential issued successfully");

      res.status(200).json({
        success: true,
        message: "Medical document credential issued successfully by doctor",
        credentialExchangeId: result.id,
        threadId: result.threadId,
        state: result.state,
      });
    } catch (error) {
      console.error("❌ Error issuing medical document credential:", error);
      res.status(500).json({
        error: "Failed to issue medical document credential",
        details: error.message,
      });
    }
  });

  // Issue prescription credential (simplified version)
  app.post("/issue-prescription", async (req: Request, res: Response) => {
    const {
      connectionId,
      patientName,
      patientId,
      diagnosis,
      prescription,
      documentId,
    } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required" });
    }

    if (
      !credentialDefinitionId ||
      credentialDefinitionId.startsWith("dummy-")
    ) {
      // Fallback to structured message
      console.log("🔄 Using structured message fallback for prescription");

      const prescriptionMessage = {
        "@type": "https://didcomm.org/issue-credential/2.0/credential",
        "@id": `prescription-${Date.now()}`,
        credential: {
          type: ["VerifiableCredential", "PrescriptionCredential"],
          issuer: agentDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: connectionId,
            documentId: documentId || `prescription-${Date.now()}`,
            documentType: "prescription",
            patientName: patientName || "Unknown Patient",
            patientId: patientId || "Unknown ID",
            diagnosis: diagnosis || "Not specified",
            prescription: prescription || "Not specified",
            issuedBy: agentDid,
            issuedAt: new Date().toISOString(),
          },
        },
        "~please_ack": {},
      };

      try {
        const messageResult = await agent.sendMessage(
          connectionId,
          JSON.stringify(prescriptionMessage, null, 2)
        );

        return res.status(200).json({
          success: true,
          credentialId: messageResult.id,
          message: "Prescription sent as structured message",
          credentialType: "StructuredMessage",
        });
      } catch (error) {
        return res.status(500).json({
          error: "Failed to send prescription message",
          details: error.message,
        });
      }
    }

    // Use formal credential issuance
    try {
      const attributes = [
        {
          name: "documentId",
          value: documentId || `prescription-${Date.now()}`,
        },
        { name: "documentType", value: "prescription" },
        { name: "documentHash", value: `hash-${Date.now()}` },
        { name: "patientName", value: patientName || "Unknown Patient" },
        { name: "patientId", value: patientId || "Unknown ID" },
        { name: "diagnosis", value: diagnosis || "Not specified" },
        { name: "prescription", value: prescription || "Not specified" },
        { name: "issuedBy", value: agentDid },
        { name: "issuedAt", value: new Date().toISOString() },
      ];

      const result = await agent.issueAnonCredsCredential(
        connectionId,
        credentialDefinitionId,
        attributes
      );

      res.status(200).json({
        success: true,
        credentialId: result.id,
        message: "Prescription credential issued successfully",
        state: result.state,
      });
    } catch (error) {
      console.error("Error issuing prescription credential:", error);
      res.status(500).json({
        error: "Failed to issue prescription credential",
        details: error.message,
      });
    }
  });

  // Get issued medical credentials
  app.get(
    "/issued-medical-credentials",
    async (req: Request, res: Response) => {
      const { credentialId } = req.query;

      try {
        const result = await agent.getIssuedCredenitalRecords(
          credentialId as string
        );
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    }
  );

  // Debug endpoint for doctor's credential definitions
  app.get(
    "/debug-medical-credential-definitions",
    async (req: Request, res: Response) => {
      try {
        const credDefs = await agent.getCredentialDefinition();
        console.log("Doctor's credential definitions:", credDefs);

        let currentCredDef = null;
        if (credentialDefinitionId) {
          currentCredDef = await agent.getCredentialDefinition(
            credentialDefinitionId
          );
          console.log("Current medical credential definition:", currentCredDef);
        }

        res.status(200).send({
          success: true,
          allCredentialDefinitions: credDefs,
          currentCredentialDefinitionId: credentialDefinitionId,
          currentCredentialDefinition: currentCredDef,
          agentType: "doctor",
        });
      } catch (error) {
        console.error("Error getting medical credential definitions:", error);
        res.status(500).send({ error: error.message });
      }
    }
  );

  console.log("Doctor-specific routes set up successfully");
};

// Function to set up pharmacist-specific routes (verifier like doctor)
const setupPharmacistRoutes = () => {
  console.log("Setting up pharmacist-specific routes...");

  // Verify prescription credential (similar to doctor's identity verification)
  app.post("/verify-prescription", async (req: Request, res: Response) => {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required" });
    }

    try {
      console.log("🏥 Pharmacist requesting prescription verification...");
      console.log("Connection ID:", connectionId);

      // Send a message to the patient that prescription verification is about to start
      await agent.sendMessage(
        connectionId,
        "Please prepare to share your prescription credentials for verification."
      );

      // Request proof of prescription credentials from doctor
      const doctorCredDefId = process.env.DOCTOR_MEDICAL_CRED_DEF_ID;

      let requestAttributes = {};

      if (doctorCredDefId && !doctorCredDefId.startsWith("dummy-")) {
        // Request specific prescription attributes from doctor's credential definition
        requestAttributes = {
          prescription_info: {
            names: [
              "documentId",
              "documentType",
              "documentHash",
              "patientName",
              "diagnosis",
              "prescription",
              "issuedBy",
              "issuedAt",
            ],
            restriction: [{ cred_def_id: doctorCredDefId }],
          },
        };
      } else {
        // Fallback: request any medical document credentials
        requestAttributes = {
          prescription_info: {
            names: [
              "documentId",
              "documentType",
              "documentHash",
              "issuedBy",
              "issuedAt",
            ],
            restriction: [], // No restriction if no specific credential definition
          },
        };
      }

      const result = await agent.sendProofRequest({
        proofRequestlabel: "prescription-verification",
        connectionId,
        version: "1.0",
        attributes: requestAttributes,
        predicates: {},
      });

      console.log("✅ Prescription proof request sent:", result.id);

      res.status(200).json({
        success: true,
        message: "Prescription verification request sent successfully",
        proofRecordId: result.id,
        threadId: result.threadId,
        state: result.state,
      });
    } catch (error) {
      console.error("❌ Error requesting prescription verification:", error);
      res.status(500).json({
        error: "Failed to request prescription verification",
        details: error.message,
      });
    }
  });

  // Get prescription document from database using metadata
  app.post(
    "/fetch-prescription-document",
    async (req: Request, res: Response) => {
      const { documentId, documentHash } = req.body;

      if (!documentId) {
        return res.status(400).json({ error: "documentId is required" });
      }

      try {
        console.log("🏥 Pharmacist fetching prescription document...");
        console.log("Document ID:", documentId);
        console.log("Document Hash:", documentHash);

        // Verify and fetch document from database
        const verification = await DocumentService.verifyDocument(
          documentId,
          documentHash || ""
        );

        if (!verification.verified) {
          return res.status(400).json({
            verified: false,
            reason: verification.reason,
            documentId,
          });
        }

        // Get the full document if verification passed
        const document = await DocumentService.getDocument(documentId);

        if (!document) {
          return res.status(404).json({
            error: "Document not found in database",
            documentId,
          });
        }

        console.log("✅ Prescription document fetched and verified");

        res.status(200).json({
          success: true,
          verified: true,
          documentId,
          documentMetadata: document.metadata,
          documentSize: document.content.length,
          message: "Prescription document verified and fetched successfully",
        });
      } catch (error) {
        console.error("❌ Error fetching prescription document:", error);
        res.status(500).json({
          error: "Failed to fetch prescription document",
          details: error.message,
          documentId,
        });
      }
    }
  );

  // Download prescription document content
  app.get(
    "/download-prescription/:documentId",
    async (req: Request, res: Response) => {
      const { documentId } = req.params;

      try {
        console.log("🏥 Pharmacist downloading prescription document...");
        console.log("Document ID:", documentId);

        // Get the full document
        const document = await DocumentService.getDocument(documentId);

        if (!document) {
          return res.status(404).json({
            error: "Document not found",
            documentId,
          });
        }

        // Set response headers for file download
        res.set({
          "Content-Type":
            document.metadata.mimeType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${
            document.metadata.fileName || "prescription.pdf"
          }"`,
          "Content-Length": document.content.length,
        });

        console.log("✅ Prescription document download initiated");

        // Send document content
        res.send(document.content);
      } catch (error) {
        console.error("❌ Error downloading prescription document:", error);
        res.status(500).json({
          error: "Failed to download prescription document",
          details: error.message,
          documentId,
        });
      }
    }
  );

  // Verify patient identity (same as doctor)
  app.post("/verify-patient-identity", async (req: Request, res: Response) => {
    const { connectionId } = req.body;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId is required" });
    }

    try {
      console.log("🏥 Pharmacist requesting patient identity verification...");
      console.log("Connection ID:", connectionId);

      // Send a message to the patient
      await agent.sendMessage(
        connectionId,
        "Please prepare to share your identity credentials for verification."
      );

      // Request proof of identity credentials from government
      const governmentCredDefId =
        process.env.ISSUER_CRED_DEF_ID || credentialDefinitionId;

      const requestAttributes = {
        identity_info: {
          names: ["nationalId", "name", "medicalCondition", "bloodType"],
          restriction: governmentCredDefId
            ? [{ cred_def_id: governmentCredDefId }]
            : [],
        },
      };

      const requestPredicates = {
        age_check: {
          name: "age",
          p_type: ">=" as const,
          p_value: 18,
          restriction: governmentCredDefId
            ? [{ cred_def_id: governmentCredDefId }]
            : [],
        },
      };

      const result = await agent.sendProofRequest({
        proofRequestlabel: "patient-identity-verification",
        connectionId,
        version: "1.0",
        attributes: requestAttributes,
        predicates: requestPredicates,
      });

      console.log("✅ Patient identity proof request sent:", result.id);

      res.status(200).json({
        success: true,
        message: "Patient identity verification request sent successfully",
        proofRecordId: result.id,
        threadId: result.threadId,
        state: result.state,
      });
    } catch (error) {
      console.error(
        "❌ Error requesting patient identity verification:",
        error
      );
      res.status(500).json({
        error: "Failed to request patient identity verification",
        details: error.message,
      });
    }
  });

  console.log("Pharmacist-specific routes set up successfully");
};

// Routes specific to issuer (Government)
if (agentType === "--issuer") {
  // Create schema
  app.post("/create-schema", async (req: Request, res: Response) => {
    const { did, name, version, attributes } = req.body;
    const regex = /^\d+\.\d+\.\d+$/;
    if (!Array.isArray(attributes) || attributes.length === 0) {
      return res.status(400).send({
        error: "attributes must be an array with at least one element",
      });
    }
    if (!regex.test(version)) {
      return res
        .status(400)
        .send({ error: "version must be in the format x.x.x" });
    }
    if (!did) {
      return res.status(400).send({ error: "did is required" });
    }
    if (!name) {
      return res.status(400).send({ error: "schema name is required" });
    }

    const schema = {
      issuerId: did,
      name,
      version,
      attrNames: attributes,
    };
    try {
      const result = await agent.createSchema(did, schema);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Get schemas
  app.get("/schemas", async (req: Request, res: Response) => {
    const { schemaId } = req.query;
    try {
      const result = await agent.getSchema(schemaId as string);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Create credential definition
  app.post("/credential-definition", async (req: Request, res: Response) => {
    const { did, schemaId, tag } = req.body;

    if (!did) {
      return res.status(400).send({ error: "did is required" });
    }
    if (!schemaId) {
      return res.status(400).send({ error: "schemaId is required" });
    }

    try {
      const result = await agent.createCredentialDefinition(did, schemaId, tag);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Get credential definitions
  app.get("/credential-definitions", async (req: Request, res: Response) => {
    const { credentialDefinitionId } = req.query;

    try {
      const result = await agent.getCredentialDefinition(
        credentialDefinitionId as string
      );
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Get credential definition
  app.get("/credential-definition", async (req: Request, res: Response) => {
    const { credentialDefinitionId } = req.query;
    try {
      const result = await agent.getCredentialDefinition(
        credentialDefinitionId as string
      );
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}

// Common routes for all agent types
// Request proof of identity
app.post("/send-proof-request", async (req: Request, res: Response) => {
  const { proofRequestlabel, connectionId, version } = req.body;

  let requestAttributes = {};
  let requestPredicates = {};

  if (agentType === "--issuer") {
    requestAttributes = {
      name: {
        names: ["nationalId", "medicalCondition", "bloodType"],
        restriction: [{ cred_def_id: credentialDefinitionId }],
      },
    };
    requestPredicates = {
      name: {
        name: "age",
        p_type: ">=" as const,
        p_value: 18,
        restriction: [{ cred_def_id: credentialDefinitionId }],
      },
    };
  } else if (agentType === "--doctor") {
    // Doctor verifies identity using credentials issued by government only
    const governmentCredDefId =
      process.env.ISSUER_CRED_DEF_ID || credentialDefinitionId;

    requestAttributes = {
      identity_info: {
        names: ["nationalId", "name", "medicalCondition", "bloodType"],
        restriction: governmentCredDefId
          ? [{ cred_def_id: governmentCredDefId }]
          : [],
      },
    };

    requestPredicates = {
      age_check: {
        name: "age",
        p_type: ">=" as const,
        p_value: 18,
        restriction: governmentCredDefId
          ? [{ cred_def_id: governmentCredDefId }]
          : [],
      },
    };
  } else if (agentType === "--pharmacist") {
    // Pharmacist requests medical document information
    const governmentCredDefId = process.env.GOVERNMENT_MEDICAL_CRED_DEF_ID;

    requestAttributes = {
      name: {
        names: [
          "documentId",
          "documentType",
          "documentHash",
          "issuedBy",
          "issuedAt",
        ],
        restriction: governmentCredDefId
          ? [{ cred_def_id: governmentCredDefId }]
          : [],
      },
    };

    console.log(
      `🏥 Pharmacist proof request using credential definition: ${
        governmentCredDefId || "none (unrestricted)"
      }`
    );
  } else {
    // Doctor or other agent
    requestAttributes = {
      name: {
        names: ["nationalId", "name", "age", "medicalCondition", "bloodType"],
        restriction: [],
      },
    };
  }

  if (!proofRequestlabel) {
    return res.status(400).send({ error: "proofRequestlabel is required" });
  }
  if (!connectionId) {
    return res.status(400).send({ error: "connectionId is required" });
  }

  try {
    const result = await agent.sendProofRequest({
      proofRequestlabel,
      connectionId,
      version: version || "1.0",
      attributes: requestAttributes,
      predicates: requestPredicates,
    });
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Get proof records
app.get("/proof-records", async (req: Request, res: Response) => {
  const { proofRecordId } = req.query;

  try {
    const result = await agent.getProofRecords(proofRecordId as string);
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Get wallet DIDs
app.get("/wallet-dids", async (req: Request, res: Response) => {
  const { method } = req.query;

  try {
    const result = await agent.getWalletDids(method as string);
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Create connection invitation
app.post("/create-invitation", async (req: Request, res: Response) => {
  const { label, alias, domain } = req.body;

  // Use the correct agent public endpoint based on agent type
  const agent_domain =
    agentType === "--issuer"
      ? process.env.ISSUER_AGENT_PUBLIC_ENDPOINT
      : agentType === "--doctor"
      ? process.env.DOCTOR_AGENT_PUBLIC_ENDPOINT
      : process.env.PHARMACIST_AGENT_PUBLIC_ENDPOINT;

  console.log(`Creating invitation with agent domain: ${agent_domain}`);

  try {
    const result = await agent.createInvitation({
      label: label || agentLabel,
      alias: alias || `${agentLabel.toLowerCase()}-connection`,
      domain: domain || agent_domain,
    });

    // Return the QR code data along with the invitation URL
    res.status(200).send({
      ...result,
      qrCodeData: result.invitationUrl,
    });
  } catch (error) {
    console.error("Error creating invitation:", error);
    res.status(500).send({ error: error.message });
  }
});

// Get connections
app.get("/connections", async (req: Request, res: Response) => {
  const { connectionId, outOfBandId } = req.query;
  try {
    const result = await agent.getConnections({
      connectionId: connectionId as string,
      outOfBandId: outOfBandId as string,
    });

    // Add more detail for diagnostic purposes
    console.log(`Found ${result.length} connections`);
    if (result.length > 0) {
      result.forEach((conn) => {
        console.log(
          `Connection ${conn.id}: state=${conn.state}, theirLabel=${conn.theirLabel}`
        );
      });
    }

    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Debug endpoint for connection issues
app.get("/debug-agent", async (req: Request, res: Response) => {
  try {
    // Get all connections
    const connections = await agent.getConnections({});

    // Get agent configuration
    const agentInfo = {
      label: agentLabel,
      publicEndpoint: agentPublicEndpoint,
      port: port,
      agentPort: port + 1,
      agentType: agentType,
    };

    res.status(200).send({
      agent: agentInfo,
      connections: connections.map((c) => ({
        id: c.id,
        state: c.state,
        theirLabel: c.theirLabel,
        createdAt: c.createdAt,
        outOfBandId: c.outOfBandId,
      })),
      networkConfig: {
        ipAddress: process.env.ISSUER_AGENT_PUBLIC_ENDPOINT,
      },
      environmentInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        currentTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error in debug endpoint:", error);
    res.status(500).send({ error: error.message });
  }
});

// Routes specific to verifiers (doctor, pharmacist)
if (agentType === "--doctor" || agentType === "--pharmacist") {
  // Get proof data
  app.get("/proof-data/:proofRecordId", async (req: Request, res: Response) => {
    const { proofRecordId } = req.params;
    if (!proofRecordId) {
      return res.status(400).send({ error: "proofRecordId is required" });
    }

    try {
      // First check the cache for quick response
      if (
        proofStatusCache[proofRecordId] &&
        proofStatusCache[proofRecordId].isVerified
      ) {
        // If we have a verified status in cache, get the actual proof data
        const result = await agent.getProofData(proofRecordId);

        // Add verification status from cache
        const responseData = {
          ...result,
          isVerified: true,
          state: proofStatusCache[proofRecordId].state,
        };

        res.status(200).send(responseData);
      } else {
        // If not in cache or not verified, try to get from agent
        const result = await agent.getProofData(proofRecordId);

        // If we got data, it's verified
        if (result) {
          // Update cache
          updateProofStatus(proofRecordId, "done", true);

          const responseData = {
            ...result,
            isVerified: true,
            state: "done",
          };

          res.status(200).send(responseData);
        } else {
          // No data means not verified yet
          res.status(200).send({ isVerified: false });
        }
      }
    } catch (error) {
      console.error("Error getting proof data:", error);
      // Even if there's an error, check if we have cached status
      if (proofStatusCache[proofRecordId]) {
        res.status(200).send({
          isVerified: proofStatusCache[proofRecordId].isVerified,
          state: proofStatusCache[proofRecordId].state,
          fromCache: true,
        });
      } else {
        res.status(500).send({ error: error.message });
      }
    }
  });

  // Get proof verification status (new endpoint)
  app.get(
    "/proof-status/:proofRecordId",
    async (req: Request, res: Response) => {
      const { proofRecordId } = req.params;
      if (!proofRecordId) {
        return res.status(400).send({ error: "proofRecordId is required" });
      }

      try {
        // First check the cache
        if (proofStatusCache[proofRecordId]) {
          return res.status(200).send(proofStatusCache[proofRecordId]);
        }

        // If not in cache, get from agent
        const proofRecords = await agent.getProofRecords(proofRecordId);

        if (proofRecords && proofRecords.length > 0) {
          const proofRecord = proofRecords[0];

          // Consider these states as verified (same logic as in the listener)
          const verifiedStates = [
            "done",
            "presentation-received",
            "request-received",
            "presentation-sent",
          ];
          const isVerified = verifiedStates.includes(proofRecord.state);

          console.log(
            `Proof status check: ${proofRecord.state} (verified: ${isVerified})`
          );

          // Update cache
          updateProofStatus(
            proofRecordId,
            proofRecord.state,
            isVerified,
            proofRecord.connectionId
          );

          return res.status(200).send({
            state: proofRecord.state,
            isVerified,
            timestamp: Date.now(),
          });
        }

        res.status(404).send({ error: "Proof record not found" });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    }
  );

  // Clear proof status cache
  app.post("/clear-proof-cache", async (req: Request, res: Response) => {
    try {
      const count = clearProofStatusCache();
      res.status(200).send({
        message: `Proof status cache cleared successfully. ${count} entries removed.`,
      });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}

// Send message route (common for all agents)
app.post("/send-message", async (req: Request, res: Response) => {
  const { connectionId, message } = req.body;
  if (!connectionId) {
    return res.status(400).send({ error: "connectionId is required" });
  }
  if (!message) {
    return res.status(400).send({ error: "message is required" });
  }
  try {
    const result = await agent.sendMessage(connectionId, message);
    res.status(200).send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Agent status endpoint for debugging
app.get("/agent-status", async (req: Request, res: Response) => {
  try {
    const status: any = {
      agentType,
      agentLabel,
      agentDid,
      credentialDefinitionId,
      isInitialized:
        !!credentialDefinitionId &&
        !credentialDefinitionId.startsWith("dummy-"),
      timestamp: new Date().toISOString(),
      environment: {
        ISSUER_DID: process.env.ISSUER_DID,
        DOCTOR_DID: process.env.DOCTOR_DID,
        PHARMACIST_DID: process.env.PHARMACIST_DID,
        DOCTOR_MEDICAL_CRED_DEF_ID: process.env.DOCTOR_MEDICAL_CRED_DEF_ID,
      },
    };

    // Get connections count
    try {
      const connections = await agent.getConnections({});
      status.connectionsCount = connections.length;
      status.activeConnections = connections.filter(
        (c) => c.state === "completed"
      ).length;
    } catch (error) {
      status.connectionsError = error.message;
    }

    res.status(200).send(status);
  } catch (error) {
    res.status(500).send({
      error: error.message,
      agentType,
      timestamp: new Date().toISOString(),
    });
  }
});

// Start the server and initialize agent
const startServer = async () => {
  console.log(`Starting server on http://localhost:${port}`);

  app.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log("Initializing agent...");
    await initializeAgent();
    console.log("Server and agent initialization complete!");
  });
};

// Start the application
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
