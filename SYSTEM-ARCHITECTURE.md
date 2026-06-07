# System Architecture: Patient-Centric SSI

**Date:** 2026-05-23
**Project:** SSI Healthcare Credential System
**Stack:** Next.js 15 (frontend) + Credo TS 0.5.13 / Express (backend)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagrams](#2-architecture-diagrams)
3. [Directory Structure Reference](#3-directory-structure-reference)
4. [Technology Stack Summary](#4-technology-stack-summary)
5. [Backend API Endpoints](#5-backend-api-endpoints)
6. [Data Flow](#6-data-flow)
7. [Frontend-Backend Integration](#7-frontend-backend-integration)
8. [External Integrations](#8-external-integrations)
9. [Setup Instructions](#9-setup-instructions)
10. [Design Rationale](#10-design-rationale)
11. [Module Dependencies](#11-module-dependencies)
12. [Development Guide](#12-development-guide)

---

## 1. System Overview

This is a **Self-Sovereign Identity (SSI) demonstration** implementing the trust triangle (Issuer → Holder → Verifier) in a healthcare context. The system enables:

- **Government (Issuer):** Issues identity credentials to patients
- **Doctor (Issuer + Verifier):** Verifies patient identity, issues medical documents
- **Pharmacist (Verifier):** Verifies patient identity and prescription credentials
- **Patient (Holder):** Holds credentials in a mobile wallet (Bifold)

The system comprises **two independent codebases**:

| Codebase | Directory | Stack | Purpose |
|----------|-----------|-------|---------|
| **Frontend** | `interface/` | Next.js 15 + React 18 + Tailwind | Role-based web portals |
| **Backend** | `demo/credo/` | Credo TS 0.5.13 + Express + Prisma/MongoDB | SSI agent operations |

They communicate over HTTP REST (no GraphQL, no WebSockets). The backend runs as **3 separate Node.js processes** (issuer, doctor, pharmacist), each exposing a REST API consumed by the frontend.

---

## 2. Architecture Diagrams

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (Frontend)                                  │
│                                                                              │
│   Next.js 15 App Router — http://localhost:3000                              │
│                                                                              │
│   ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│   │ /patient │  │ /doctor  │  │ /pharmacist│  │/government │  │/verifier │  │
│   │ (mock)   │  │ 5-step   │  │ 4-step     │  │ 4-step     │  │ stepper  │  │
│   └──────────┘  │ flow     │  │ flow       │  │ flow       │  │          │  │
│                  └──────────┘  └────────────┘  └────────────┘  └──────────┘  │
│                          │              │             │                      │
│                          ▼              ▼             ▼                      │
│                   ┌─────────────────────────────────────────┐               │
│                   │         apiService.js                   │               │
│                   │  Centralized HTTP client (fetch/axios)  │               │
│                   └──────┬──────────────┬─────────────────┬─┘               │
│                          │              │                 │                 │
└──────────────────────────┼──────────────┼─────────────────┼─────────────────┘
                           │              │                 │
                     ┌─────┴────┐   ┌─────┴────┐   ┌───────┴──────┐
                     │ :4000    │   │ :4002    │   │ :4004        │
                     │ Issuer   │   │ Doctor   │   │ Pharmacist   │
                     │ Express  │   │ Express  │   │ Express      │
                     │ + Credo  │   │ + Credo  │   │ + Credo      │
                     └────┬─────┘   └────┬─────┘   └──────┬───────┘
                          │              │                 │
                          └──────────────┼─────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    │         Shared Infrastructure           │
                    │  ┌──────────────┐  ┌────────────────┐   │
                    │  │ BCovrin Test │  │   MongoDB       │   │
                    │  │ (Indy Ledger)│  │   (Prisma ORM)  │   │
                    │  └──────────────┘  └────────────────┘   │
                    └─────────────────────────────────────────┘

[Browser Frontend] ──HTTP──→ [Express/Credo Backend] ──DIDComm──→ [Bifold Mobile Wallet]
                                  │
                                  ├──DIDComm──→ [BCovrin TestNet (Indy Ledger)]
                                  │
                                  └──Prisma───→ [MongoDB (Document Storage)]
```

### Agent Port Mapping

| Role | API Port | Agent (DIDComm) Port | Env Var |
|------|----------|----------------------|---------|
| Issuer (Government) | 4000 | 4001 | `ISSUER_API_PORT` |
| Doctor | 4002 | 4003 | `DOCTOR_API_PORT` |
| Pharmacist | 4004 | 4005 | `PHARMACIST_API_PORT` |

### Frontend Page Structure

```
interface/src/app/
├── page.jsx              → Landing page with role selection cards
├── layout.jsx            → Root layout: Geist fonts, global CSS, Navigation
├── patient/page.jsx      → Patient wallet (SIMULATED data — no real SSI)
├── doctor/page.jsx       → Doctor 5-step wizard (1245 lines)
├── pharmacist/page.jsx   → Pharmacist 4-step wizard (558 lines)
├── government/page.jsx   → Government 4-step wizard (1503 lines)
└── verifier/page.jsx     → Verifier stepper (10 lines — delegates to Stepper)
```

---

## 3. Directory Structure Reference

### Full Project Tree

```
ssi-tutorial/
├── README.md                               # Project overview & setup guide
├── SYSTEM-ARCHITECTURE.md                  # THIS FILE — unified architecture docs
├── interface/                              # FRONTEND (Next.js 15 App Router)
│   ├── next.config.ts                      # Next.js config (minimal)
│   ├── tailwind.config.ts                  # Tailwind CSS + @material-tailwind/react
│   ├── tsconfig.json                       # TypeScript (strict: true, @/ alias)
│   ├── postcss.config.mjs                  # PostCSS pipeline
│   ├── package.json                        # name: "recruitement-website" (typo)
│   ├── .env.sample                         # NEXT_PUBLIC_API_URL, ISSUER_CRED_DEF_ID
│   ├── public/                             # Static Lottie animation JSONs (6 files)
│   └── src/
│       ├── app/                            # Next.js App Router pages
│       │   ├── globals.css                 # Tailwind base + custom CSS
│       │   ├── layout.jsx                  # Root layout: Navigation + fonts
│       │   ├── page.jsx                    # Home: role cards + tech features
│       │   ├── patient/page.jsx            # Mock wallet UI (388 lines)
│       │   ├── doctor/page.jsx             # Doctor workflow (1245 lines)
│       │   ├── pharmacist/page.jsx         # Pharmacist workflow (558 lines)
│       │   ├── government/page.jsx         # Government workflow (1503 lines)
│       │   └── verifier/page.jsx           # Verifier stepper (10 lines)
│       ├── components/                     # Shared React components
│       │   ├── Navigation.jsx              # Top nav bar (Home/Government/Doctor/Pharmacist/Patient)
│       │   ├── header.jsx                  # Legacy header (used by IssuerStepper)
│       │   ├── QRCodeDisplay.jsx           # QR code + invitation URL display
│       │   ├── loading.jsx                 # Lottie spinner
│       │   ├── GetStarted.jsx              # Onboarding step
│       │   ├── EstablishConenction.jsx     # Connection setup (note typo in filename)
│       │   ├── ConnectionWithVerifiaction.jsx # Combined connection + verification
│       │   ├── AcceptCredential.jsx        # Credential acceptance UI
│       │   ├── ShareProof.jsx              # Proof sharing UI
│       │   ├── IssuerStepper.jsx           # Stepper for issuer flow
│       │   ├── VerifierStepper.jsx         # Stepper for verifier flow
│       │   ├── Congrats.jsx                # Success animation
│       │   ├── Failure.jsx                 # Failure state
│       │   ├── Apply.jsx                   # Application form
│       │   └── pharmacist/                 # Pharmacist sub-components
│       │       ├── PharmacistHeader.jsx
│       │       ├── PatientConnectionSection.jsx
│       │       ├── ConnectionManager.jsx
│       │       ├── QRCodeSection.jsx
│       │       ├── IdentityVerification.jsx
│       │       ├── PrescriptionVerification.jsx
│       │       ├── DocumentManagement.jsx
│       │       └── StatusMessages.jsx
│       └── services/
│           └── apiService.js               # Centralized HTTP client (387 lines, 12 functions)
│
└── demo/
    ├── postman-api.json                    # Postman collection
    └── credo/                              # BACKEND (Credo TS + Express)
        ├── package.json                    # Dependencies (Credo 0.5.13, Express 4, Prisma 5)
        ├── tsconfig.json                   # TypeScript: ES2020, NodeNext, strict
        ├── .env                            # Agent config: ports, DIDs, seeds, endpoints
        ├── setup-db.sh                     # MongoDB + Prisma setup
        ├── server.ts                       # ★ Main entry: Express server (1799 lines)
        ├── agent.ts                        # BaseAgent class: Credo wrapper (580 lines)
        ├── module.ts                       # Credo module composition (55 lines)
        ├── network.ts                      # Indy ledger genesis config (bcovrin:test)
        ├── types.ts                        # Shared TypeScript interfaces (42 lines)
        ├── prisma/
        │   └── schema.prisma               # Document model (MongoDB)
        └── src/
            ├── lib/
            │   ├── database.ts             # PrismaClient singleton (36 lines)
            │   └── document-storage.ts     # Document CRUD + JWT signing (281 lines)
            ├── routes/
            │   └── document-routes.ts      # Medical document endpoints (627 lines)
            └── services/
                └── document-service.ts     # Document business logic (211 lines)
```

### Backend File Map

| File | Lines | Purpose |
|------|-------|---------|
| `server.ts` | 1799 | Express app, all route handlers, agent lifecycle, proof cache |
| `agent.ts` | 580 | `BaseAgent` — Credo Agent wrapper, DID ops, credential issuance |
| `document-routes.ts` | 627 | 6 document endpoints (upload, issue, verify, share, download) |
| `document-storage.ts` | 281 | MongoDB CRUD with SHA-256 hashing + JWT signing |
| `document-service.ts` | 211 | Static service layer between routes and storage |
| `module.ts` | 55 | Credo module assembly configuration |
| `network.ts` | 24 | BCovrin test net genesis transactions |
| `types.ts` | 42 | Shared type definitions |
| `database.ts` | 36 | PrismaClient singleton |

### Frontend File Map

| File | Lines | Purpose |
|------|-------|---------|
| `government/page.jsx` | 1503 | Government credential issuance wizard |
| `doctor/page.jsx` | 1245 | Doctor prescription issuance wizard |
| `pharmacist/page.jsx` | 558 | Pharmacist verification wizard |
| `apiService.js` | 387 | Centralized HTTP client for 3 backends |
| `patient/page.jsx` | 388 | Mock patient wallet (simulated data) |
| `EstablishConenction.jsx` | 220+ | Connection establishment UI |

---

## 4. Technology Stack Summary

### Backend (`demo/credo/`)

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >=20 |
| Language | TypeScript | 5.7.2 |
| SSI Framework | Credo TS | 0.5.13 |
| Web Server | Express | 4.21 |
| Database | MongoDB (via Prisma) | 5.10 |
| Document Signing | jsonwebtoken | 9.0.2 |
| File Uploads | multer | 1.4.5 |
| Ledger Client | @hyperledger/indy-vdr-nodejs | 0.2.2 |
| Wallet | @hyperledger/aries-askar-nodejs | 0.2.3 |
| Crypto | @hyperledger/anoncreds-nodejs | 0.2.2 |

### Frontend (`interface/`)

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | 15.0.1 |
| UI Library | React | 18.2.0 |
| CSS | Tailwind CSS | 3.4 |
| UI Components | @material-tailwind/react | 2.1.10 |
| Icons | @heroicons/react + lucide-react | - |
| HTTP Client | axios + fetch | 1.7.7 |
| QR Code | qrcode.react | 4.2.0 |
| Animations | lottie-react | 2.4.0 |

---

## 5. Backend API Endpoints

The backend Express server (`server.ts`) serves one of three agent types determined by `--issuer`, `--doctor`, or `--pharmacist` CLI flag. Routes are conditionally registered per agent type.

### Common Routes (all agent types)

These are registered outside the `if (agentType === ...)` blocks in `server.ts`:

| Method | Endpoint | Request Body / Params | Description | Used By Frontend |
|--------|----------|-----------------------|-------------|------------------|
| POST | `/create-invitation` | `{ label, alias, domain }` | Create an out-of-band DIDComm invitation | `apiService.createInvitation()` |
| POST | `/send-proof-request` | `{ connectionId, proofRequestlabel, version }` | Request a proof; attributes/predicates differ by agentType | `apiService.sendProofRequest()` |
| GET | `/proof-records` | `?proofRecordId=` | Get proof records | `apiService.getProofRecords()` |
| POST | `/send-message` | `{ connectionId, message }` | Send a basic DIDComm message | `apiService.sendMessage()` |
| GET | `/proof-data/:proofRecordId` | path param | Get proof data with verification result | `apiService.getProofData()` |
| GET | `/proof-status/:proofRecordId` | path param | Check proof verification status (from cache) | `apiService.getProofStatus()` |
| GET | `/connections` | `?connectionId=` | List or get connections | `apiService.getConnections()` |
| GET | `/wallet-dids` | `?method=` | Get wallet DIDs | Direct fetch (government page) |
| GET | `/agent-status` | none | Get agent status + env vars | Debug endpoint |
| POST | `/clear-proof-cache` | none | Clear in-memory proof status cache | Debug endpoint |
| GET | `/debug-agent` | none | Debug info about agent state | Debug endpoint |

### Issuer-Only Routes (`server.ts:376-775`)

Registered inside `setupIssuerRoutes()`:

| Method | Endpoint | Request Body / Params | Description |
|--------|----------|-----------------------|-------------|
| POST | `/issue-credential` | `{ connectionId, name, age, email, nationalId, medicalCondition, bloodType, emergencyContact }` | Issue AnonCreds identity credential |
| GET | `/issued-credentials` | `?credentialId=` | Get issued credential records |
| POST | `/register-doctor-did` | `{ doctorDid }` | Register doctor DID (cross-agent) |
| POST | `/issue-medical-credential` | `{ connectionId, ... }` | Issue medical credential |
| POST | `/create-schema` | `{ did, name, version, attributes }` | Register a new schema on Indy ledger |
| GET | `/schemas` | `?schemaId=` | Get schema details |
| POST | `/credential-definition` | `{ did, schemaId, tag }` | Create credential definition |
| GET | `/credential-definitions` | `?credentialDefinitionId=` | Get credential definitions |
| GET | `/credential-definition` | `?credentialDefinitionId=` | Get single credential definition |

### Doctor-Only Routes (`server.ts:776-1012`)

Registered inside `setupDoctorRoutes()`:

| Method | Endpoint | Request Body / Params | Description |
|--------|----------|-----------------------|-------------|
| POST | `/issue-medical-credential` | `{ connectionId, ... }` | Issue medical credential |
| POST | `/issue-prescription` | `{ connectionId, ... }` | Issue prescription credential |
| GET | `/issued-credentials` | `?credentialId=` | Get issued credentials |
| POST | `/verify-prescription` | `{ connectionId }` | Verify prescription proof |

### Pharmacist-Only Routes (`server.ts:1013-1277`)

Registered inside `setupPharmacistRoutes()`:

| Method | Endpoint | Request Body / Params | Description |
|--------|----------|-----------------------|-------------|
| POST | `/verify-patient-identity` | `{ connectionId }` | Request identity proof from patient |
| POST | `/verify-prescription` | `{ connectionId }` | Request prescription proof |
| GET | `/prescription-details` | `?connectionId=` | Get prescription details |

### Document Routes (all agent types)

From `src/routes/document-routes.ts`:

| Method | Endpoint | Request Body / Params | Description |
|--------|----------|-----------------------|-------------|
| POST | `/medical-document/upload` | multipart: file + patientDid + docType | Upload document, store in MongoDB, issue credential |
| POST | `/medical-document/issue-credential` | `{ patientDid, documentType, ... }` | Issue credential for document (no file) |
| POST | `/medical-document/verify` | `{ documentId, documentHash }` | Verify document integrity |
| GET | `/medical-document/share/:token` | path param | Share document by token |
| GET | `/medical-document/:documentId` | path param | Get document by ID |
| GET | `/medical-document/download/:documentId` | path param | Download document content |
| POST | `/medical-document/access` | `{ token }` | Access shared document |

---

## 6. Data Flow

### Flow 1: Government Issues Identity Credential

```
Frontend (Government Page)          Express (Issuer Agent :4000)     Bifold Wallet
┌─────────────────────────┐         ┌─────────────────────────┐     ┌──────────────┐
│ 1. Click "Create        │         │                         │     │              │
│    Invitation"          │────POST─▶  /create-invitation     │     │              │
│                         │         │  Returns invitationUrl  │     │              │
│ 2. QR Code displayed    │◀───resp─│  with QR code data      │     │              │
│    (invitationUrl)      │         │                         │     │              │
│                         │         │                         │     │              │
│ 3. User scans QR        │         │                         │◀────│ Scans QR     │
│    with Bifold wallet   │         │  DIDComm Handshake      │     │ (accepts     │
│                         │         │◀────────────────────────▶│     │  invitation) │
│ 4. Poll /connections    │────GET──▶  /connections           │     │              │
│    every 5s             │         │  (state: completed)     │     │              │
│                         │◀───resp─│                         │     │              │
│ 5. Fill patient form    │         │                         │     │              │
│    (name, age, etc.)    │────POST─▶  /issue-credential      │─────▶  Credential │
│                         │         │  AnonCreds issuance     │     │  Offer       │
│                         │         │◀────────────────────────▶│     │              │
│ 6. Show success +       │◀───resp─│  credential exchange ID │     │  Accepts     │
│    credential details   │         │                         │     │  credential  │
└─────────────────────────┘         └─────────────────────────┘     └──────────────┘
```

### Flow 2: Doctor Issues Prescription

```
Frontend (Doctor Page)              Express (Doctor Agent :4002)     Bifold Wallet
┌─────────────────────────┐         ┌─────────────────────────┐     ┌──────────────┐
│ 1. "Create Secure       │────POST─▶  /create-invitation     │     │              │
│    Connection"          │◀───resp─│  Returns invitationUrl  │     │              │
│ 2. QR code displayed    │         │                         │     │              │
│    patient scans        │         │                         │◀────│ Scans QR     │
│ 3. Poll /connections    │────GET──▶  /connections           │     │              │
│    every 3s             │◀───resp─│  state: completed       │     │              │
│ 4. "Verify Patient      │────POST─▶  /send-proof-request    │─────▶  Proof      │
│    Identity"            │         │  (restricted to govt    │     │  Request     │
│                         │         │   cred_def_id)         │     │              │
│ 5. Poll /proof-status   │────GET──▶  /proof-status/:id     │     │  Patient     │
│    every 1s             │◀───resp─│  isVerified: true       │     │  shares      │
│ 6. Upload medical       │────POST─▶  /medical-document/     │     │  proof       │
│    document             │         │  upload (multipart)     │     │              │
│ 7. Document stored in   │         │  MongoDB + SHA-256      │     │              │
│    MongoDB, credential  │         │  + JWT signed           │     │              │
│    issued via AnonCreds │         │                         │     │              │
│ 8. Show success +       │◀───resp─│  documentId + hash      │     │              │
│    document ID          │         │                         │     │              │
└─────────────────────────┘         └─────────────────────────┘     └──────────────┘
```

### Flow 3: Pharmacist Verifies Prescription

```
Frontend (Pharmacist Page)          Express (Pharmacist Agent :4004)
┌─────────────────────────┐         ┌─────────────────────────┐
│ 1. "Create Connection"  │────POST─▶  /create-invitation     │
│ 2. QR code displayed    │◀───resp─│  invitationUrl          │
│    patient scans        │         │                          │
│ 3. Poll /connections    │────GET──▶  /connections            │
│    every 3s             │◀───resp─│  state: completed        │
│ 4. "Verify Patient      │────POST─▶  /verify-patient-identity│
│    Identity"            │         │  → /send-proof-request   │
│ 5. Poll proof status    │────GET──▶  /proof-status/:id       │
│                         │◀───resp─│  isVerified: true        │
│ 6. "Verify Prescription"│────POST─▶  /verify-prescription    │
│ 7. Poll proof status    │────GET──▶  /proof-status/:id       │
│                         │◀───resp─│  isVerified: true        │
│ 8. Fetch document       │────GET──▶  /medical-document/:id   │
│    metadata             │◀───resp─│  document metadata       │
│ 9. Download document    │────GET──▶  /medical-document/      │
│                         │         │  download/:id           │
└─────────────────────────┘         └─────────────────────────┘
```

### Credential Data Models

**Government Identity Credential Schema:**
```
name: "patient_credential"
version: "1.1.<random>"
attrNames: ["name", "age", "email", "nationalId", "medicalCondition", "bloodType", "emergencyContact"]
```

**Doctor Verification Request (restricted to government-issued cred):**
```
attributes: { identity_info: { names: ["nationalId", "name", "medicalCondition", "bloodType"] } }
predicates: { age_check: { name: "age", p_type: ">=", p_value: 18 } }
```

**MongoDB Document Schema:**
```
{
  documentId: UUID,
  patientDid: string,
  content: Bytes (file binary),
  fileName: string,
  mimeType: string,
  sha256: string (hash),
  docType: "PRESCRIPTION" | "LAB_REPORT" | "MEDICAL_RECORD",
  issuedBy: string (DID),
  issuedAt: DateTime,
  signature: string (JWT),
  createdAt: DateTime,
  updatedAt: DateTime
}
```

---

## 7. Frontend-Backend Integration

### Communication Protocol

| Aspect | Detail |
|--------|--------|
| Protocol | HTTP (plain, no TLS) |
| Data Format | JSON (REST) / multipart (file uploads) |
| Auth | **None** — all routes open, CORS `origin: *` |
| Real-time | Polling via `setInterval` (1-5s intervals) — no WebSockets |
| Error handling | `apiService.js` silently returns empty arrays/null on failures |

### API Service Layer (`interface/src/services/apiService.js`)

The frontend uses a single centralized service file with 12 exported functions:

| Function | Agent | Endpoint Called | Returns |
|----------|-------|-----------------|---------|
| `createInvitation(agentType, label, alias)` | any | POST `/create-invitation` | `{ invitationUrl, ... }` |
| `getConnections(agentType, connectionId?)` | any | GET `/connections` | `Connection[]` |
| `issuePatientCredential(connectionId, patientData)` | government | POST `/issue-credential` | credential result |
| `sendProofRequest(agentType, connectionId, label)` | any | POST `/send-proof-request` | proof request result |
| `uploadMedicalDocument(file, patientDid, docType)` | doctor | POST `/medical-document/upload` | upload result |
| `verifyMedicalDocument(documentId, documentHash)` | pharmacist | POST `/medical-document/verify` | `{ verified, reason }` |
| `getMedicalDocument(documentId)` | pharmacist | GET `/medical-document/:id` | Blob |
| `sendMessage(agentType, connectionId, message)` | any | POST `/send-message` | message result |
| `getProofRecords(agentType, proofRecordId?)` | any | GET `/proof-records` | `ProofRecord[]` |
| `getProofData(agentType, proofRecordId)` | any | GET `/proof-data/:id` | proof data + `isVerified` |
| `getProofStatus(agentType, proofRecordId)` | any | GET `/proof-status/:id` | `{ isVerified, state }` |

### Agent Endpoint Configuration

```javascript
const AGENT_ENDPOINTS = {
  government: "http://localhost:4000",
  doctor: "http://localhost:4002",
  pharmacist: "http://localhost:4004",
};
```

**Note:** The `government` page also makes direct fetch calls bypassing `apiService.js` — an inconsistency documented in the concerns.

### Polling Patterns

| Page | Polling Endpoint | Interval | Purpose |
|------|------------------|----------|---------|
| `/government` | `getConnections("government")` | 5s | Detect patient connection |
| `/doctor` | `getConnections("doctor")` | 3s | Detect patient connection |
| `/doctor` | `getProofStatus()` | 1s | Check identity verification |
| `/pharmacist` | `getConnections("pharmacist")` | 3s | Detect patient connection |
| `/pharmacist` | proof status polling | 2-3s | Check verification chains |
| `EstablishConenction` | internal polling | 2s | Connection detection |
| `ShareProof` | internal polling | 2s | Proof completion detection |

### Frontend State Management

- **No global state:** Each page manages all state via `useState` hooks
- **No Context API:** Components receive props directly from parent pages
- **No Redux/Zustand:** State management is entirely per-page
- **Pattern:** `const [step, setStep] = useState(1)` — each step is a number controlling conditional rendering

---

## 8. External Integrations

### 8.1 Indy Ledger — BCovrin TestNet

| Property | Value |
|----------|-------|
| **Network** | `bcovrin:test` (public permissioned Indy ledger) |
| **Access** | Via `@hyperledger/indy-vdr-nodejs` through `@credo-ts/indy-vdr` |
| **Genesis** | Hardcoded 4-node pool config in `network.ts` |
| **Purpose** | DID registration, schema publishing, credential definition registry |
| **Frontend access** | None — all ledger interaction is backend-only |

### 8.2 MongoDB

| Property | Value |
|----------|-------|
| **Connection** | Prisma ORM via `DATABASE_URL` env var |
| **Schema** | Single `Document` model (see above) |
| **Operations** | Store, retrieve, verify, list documents |
| **Access in frontend** | None — only via backend API endpoints |

### 8.3 AnonCreds (Anonymous Credentials)

| Property | Value |
|----------|-------|
| **Standard** | Hyperledger AnonCreds v2 (CL signatures) |
| **Implementation** | `@hyperledger/anoncreds-nodejs` via `@credo-ts/anoncreds` |
| **Fallback** | W3C credentials via basic DIDComm messages (when AnonCreds fails) |
| **Frontend role** | Triggers flow — no direct crypto operations |

### 8.4 Bifold Mobile Wallet

| Property | Value |
|----------|-------|
| **App** | Bifold (open-source Aries mobile wallet) |
| **Platform** | iOS / Android |
| **Connection** | User scans QR code displayed by frontend |
| **Role** | Holder — stores and shares credentials |
| **Communication** | DIDComm over HTTP via ngrok tunnels |

### 8.5 ngrok

| Property | Value |
|----------|-------|
| **Purpose** | Expose local backend agents to public internet |
| **Why needed** | Bifold wallet on mobile network cannot reach localhost |
| **Config** | Agent public endpoints set via env vars (``_AGENT_PUBLIC_ENDPOINT`) |
| **Ports** | 4001 (Issuer), 4003 (Doctor), 4005 (Pharmacist) |

### 8.6 Non-Localhost Deployment

| Aspect | Current State |
|--------|--------------|
| HTTPS | Not used — all HTTP |
| Docker | No Dockerfile or container config |
| CI/CD | No pipeline detected |
| Cloud | No deployment target |
| Monitoring | None — `console.log` only |
| Authentication | None — all endpoints open |

---

## 9. Setup Instructions

### Prerequisites

- Node.js >=20
- MongoDB instance (local or remote)
- Yarn or npm
- ngrok account (for mobile wallet connectivity)

### Step 1: Backend Setup

```bash
# Navigate to backend
cd demo/credo

# Install dependencies
yarn install

# Configure environment
# Edit .env with your values:
# - Set agent DIDs and seeds
# - Set MongoDB DATABASE_URL
# - Set ngrok public endpoints

# Set up MongoDB
chmod +x setup-db.sh
./setup-db.sh

# Run Prisma schema push
npx prisma db push

# Start agents (3 separate terminals)

# Terminal 1: Issuer (Government)
yarn issuer
# Starts on http://localhost:4000 (API) + 4001 (agent DIDComm)

# Terminal 2: Doctor
yarn doctor
# Starts on http://localhost:4002 (API) + 4003 (agent DIDComm)

# Terminal 3: Pharmacist
yarn pharmacist
# Starts on http://localhost:4004 (API) + 4005 (agent DIDComm)
```

### Step 2: Set Up ngrok (for each agent)

```bash
# In separate terminals, expose each agent's DIDComm port:
ngrok http 4001  # Issuer agent port
ngrok http 4003  # Doctor agent port
ngrok http 4005  # Pharmacist agent port

# Copy each ngrok URL into .env as:
# ISSUER_AGENT_PUBLIC_ENDPOINT=https://xxxx.ngrok.io
# DOCTOR_AGENT_PUBLIC_ENDPOINT=https://xxxx.ngrok.io
# PHARMACIST_AGENT_PUBLIC_ENDPOINT=https://xxxx.ngrok.io
```

### Step 3: Frontend Setup

```bash
# Navigate to frontend
cd interface

# Install dependencies
npm install

# Configure environment
cp .env.sample .env.local
# Edit .env.local:
#   NEXT_PUBLIC_API_URL=http://localhost:4002
#   ISSUER_CRED_DEF_ID=<issuer's cred def ID from backend logs>

# Start development server
npm run dev
# Opens at http://localhost:3000
```

### Step 4: Mobile Wallet

1. Install Bifold wallet on your mobile device
2. Navigate through the frontend portals
3. When a QR code is displayed, scan it with Bifold
4. Accept invitations, credential offers, and proof requests in Bifold

---

## 10. Design Rationale

### Why Three Separate Backend Processes?

Each agent type (issuer, doctor, pharmacist) runs as an **independent Node.js process** with its own Express server. This reflects the SSI trust triangle where each party operates autonomously:

- **Security isolation:** Each agent has its own DID, wallet, and private keys
- **Network independence:** Agents can run on different machines or networks
- **Ledger separation:** Each agent publishes its own schemas/cred-defs to the ledger

The downside is operational complexity — three servers to manage, three ngrok tunnels, shared env config.

### Why Monolithic `server.ts` on Backend?

The `server.ts` bundles agent init + all routes + proof cache in one file. This is a **conscious tradeoff** for a demo/tutorial project:
- Simpler to understand for newcomers to SSI
- No module boundaries to navigate when learning
- Single file shows the complete API surface

The concerns documents identify this as tech debt for production use.

### Why Polling Instead of WebSockets?

The frontend uses `setInterval` polling because:
- The Credo/Express backend does not expose WebSocket endpoints
- DIDComm state changes are event-driven but not pushed to HTTP clients
- Simplifies demo implementation — no need for Socket.io or SSE setup

This is a performance concern for scale but acceptable for a single-user demo.

### Why Simulated Patient Page?

The patient page (`patient/page.jsx`) uses hardcoded mock data with `setTimeout` simulations:
- Real patient interaction requires a mobile wallet (Bifold) — not a web browser
- The SSI holder role is inherently mobile-native
- The mock page demonstrates the wallet UX concept without requiring an actual wallet app

### Why AnonCreds + W3C Fallback?

AnonCreds provides zero-knowledge proofs (selective disclosure, predicates like "age >= 18"). However, it requires Indy ledger access and is complex. The W3C basic-message fallback:
- Ensures the demo works even without ledger connectivity
- Demonstrates graceful degradation
- Makes the system resilient to ledger unavailability

### Frontend URL Hardcoding

The frontend hardcodes `http://localhost:4000/4002/4004` for agent URLs. This is acceptable for a local demo but would need `NEXT_PUBLIC_*` env vars for any non-local deployment.

---

## 11. Module Dependencies

### Backend Dependency Graph

```
types.ts (shared interfaces)
    │
    ▼
network.ts (ledger pool config)
    │
    ▼
module.ts (Credo module assembly)
    │
    ▼
agent.ts (BaseAgent — Credo wrapper)
    │
    ├──────────────────────────────────────┐
    ▼                                      ▼
server.ts (Express + routes)     src/lib/database.ts (Prisma singleton)
    │                                      │
    │                                      ▼
    └─────────────────────┐     src/lib/document-storage.ts (MongoDB CRUD)
                          │              │
                          │              ▼
                          │     src/services/document-service.ts (business logic)
                          │              │
                          │              ▼
                          └──── src/routes/document-routes.ts (HTTP handlers)
```

### Frontend Dependency Graph

```
layout.jsx (root)
    │
    ├── Navigation.jsx (shared nav bar)
    │
    ▼
page.jsx (home) ──► role-specific pages:
    │
    ├── government/page.jsx ──► apiService.js ──► [Issuer Agent :4000]
    │               │
    │               ├── IssuerStepper.jsx
    │               ├── header.jsx
    │               ├── QRCodeDisplay.jsx
    │               ├── EstablishConenction.jsx
    │               └── ...stepper components
    │
    ├── doctor/page.jsx ──► apiService.js ──► [Doctor Agent :4002]
    │
    ├── pharmacist/page.jsx ──► apiService.js ──► [Pharmacist Agent :4004]
    │       │
    │       ├── PharmacistHeader.jsx
    │       ├── PatientConnectionSection.jsx
    │       ├── IdentityVerification.jsx
    │       ├── PrescriptionVerification.jsx
    │       └── DocumentManagement.jsx
    │
    ├── patient/page.jsx (simulated — no backend connection)
    │
    └── verifier/page.jsx ──► VerifierStepper.jsx
```

### Cross-Codebase Integration

```
interface/src/services/apiService.js
    │
    ├── POST /create-invitation  ──► demo/credo/server.ts:1499  ──► agent.ts:278
    ├── GET  /connections        ──► demo/credo/server.ts:1531  ──► agent.ts:290
    ├── POST /send-proof-request ──► demo/credo/server.ts:1374  ──► agent.ts:500
    ├── POST /issue-credential   ──► demo/credo/server.ts:380   ──► agent.ts:404
    ├── POST /medical-document/upload ──► document-routes.ts:257 ──► document-storage.ts
    ├── POST /send-message       ──► demo/credo/server.ts:1726  ──► agent.ts:547
    └── GET  /proof-status/:id   ──► demo/credo/server.ts:1657  ──► proofStatusCache
```

---

## 12. Development Guide

### Adding a New Agent Type

1. **Backend (`server.ts`):** Add `agentType === "--new-role"` branch in all conditional blocks (port mapping, endpoint config, route functions, proof request attributes)
2. **Backend (`package.json`):** Add npm script: `"new-role": "npx ts-node server.ts --new-role"`
3. **Backend (`.env`):** Add `NEW_ROLE_API_PORT`, `NEW_ROLE_DID`, `NEW_ROLE_SEED`, etc.
4. **Frontend (`apiService.js`):** Add `newRole: "http://localhost:<port>"` to `AGENT_ENDPOINTS`
5. **Frontend:** Create `interface/src/app/new-role/page.jsx`
6. **Frontend (`Navigation.jsx`):** Add nav link for new role

### Adding a New API Endpoint

1. **Backend:** Add route handler in `server.ts` (following existing pattern) or create new route file in `src/routes/`
2. **Backend:** Add business logic in `src/services/` or `src/lib/`
3. **Frontend:** Add function in `apiService.js`
4. **Frontend:** Call from page component

### Running Tests

**There are currently no automated tests** in either codebase. The `package.json` test scripts are placeholders:
- Backend: `echo "Error: no test specified" && exit 1`
- Frontend: No test script defined

Testing is done manually by running agents and using the web UI + Bifold wallet.

### Key Env Vars Reference

| Variable | Purpose | Default |
|----------|---------|---------|
| `ISSUER_API_PORT` | Issuer HTTP API port | 4000 |
| `DOCTOR_API_PORT` | Doctor HTTP API port | 4002 |
| `PHARMACIST_API_PORT` | Pharmacist HTTP API port | 4004 |
| `DATABASE_URL` | MongoDB connection string | — |
| `ISSUER_AGENT_PUBLIC_ENDPOINT` | Issuer ngrok URL for DIDComm | — |
| `DOCTOR_AGENT_PUBLIC_ENDPOINT` | Doctor ngrok URL for DIDComm | — |
| `PHARMACIST_AGENT_PUBLIC_ENDPOINT` | Pharmacist ngrok URL for DIDComm | — |
| `DOCUMENT_SIGNING_SECRET` | JWT secret for document signatures | `default-secret-key-change-in-production` |
| `NEXT_PUBLIC_API_URL` | Frontend: agent base URL | `http://localhost:4002` |
| `ISSUER_CRED_DEF_ID` | Frontend: government cred def ID | — |

### Common Issues

- **"Agent not available" in frontend:** Ensure the corresponding backend agent is running on the correct port
- **Connection never completes in UI:** Check ngrok tunnels are active and `AGENT_PUBLIC_ENDPOINT` env vars are correct
- **Schema/cred-def creation fails:** BCovrin TestNet may be down — check ledger connectivity
- **"dummy-" credential definitions:** Backend agent initialization failed — check agent logs
- **Proof shows "verified" before actual verification:** Known bug — the `verifiedStates` array includes intermediate states (`request-received`, `presentation-sent`)

---

*Unified architecture documentation generated 2026-05-23 from `demo/credo/.planning/codebase/` and `interface/.planning/codebase/` codebase maps.*
