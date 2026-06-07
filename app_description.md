# Blockchain-based Self-Sovereign Identity (SSI) System

## Overview

The application is a Blockchain-based Self-Sovereign Identity (SSI) system designed to facilitate secure and decentralized identity management and document verification among patients, government entities, hospitals, and pharmacies. The system leverages the Credo framework (formerly Aries Framework JavaScript) to implement a patient-centric SSI solution.

## System Architecture

The application is divided into two main parts: the backend (`credo`) and the frontend (`interface`).

### Backend (`credo`)

- **Agent Types**: The backend supports three main agent types:

  1. **Issuer (Government)**: Issues identity credentials to patients.
  2. **Doctor**: Verifies patient identity and issues medical document credentials.
  3. **Pharmacist**: Verifies medical documents before dispensing medication.

- **Data Storage**: Medical documents are stored in MongoDB with digital signatures for verification. Document metadata is shared as verifiable credentials to patients, ensuring data integrity and security.

- **Key Components**:
  - **Routes**: Handles API endpoints for document management and credential issuance.
  - **Services**: Implements business logic for document handling and verification.
  - **Lib**: Contains utility functions for document storage and database interactions.

### Frontend (`interface`)

- **User Interfaces**: The frontend provides interfaces for different user roles, including patients, doctors, pharmacists, and government officials.
- **Components**: Reusable components for QR code display, connection establishment, credential acceptance, and more.
- **Services**: API service for interacting with the backend.

## Detailed Workflow

1. **Patient Onboarding**:

   - The patient creates a wallet using the Aries Bifold wallet app.
   - The government issues a QR code for connection, which the patient scans to establish a connection.
   - The government issues an identity credential, which the patient accepts and stores in their wallet.

2. **Medical Document Issuance**:

   - The hospital, acting as a verifier, connects with the patient via a QR code.
   - The patient shares their credential with the hospital for identity verification.
   - Upon verification, the doctor issues medical documents (e.g., prescriptions) to the patient.
   - Documents are stored in MongoDB as signed documents, and metadata is sent to the patient as a credential.

3. **Pharmacy Interaction**:
   - The pharmacy creates a QR code for connection with the patient.
   - The patient shares their credential with the pharmacy.
   - The pharmacy retrieves the document metadata from MongoDB and dispenses medication to the patient.

## API Endpoints

- **Common Endpoints**:

  - `POST /create-invitation`: Create a connection invitation.
  - `GET /connections`: Retrieve all connections.
  - `POST /send-message`: Send a message to a connection.

- **Government (Issuer) Endpoints**:

  - `POST /issue-credential`: Issue identity credentials to a patient.

- **Doctor Endpoints**:

  - `POST /send-proof-request`: Request identity proof from a patient.
  - `POST /medical-document/upload`: Upload and issue a medical document credential.

- **Pharmacist Endpoints**:
  - `POST /send-proof-request`: Request document proof from a patient.
  - `POST /medical-document/verify`: Verify a medical document.
  - `GET /medical-document/:id`: Retrieve a medical document by ID.

## Conclusion

This application provides a robust framework for managing and verifying identities and medical documents in a decentralized manner, enhancing privacy and security for all parties involved. The use of blockchain and SSI principles ensures that patients have full control over their data, while also streamlining interactions with government entities, healthcare providers, and pharmacies.
