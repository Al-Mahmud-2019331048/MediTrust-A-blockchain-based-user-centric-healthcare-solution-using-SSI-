import crypto from 'crypto';
import { getPrismaClient } from './database';
import * as jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Secret key for signing documents - in production, this should be stored securely
const SIGNING_SECRET = process.env.DOCUMENT_SIGNING_SECRET || 'default-secret-key-change-in-production';

// Interface for document metadata
export interface DocumentMetadata {
  documentId: string;
  patientDid: string;
  sha256: string;
  docType: string;
  issuedBy: string;
  issuedAt: string;
  fileName: string;
  mimeType: string; // Added for content type information
}

/**
 * Store a document in MongoDB with digital signature
 * @param fileBuffer The document content as a buffer
 * @param fileName Original filename
 * @param mimeType MIME type of the file
 * @param patientDid Patient's DID
 * @param issuedBy Issuer's DID
 * @param docType Document type (e.g., prescription, lab_report)
 * @returns Document metadata
 */
export async function storeDocument(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  patientDid: string,
  issuedBy: string,
  docType: string = 'prescription'
): Promise<DocumentMetadata> {
  const prisma = getPrismaClient();
  
  try {
    // Generate a unique ID for the document
    const documentId = crypto.randomUUID();
    
    // Calculate SHA-256 hash of the file
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Create a signature for the document (includes hash and metadata)
    const signaturePayload = {
      documentId,
      patientDid,
      sha256,
      docType,
      issuedBy,
      issuedAt: new Date().toISOString()
    };
    
    // Sign the document metadata
    const signature = jwt.sign(signaturePayload, SIGNING_SECRET, { expiresIn: '10y' });
    
    // Store the document in MongoDB
    const document = await prisma.document.create({
      data: {
        documentId,
        patientDid,
        content: fileBuffer,
        fileName,
        mimeType,
        sha256,
        docType,
        issuedBy,
        signature
      }
    });
    
    // Return metadata (without the actual content)
    return {
      documentId: document.documentId,
      patientDid: document.patientDid,
      sha256: document.sha256,
      docType: document.docType,
      issuedBy: document.issuedBy,
      issuedAt: document.issuedAt.toISOString(),
      fileName: document.fileName,
      mimeType: document.mimeType
    };
  } catch (error) {
    console.error('Error storing document:', error);
    throw error;
  }
}

/**
 * Retrieve document metadata by its ID
 * @param documentId Document ID
 * @returns Document metadata or null if not found
 */
export async function getDocumentMetadata(documentId: string): Promise<DocumentMetadata | null> {
  const prisma = getPrismaClient();
  
  try {
    const document = await prisma.document.findUnique({
      where: { documentId }
    });
    
    if (!document) {
      return null;
    }
    
    return {
      documentId: document.documentId,
      patientDid: document.patientDid,
      sha256: document.sha256,
      docType: document.docType,
      issuedBy: document.issuedBy,
      issuedAt: document.issuedAt.toISOString(),
      fileName: document.fileName,
      mimeType: document.mimeType
    };
  } catch (error) {
    console.error('Error retrieving document metadata:', error);
    throw error;
  }
}

/**
 * Retrieve a document by its ID
 * @param documentId Document ID
 * @returns Document content and metadata or null if not found
 */
export async function getDocument(documentId: string): Promise<{ metadata: DocumentMetadata, content: Buffer } | null> {
  const prisma = getPrismaClient();
  
  try {
    const document = await prisma.document.findUnique({
      where: { documentId }
    });
    
    if (!document) {
      return null;
    }
    
    const metadata: DocumentMetadata = {
      documentId: document.documentId,
      patientDid: document.patientDid,
      sha256: document.sha256,
      docType: document.docType,
      issuedBy: document.issuedBy,
      issuedAt: document.issuedAt.toISOString(),
      fileName: document.fileName,
      mimeType: document.mimeType
    };
    
    return {
      metadata,
      content: document.content
    };
  } catch (error) {
    console.error('Error retrieving document:', error);
    throw error;
  }
}

/**
 * Verify a document's integrity and authenticity
 * @param documentId Document ID
 * @param sha256 Expected SHA-256 hash
 * @returns Verification result
 */
export async function verifyDocument(
  documentId: string,
  sha256: string
): Promise<{ verified: boolean, document?: any, reason?: string }> {
  const prisma = getPrismaClient();
  
  try {
    const document = await prisma.document.findUnique({
      where: { documentId }
    });
    
    if (!document) {
      return { verified: false, reason: 'Document not found' };
    }
    
    // Verify the hash
    if (document.sha256 !== sha256) {
      return { verified: false, reason: 'Document hash mismatch' };
    }
    
    // Verify the signature
    try {
      // Define an interface for the JWT payload
      interface DocumentJwtPayload {
        documentId: string;
        patientDid: string;
        sha256: string;
        docType: string;
        issuedBy: string;
        issuedAt: string;
        iat?: number;
        exp?: number;
      }
      
      // Verify and cast the decoded signature to our payload type
      const decodedSignature = jwt.verify(document.signature, SIGNING_SECRET) as DocumentJwtPayload;
      
      // Check if the signature payload matches the document metadata
      if (
        decodedSignature.documentId !== document.documentId ||
        decodedSignature.patientDid !== document.patientDid ||
        decodedSignature.sha256 !== document.sha256
      ) {
        return { verified: false, reason: 'Signature validation failed - metadata mismatch' };
      }
      
      // Calculate hash of the stored content to verify it hasn't been tampered with
      const calculatedHash = crypto.createHash('sha256').update(document.content).digest('hex');
      
      if (calculatedHash !== sha256) {
        return { verified: false, reason: 'Content hash mismatch - document may have been tampered with' };
      }
      
      // Document is verified
      const metadata: DocumentMetadata = {
        documentId: document.documentId,
        patientDid: document.patientDid,
        sha256: document.sha256,
        docType: document.docType,
        issuedBy: document.issuedBy,
        issuedAt: document.issuedAt.toISOString(),
        fileName: document.fileName,
        mimeType: document.mimeType
      };
      
      return { 
        verified: true, 
        document: {
          metadata,
          content: document.content
        }
      };
    } catch (error) {
      return { verified: false, reason: `Signature validation failed: ${error.message}` };
    }
  } catch (error) {
    console.error('Error verifying document:', error);
    throw error;
  }
}

/**
 * List documents for a patient
 * @param patientDid Patient's DID
 * @returns Array of document metadata
 */
export async function listPatientDocuments(patientDid: string): Promise<DocumentMetadata[]> {
  const prisma = getPrismaClient();
  
  try {
    const documents = await prisma.document.findMany({
      where: { patientDid },
      orderBy: { issuedAt: 'desc' }
    });
    
    return documents.map(doc => ({
      documentId: doc.documentId,
      patientDid: doc.patientDid,
      sha256: doc.sha256,
      docType: doc.docType,
      issuedBy: doc.issuedBy,
      issuedAt: doc.issuedAt.toISOString(),
      fileName: doc.fileName,
      mimeType: doc.mimeType
    }));
  } catch (error) {
    console.error('Error listing patient documents:', error);
    throw error;
  }
}
