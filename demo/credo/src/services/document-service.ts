import {
  getDocument,
  getDocumentMetadata,
  storeDocument,
  verifyDocument,
} from "../lib/document-storage";

// Document types supported by the system
export enum DocumentType {
  PRESCRIPTION = "prescription",
  LAB_REPORT = "lab_report",
  MEDICAL_RECORD = "medical_record",
}

// Document metadata interface
export interface DocumentMetadata {
  id: string;
  patientDid: string;
  cid: string;
  sha256: string;
  docType: string;
  issuedBy: string;
  issuedAt: string;
  fileName: string;
  mimeType: string;
}

// Document service class to handle document operations
export class DocumentService {
  /**
   * Store a document in MongoDB with digital signature
   */
  public static async storeDocument(
    file: Express.Multer.File,
    patientDid: string,
    issuerDid: string,
    docType: DocumentType = DocumentType.PRESCRIPTION
  ): Promise<DocumentMetadata> {
    try {
      // Store the document in MongoDB with digital signature
      const metadata = await storeDocument(
        file.buffer,
        file.originalname,
        file.mimetype,
        patientDid,
        issuerDid,
        docType
      );

      // Convert to our service's DocumentMetadata format
      return {
        id: metadata.documentId,
        patientDid: metadata.patientDid,
        cid: "", // No longer using CID since we're not using IPFS
        sha256: metadata.sha256,
        docType: metadata.docType,
        issuedBy: metadata.issuedBy,
        issuedAt: metadata.issuedAt,
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
      };
    } catch (error) {
      console.error("Error storing document:", error);
      throw error;
    }
  }

  /**
   * Retrieve document metadata by its ID
   */
  public static async getDocumentMetadata(
    id: string
  ): Promise<DocumentMetadata | null> {
    try {
      // Get document metadata from MongoDB storage
      const metadata = await getDocumentMetadata(id);

      if (!metadata) {
        return null;
      }

      // Convert to our service's DocumentMetadata format
      return {
        id: metadata.documentId,
        patientDid: metadata.patientDid,
        cid: "", // No longer using CID
        sha256: metadata.sha256,
        docType: metadata.docType,
        issuedBy: metadata.issuedBy,
        issuedAt: metadata.issuedAt,
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
      };
    } catch (error) {
      console.error("Error retrieving document metadata:", error);
      throw error;
    }
  }

  /**
   * Retrieve a document by its ID
   */
  public static async getDocument(
    id: string
  ): Promise<{ metadata: DocumentMetadata; content: Buffer } | null> {
    try {
      // Get document with content from MongoDB storage
      const document = await getDocument(id);

      if (!document) {
        return null;
      }

      // Convert to our service's DocumentMetadata format
      const metadata: DocumentMetadata = {
        id: document.metadata.documentId,
        patientDid: document.metadata.patientDid,
        cid: "", // No longer using CID
        sha256: document.metadata.sha256,
        docType: document.metadata.docType,
        issuedBy: document.metadata.issuedBy,
        issuedAt: document.metadata.issuedAt,
        fileName: document.metadata.fileName,
        mimeType: document.metadata.mimeType,
      };

      return { metadata, content: document.content };
    } catch (error) {
      console.error("Error retrieving document:", error);
      throw error;
    }
  }

  /**
   * Verify a document's integrity using its ID and hash
   */
  public static async verifyDocument(
    id: string,
    sha256: string
  ): Promise<{ verified: boolean; document?: any; reason?: string }> {
    try {
      // Verify document using MongoDB storage with digital signature verification
      const verification = await verifyDocument(id, sha256);

      if (!verification.verified) {
        return verification;
      }

      // If document is verified, convert to our service's format
      if (verification.document) {
        const metadata: DocumentMetadata = {
          id: verification.document.metadata.documentId,
          patientDid: verification.document.metadata.patientDid,
          cid: "", // No longer using CID
          sha256: verification.document.metadata.sha256,
          docType: verification.document.metadata.docType,
          issuedBy: verification.document.metadata.issuedBy,
          issuedAt: verification.document.metadata.issuedAt,
          fileName: verification.document.metadata.fileName,
          mimeType: verification.document.metadata.mimeType,
        };

        return {
          verified: true,
          document: {
            metadata,
            content: verification.document.content,
          },
        };
      }

      return { verified: true };
    } catch (error) {
      console.error("Error verifying document:", error);
      throw error;
    }
  }

  /**
   * Create credential attributes for a document
   * Compatible with medical document credential schema
   */
  public static createDocumentCredentialAttributes(metadata: DocumentMetadata) {
    return [
      {
        name: "documentId",
        value: metadata.id,
      },
      {
        name: "documentType",
        value: metadata.docType,
      },
      {
        name: "documentHash",
        value: metadata.sha256,
      },
      {
        name: "documentCid",
        value: metadata.cid || "", // Empty string if no CID
      },
      {
        name: "issuedBy",
        value: metadata.issuedBy,
      },
      {
        name: "issuedAt",
        value: metadata.issuedAt,
      },
    ];
  }
}
