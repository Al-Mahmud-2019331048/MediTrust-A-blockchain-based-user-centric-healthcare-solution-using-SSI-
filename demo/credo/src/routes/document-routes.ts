import { Request, Response } from "express";
import http from "http";
import https from "https";
import { URL } from "url";
import { BaseAgent } from "../../agent";
import { initDatabase } from "../lib/database";
import { DocumentService, DocumentType } from "../services/document-service";

/**
 * Helper function to make HTTP POST requests
 */
function makeHttpRequest(url: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const client = isHttps ? https : http;

    const postData = JSON.stringify(data);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = client.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const jsonData = JSON.parse(responseData);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(jsonData);
          } else {
            reject(
              new Error(
                `HTTP ${res.statusCode}: ${jsonData.error || res.statusMessage}`
              )
            );
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Routes for document handling in the SSI system
 */
export function setupDocumentRoutes(
  app: any,
  agent: BaseAgent,
  agentDid: string,
  credentialDefinitionId: string,
  upload: any
) {
  // Doctor route: Issue medical document credential without file upload (metadata only)
  app.post(
    "/medical-document/issue-credential",
    async (req: Request, res: Response) => {
      try {
        const {
          patientDid,
          documentType = "prescription",
          documentId,
          fileName = "medical-document.pdf",
          mimeType = "application/pdf",
        } = req.body;

        if (!patientDid) {
          return res.status(400).json({ error: "Patient DID is required" });
        }

        // Generate document metadata without actual file
        const documentMetadata = {
          id:
            documentId ||
            `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          patientDid,
          cid: "", // No CID since no file upload
          sha256: `mock-hash-${Date.now()}`, // Mock hash for testing
          docType: documentType,
          issuedBy: agentDid,
          issuedAt: new Date().toISOString(),
          fileName,
          mimeType,
        };

        console.log(
          "📋 Generated document metadata (no file upload):",
          documentMetadata
        );

        // Find connection with the patient
        const connections = await agent.getConnections({});
        const connection = connections.find(
          (conn) => conn.theirDid === patientDid
        );

        if (!connection) {
          return res.status(400).json({
            error: "No connection found with the patient",
            documentId: documentMetadata.id,
            documentMetadata,
          });
        }

        console.log("🔗 Found connection with patient:", {
          id: connection.id,
          theirDid: connection.theirDid,
          state: connection.state,
        });

        // Issue credential to patient via doctor's own credential definition
        try {
          // Check if doctor has its own medical credential definition
          const doctorCredDefId =
            process.env.DOCTOR_MEDICAL_CRED_DEF_ID || credentialDefinitionId;

          if (doctorCredDefId && !doctorCredDefId.startsWith("dummy-")) {
            console.log(
              "🏥 Using doctor's own credential definition to issue medical document credential..."
            );
            console.log("Doctor Credential Definition ID:", doctorCredDefId);

            // Prepare attributes for medical document credential (matching doctor's schema)
            const attributes = [
              { name: "documentId", value: documentMetadata.id },
              { name: "documentType", value: documentMetadata.docType },
              { name: "documentHash", value: documentMetadata.sha256 },
              { name: "patientName", value: "Patient Name" }, // You can get this from connection or request
              {
                name: "patientId",
                value: connection.theirDid || connection.id,
              },
              { name: "diagnosis", value: "Medical diagnosis" }, // You can add this to the request
              { name: "prescription", value: "Prescribed treatment" }, // You can add this to the request
              { name: "issuedBy", value: documentMetadata.issuedBy },
              { name: "issuedAt", value: documentMetadata.issuedAt },
            ];

            console.log("📋 Credential attributes:", attributes);

            // Issue credential directly from doctor agent
            const result = await agent.issueAnonCredsCredential(
              connection.id,
              doctorCredDefId,
              attributes
            );

            console.log(
              "✅ Medical document credential issued by doctor agent:",
              result
            );

            return res.status(200).json({
              success: true,
              documentId: documentMetadata.id,
              credentialId: result.id,
              threadId: result.threadId,
              documentMetadata,
              message:
                "Medical document credential issued successfully by doctor agent (no file upload)",
              credentialType: "AnonCreds",
              issuedBy: "doctor",
              state: result.state,
            });
          } else {
            console.log(
              "⚠️ No doctor medical credential definition found, using fallback message"
            );

            // Fallback to structured message
            const credentialMessage = {
              "@type": "https://didcomm.org/issue-credential/2.0/credential",
              "@id": `credential-${documentMetadata.id}-${Date.now()}`,
              credential: {
                type: ["VerifiableCredential", "MedicalDocumentCredential"],
                issuer: agentDid,
                issuanceDate: new Date().toISOString(),
                credentialSubject: {
                  id: connection.theirDid || connection.id,
                  documentId: documentMetadata.id,
                  documentType: documentMetadata.docType,
                  documentHash: documentMetadata.sha256,
                  documentCid: "",
                  issuedBy: documentMetadata.issuedBy,
                  issuedAt: documentMetadata.issuedAt,
                  fileName: documentMetadata.fileName,
                  mimeType: documentMetadata.mimeType,
                },
              },
              "~please_ack": {},
            };

            const messageResult = await agent.sendMessage(
              connection.id,
              JSON.stringify(credentialMessage, null, 2)
            );

            console.log(
              "✅ Medical document sent as structured message:",
              messageResult.id
            );

            return res.status(200).json({
              success: true,
              documentId: documentMetadata.id,
              credentialId: messageResult.id,
              documentMetadata,
              message:
                "Medical document sent as structured message (no file upload, doctor credential definition not available)",
              credentialType: "StructuredMessage",
            });
          }
        } catch (credentialError) {
          console.error(
            "❌ Error with medical document credential:",
            credentialError
          );

          return res.status(500).json({
            error: "Failed to issue medical document credential",
            details: credentialError.message,
            documentId: documentMetadata.id,
            documentMetadata,
            suggestion:
              "Check if doctor agent is running and DOCTOR_MEDICAL_CRED_DEF_ID is set",
          });
        }
      } catch (error) {
        console.error("Error issuing medical document credential:", error);
        return res.status(500).json({ error: error.message });
      }
    }
  );

  // Doctor route: Upload medical document and issue credential to patient
  app.post(
    "/medical-document/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { patientDid, documentType } = req.body;
        const file = req.file;

        if (!patientDid || !file) {
          return res
            .status(400)
            .json({ error: "Patient DID and file are required" });
        }

        // Determine document type
        const docType = documentType || DocumentType.PRESCRIPTION;

        // Store document and get metadata
        const documentMetadata = await DocumentService.storeDocument(
          file,
          patientDid,
          agentDid,
          docType as DocumentType
        );

        // Find connection with the patient
        const connections = await agent.getConnections({});
        const connection = connections.find(
          (conn) => conn.theirDid === patientDid
        );

        if (!connection) {
          return res.status(400).json({
            error: "No connection found with the patient",
            documentId: documentMetadata.id,
            documentMetadata,
          });
        }

        // Create credential attributes for the document
        const attributes =
          DocumentService.createDocumentCredentialAttributes(documentMetadata);

        // Issue credential to patient via doctor's own credential definition
        try {
          // Check if doctor has its own medical credential definition
          const doctorCredDefId =
            process.env.DOCTOR_MEDICAL_CRED_DEF_ID || credentialDefinitionId;

          if (doctorCredDefId && !doctorCredDefId.startsWith("dummy-")) {
            console.log(
              "🏥 Using doctor's own credential definition to issue medical document credential..."
            );
            console.log("Doctor Credential Definition ID:", doctorCredDefId);

            // Prepare attributes for medical document credential (matching doctor's schema)
            const attributes = [
              { name: "documentId", value: documentMetadata.id },
              { name: "documentType", value: documentMetadata.docType },
              { name: "documentHash", value: documentMetadata.sha256 },
              { name: "patientName", value: "Patient Name" }, // You can get this from connection or request
              {
                name: "patientId",
                value: connection.theirDid || connection.id,
              },
              { name: "diagnosis", value: "Medical diagnosis" }, // You can add this to the request
              { name: "prescription", value: "Prescribed treatment" }, // You can add this to the request
              { name: "issuedBy", value: documentMetadata.issuedBy },
              { name: "issuedAt", value: documentMetadata.issuedAt },
            ];

            console.log("📋 Credential attributes:", attributes);

            // Issue credential directly from doctor agent
            const result = await agent.issueAnonCredsCredential(
              connection.id,
              doctorCredDefId,
              attributes
            );

            console.log(
              "✅ Medical document credential issued by doctor agent:",
              result
            );

            return res.status(200).json({
              success: true,
              documentId: documentMetadata.id,
              credentialId: result.id,
              threadId: result.threadId,
              documentMetadata,
              message:
                "Medical document credential issued successfully by doctor agent (no file upload)",
              credentialType: "AnonCreds",
              issuedBy: "doctor",
              state: result.state,
            });
          } else {
            console.log(
              "⚠️ No doctor medical credential definition found, using fallback message"
            );

            // Fallback to structured message
            const credentialMessage = {
              "@type": "https://didcomm.org/issue-credential/2.0/credential",
              "@id": `credential-${documentMetadata.id}-${Date.now()}`,
              credential: {
                type: ["VerifiableCredential", "MedicalDocumentCredential"],
                issuer: agentDid,
                issuanceDate: new Date().toISOString(),
                credentialSubject: {
                  id: connection.theirDid || connection.id,
                  documentId: documentMetadata.id,
                  documentType: documentMetadata.docType,
                  documentHash: documentMetadata.sha256,
                  documentCid: "",
                  issuedBy: documentMetadata.issuedBy,
                  issuedAt: documentMetadata.issuedAt,
                  fileName: documentMetadata.fileName,
                  mimeType: documentMetadata.mimeType,
                },
              },
              "~please_ack": {},
            };

            const messageResult = await agent.sendMessage(
              connection.id,
              JSON.stringify(credentialMessage, null, 2)
            );

            console.log(
              "✅ Medical document sent as structured message:",
              messageResult.id
            );

            return res.status(200).json({
              success: true,
              documentId: documentMetadata.id,
              credentialId: messageResult.id,
              documentMetadata,
              message:
                "Medical document sent as structured message (no file upload, doctor credential definition not available)",
              credentialType: "StructuredMessage",
            });
          }
        } catch (credentialError) {
          console.error(
            "❌ Error with medical document credential:",
            credentialError
          );

          return res.status(500).json({
            error: "Failed to issue medical document credential",
            details: credentialError.message,
            documentId: documentMetadata.id,
            documentMetadata,
            suggestion:
              "Check if doctor agent is running and DOCTOR_MEDICAL_CRED_DEF_ID is set",
          });
        }
      } catch (error) {
        console.error("Error uploading medical document:", error);
        return res.status(500).json({ error: error.message });
      }
    }
  );

  // Pharmacist route: Verify prescription document
  app.post("/medical-document/verify", async (req: Request, res: Response) => {
    try {
      const { documentId, documentHash } = req.body;

      if (!documentId || !documentHash) {
        return res
          .status(400)
          .json({ error: "Document ID and hash are required" });
      }

      // Verify document integrity
      const verification = await DocumentService.verifyDocument(
        documentId,
        documentHash
      );

      if (!verification.verified) {
        return res.status(400).json({
          verified: false,
          reason: verification.reason,
        });
      }

      res.status(200).json({
        verified: true,
        documentId,
        documentMetadata: verification.document?.metadata,
      });
    } catch (error) {
      console.error("Error verifying medical document:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Pharmacist route: Verify medical document
  app.get(
    "/medical-document/verify/:documentId",
    async (req: Request, res: Response) => {
      try {
        const { documentId } = req.params;

        if (!documentId) {
          return res.status(400).json({ error: "Document ID is required" });
        }

        // Retrieve document metadata
        const documentMetadata = await DocumentService.getDocumentMetadata(
          documentId
        );

        if (!documentMetadata) {
          return res.status(404).json({ error: "Document not found" });
        }

        res.status(200).json({
          success: true,
          documentMetadata,
        });
      } catch (error) {
        console.error("Error verifying medical document:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Get document information for sharing
  app.get(
    "/medical-document/share/:documentId",
    async (req: Request, res: Response) => {
      try {
        const { documentId } = req.params;

        if (!documentId) {
          return res.status(400).json({ error: "Document ID is required" });
        }

        // Retrieve document metadata
        const documentMetadata = await DocumentService.getDocumentMetadata(
          documentId
        );

        if (!documentMetadata) {
          return res.status(404).json({ error: "Document not found" });
        }

        // With MongoDB, we don't have a shareable URL like with IPFS
        // Instead, we provide a token that can be used to access the document
        // through our API
        const shareToken = Buffer.from(
          `${documentId}:${documentMetadata.sha256}`
        ).toString("base64");

        res.status(200).json({
          success: true,
          documentId,
          shareToken,
          documentMetadata,
        });
      } catch (error) {
        console.error("Error generating share information:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Access a document using a share token
  app.get(
    "/medical-document/access/:shareToken",
    async (req: Request, res: Response) => {
      try {
        const { shareToken } = req.params;

        if (!shareToken) {
          return res.status(400).json({ error: "Share token is required" });
        }

        // Decode the share token to get the document ID and hash
        const decoded = Buffer.from(shareToken, "base64").toString("utf-8");
        const [documentId, sha256] = decoded.split(":");

        if (!documentId || !sha256) {
          return res.status(400).json({ error: "Invalid share token" });
        }

        // Verify the document using the ID and hash
        const verification = await DocumentService.verifyDocument(
          documentId,
          sha256
        );

        if (!verification.verified) {
          return res.status(400).json({
            verified: false,
            reason: verification.reason,
          });
        }

        res.status(200).json({
          verified: true,
          documentId,
          documentMetadata: verification.document?.metadata,
        });
      } catch (error) {
        console.error("Error accessing shared document:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Get storage information
  app.get("/storage-info", async (req: Request, res: Response) => {
    try {
      const prisma = await initDatabase();

      // Get document count from MongoDB
      const documentCount = await prisma.document.count();

      res.status(200).json({
        success: true,
        storageInfo: {
          type: "MongoDB",
          documentCount,
          status: "connected",
        },
      });
    } catch (error) {
      console.error("Error getting storage info:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get document content
  app.get("/medical-document/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Retrieve document
      const document = await DocumentService.getDocument(id);

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Set response headers
      res.set({
        "Content-Type":
          document.metadata.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${
          document.metadata.fileName || "document"
        }"`,
        "Content-Length": document.content.length,
      });

      // Send document content
      res.send(document.content);
    } catch (error) {
      console.error("Error retrieving medical document:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return app;
}
