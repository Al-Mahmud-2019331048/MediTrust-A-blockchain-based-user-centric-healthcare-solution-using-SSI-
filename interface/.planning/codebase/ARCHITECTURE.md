<!-- refreshed: 2026-05-23 -->
# Architecture

**Analysis Date:** 2026-05-23

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js App Router)                    │
│  `interface/src/app/*/page.jsx`  `interface/src/components/`        │
├──────────────┬──────────────┬──────────────┬────────────────────────┤
│  /patient    │  /doctor     │  /pharmacist │ /government  /verifier │
│  Wallet UI   │  Issue flow  │  Verify flow │  Issue creds           │
└──────┬───────┴──────┬───────┴──────┬───────┴───────────┬────────────┘
       │              │              │                   │
       ▼              ▼              ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│              API Service Layer  (`src/services/apiService.js`)       │
│         Centralized fetch client → 3 agent endpoints                │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Issuer Agent    │ │  Doctor Agent    │ │  Pharmacist Agent│
│  :4000           │ │  :4002           │ │  :4004           │
│  `server.ts`     │ │  `server.ts`     │ │  `server.ts`     │
│  Express + Credo │ │  Express + Credo │ │  Express + Credo │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Shared Infrastructure                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │ Indy Ledger  │  │ MongoDB      │  │ Local Filesystem          │   │
│  │ bcovrin test │  │ (Prisma)     │  │ document files + IPFS     │   │
│  │ `network.ts` │  │ `database.ts`│  │ `document-storage.ts`     │   │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Patient Page | Wallet UI — credentials, connections, documents with simulated data | `interface/src/app/patient/page.jsx` |
| Doctor Page | 5-step flow: connect → QR → verify identity → issue medical document → complete | `interface/src/app/doctor/page.jsx` |
| Pharmacist Page | 4-step flow: connect → verify identity → verify prescription → document mgmt | `interface/src/app/pharmacist/page.jsx` |
| Government Page | 4-step flow: create invitation → QR → issue identity credential → complete | `interface/src/app/government/page.jsx` |
| Verifier Page | Stepper-based verification flow | `interface/src/app/verifier/page.jsx` |
| Home Page | Landing with role cards + technical features | `interface/src/app/page.jsx` |
| apiService | Centralized HTTP client for all 3 agent backends | `interface/src/services/apiService.js` |
| Navigation | Top nav bar with links to all portals | `interface/src/components/Navigation.jsx` |
| PharmacistHeader | Header + progress indicator for pharmacist flow | `interface/src/components/pharmacist/PharmacistHeader.jsx` |
| PatientConnectionSection | QR code display + connection management | `interface/src/components/pharmacist/PatientConnectionSection.jsx` |
| IdentityVerification | Patient identity verification UI | `interface/src/components/pharmacist/IdentityVerification.jsx` |
| PrescriptionVerification | Prescription credential verification UI | `interface/src/components/pharmacist/PrescriptionVerification.jsx` |
| DocumentManagement | Fetch/download verified documents | `interface/src/components/pharmacist/DocumentManagement.jsx` |
| StatusMessages | Error/success notification display | `interface/src/components/pharmacist/StatusMessages.jsx` |
| QRCodeDisplay | QR code rendering + debug info | `interface/src/components/QRCodeDisplay.jsx` |
| IssuerStepper | Stepper UI for issuer (government) flow | `interface/src/components/IssuerStepper.jsx` |
| VerifierStepper | Stepper UI for verifier role | `interface/src/components/VerifierStepper.jsx` |
| BaseAgent | Credo Agent wrapper class | `demo/credo/agent.ts` |
| server.ts | Express API server (monolithic, shared by all agents) | `demo/credo/server.ts` |
| module | Credo module registration (AnonCreds, IndyVDR, Askar) | `demo/credo/module.ts` |
| network | Indy ledger network configuration (bcovrin test net) | `demo/credo/network.ts` |
| DocumentService | MongoDB document CRUD operations | `demo/credo/src/services/document-service.ts` |
| DocumentRoutes | Document upload/download API endpoints | `demo/credo/src/routes/document-routes.ts` |

## Pattern Overview

**Overall:** Role-based portal architecture with shared SSI backend services. Each role (patient, doctor, pharmacist, government, verifier) has a dedicated page implementing a wizard/stepper workflow. The frontend polls backend agents for async state changes (connection status, proof verification).

**Key Characteristics:**
- Same compiled `server.ts` binary runs as 3 separate agents (issuer/doctor/pharmacist) using `--issuer`, `--doctor`, `--pharmacist` CLI flags
- Frontend uses polling (setInterval 3-5s) instead of WebSockets for real-time updates
- Agent types share the same codebase, differentiated by env vars (port, DID, seed, label, endpoint)
- All three agent types run the same monolithic Express server from `server.ts` — route handlers branch on `agentType`
- Frontend pages are large (388-1220+ lines per page), using inline `useState` for state management
- AnonCreds format for verifiable credentials, Indy ledger (bcovrin test net) for schema/cred-def publishing

## Layers

**Frontend (Next.js App Router):**
- Purpose: User interface for 5 role portals
- Location: `interface/src/app/`
- Contains: Page components (page.jsx), shared components (`components/`), API client (`services/`)
- Depends on: `apiService.js` for backend communication
- Used by: Browser clients

**API Service Layer:**
- Purpose: Centralized HTTP client abstracting 3 agent backends
- Location: `interface/src/services/apiService.js`
- Contains: Functions for invitations, connections, proofs, credentials, document uploads
- Depends on: Running agent instances on ports 4000/4002/4004
- Used by: All page components

**Credo Agent Layer:**
- Purpose: SSI agent logic wrapping Credo TS v0.5.13
- Location: `demo/credo/agent.ts`
- Contains: BaseAgent class with connection management, credential issuance, proof verification
- Depends on: `@credo-ts/core`, `@credo-ts/anoncreds`, `@credo-ts/indy-vdr`, `@credo-ts/askar`
- Used by: `server.ts` (all agent types)

**Express API Layer:**
- Purpose: HTTP endpoints for each agent's public interface
- Location: `demo/credo/server.ts`
- Contains: ~30 routes for invitations, connections, credentials, proofs, documents, debugging
- Depends on: BaseAgent, DocumentService, multer for file uploads
- Used by: Frontend API service

**Document Storage Layer:**
- Purpose: Document persistence and retrieval
- Location: `demo/credo/src/lib/database.ts`, `demo/credo/src/lib/document-storage.ts`
- Contains: MongoDB connection via Prisma, local file storage for uploaded documents
- Depends on: MongoDB, Prisma ORM
- Used by: DocumentService, server.ts document routes

## Data Flow

### Primary Request Path — Doctor Issues Prescription

1. Doctor clicks "Create Secure Connection" → `doctor/page.jsx:63` calls `apiService.createInvitation("doctor", ...)`
2. `apiService.js:24` POSTs to `http://localhost:4002/create-invitation`
3. `server.ts:1499` handles request, calls `agent.createInvitation()` which creates out-of-band invitation via Credo
4. Response returns `invitationUrl` → page renders QR code via `QRCodeDisplay`
5. Frontend polls `apiService.getConnections("doctor")` every 3s (`doctor/page.jsx:58`) to detect when patient scans QR
6. On connection detected → step advances to identity verification
7. Doctor clicks "Start Identity Verification" → `apiService.sendProofRequest()` → POST /send-proof-request
8. Frontend polls `apiService.getProofStatus()` every 1s to check verification result
9. On verified → step advances to document upload
10. Doctor uploads file → `apiService.uploadMedicalDocument()` → POST /medical-document/upload
11. `server.ts` handles via `multer` → stores file + saves document metadata to MongoDB
12. Frontend shows success with document ID and hash

### Pharmacist Verifies Prescription

1. Pharmacist page loads → generates QR code via `/create-invitation` (port 4004)
2. Frontend polls `/connections` every 3s
3. On connection → `/verify-patient-identity` → obtains identity proof
4. On identity verified → `/verify-prescription` → obtains prescription credential proof
5. Pharmacist can fetch actual document from `/fetch-prescription-document` or download from `/download-prescription/:id`

**State Management:**
- Frontend: Per-page React `useState` hooks — no global state management (no Redux, Context, etc.)
- Backend: In-memory proof status cache (`proofStatusCache` in `server.ts:77`) — NOT persisted
- Databases: MongoDB (via Prisma) for document metadata; Indy ledger for schemas/credential definitions

## Key Abstractions

**BaseAgent:**
- Purpose: Encapsulates Credo Agent lifecycle, offers typed methods for SSI operations
- Location: `demo/credo/agent.ts`
- Methods: `init()`, `createInvitation()`, `acceptInvitation()`, `getConnections()`, `sendProofRequest()`, `issueCredential()`, `sendMessage()`, `registerProofStateListener()`
- Pattern: Wrapper/Adapter around `@credo-ts/core` Agent class

**AgentModules:**
- Purpose: Composes all Credo sub-modules into a typed agent
- Location: `demo/credo/module.ts`
- Modules: ConnectionsModule, AnonCredsModule, IndyVdrModule, DidsModule, AskarModule, CredentialsModule, ProofsModule
- Pattern: Module registration (dependency injection into Credo Agent constructor)

**API Service:**
- Purpose: Abstracts HTTP calls away from page components
- Location: `interface/src/services/apiService.js`
- Pattern: Plain functions per operation, all return Promises, error handling with graceful fallbacks (empty arrays on failure)

**Pharmacist Sub-components:**
- Purpose: Decompose the pharmacist page into logical sections
- Location: `interface/src/components/pharmacist/*.jsx`
- Pattern: Presentational components receiving props from parent page — each progressively revealed based on previous step's success

## Entry Points

**Frontend:**
- Root layout: `interface/src/app/layout.jsx` — applies Geist fonts + global CSS
- Home: `interface/src/app/page.jsx` — landing page with role navigation
- Each role page is a top-level route: `/patient`, `/doctor`, `/pharmacist`, `/government`, `/verifier`

**Backend — Agent instances:**
- Issuer: `npx ts-node server.ts --issuer` → port 4000
- Doctor: `npx ts-node server.ts --doctor` → port 4002
- Pharmacist: `npx ts-node server.ts --pharmacist` → port 4004

**Backend — DB initialization:**
- MongoDB init: `demo/credo/src/lib/database.ts` — called once at server start (line 139)

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop per agent. Each agent is a separate process.
- **Global state:** `proofStatusCache` in `demo/credo/server.ts:77` is an in-memory module-level singleton — lost on restart
- **Circular imports:** Not detected — layer separation is clear (pages → services → server)
- **All agents share one codebase:** `demo/credo/server.ts` branches behavior on `agentType` string — same binary, different configs
- **Frontend-backend coupling:** Frontend has hardcoded agent URLs (`http://localhost:4000/4002/4004`) in `interface/src/services/apiService.js:5-8`

## Anti-Patterns

### Monolithic server.ts

**What happens:** Single `demo/credo/server.ts` (1799 lines) handles all routes for all 3 agent types with conditional branching. Route handlers are interleaved with agent initialization, proof caching, and file upload config.

**Why it's wrong:** Violates Single Responsibility. Adding a new agent type or feature requires editing this massive file. Testing individual routes is complex. Creates merge conflicts on concurrent changes.

**Do this instead:** Split into separate route modules per agent domain (invitations, credentials, proofs, documents) — similar to how `document-routes.ts` already demonstrates the pattern.

### Hardcoded frontend-backend URLs

**What happens:** `interface/src/services/apiService.js:5-8` hardcodes `localhost:4000/4002/4004` per agent type.

**Why it's wrong:** Breaks in non-local deployments, containerized environments, or when port conflicts occur. No environment variable indirection for the frontend base URLs.

**Do this instead:** Use `NEXT_PUBLIC_*` env vars with defaults, similar to the existing `.env.sample` pattern.

### Frontend polling instead of push

**What happens:** Doctor and pharmacist pages poll every 1-5 seconds for connection/proof state changes using `setInterval`.

**Why it's wrong:** Wasteful — generates HTTP requests even when nothing changed. Scales poorly with many clients. Higher latency than push-based alternatives.

**Do this instead:** WebSocket connection or Server-Sent Events (SSE) from the Express backend for real-time state push.

### In-memory proof cache without persistence

**What happens:** `proofStatusCache` in `server.ts:77` is a plain JS object — lost on server restart.

**Why it's wrong:** If the server restarts mid-proof (e.g., after a patient scanned QR but before verification completes), the cache is empty and the polling frontend never sees completion. Also not shareable across agent instances.

**Do this instead:** Use the Credo agent's built-in proof record storage or persist to MongoDB.

## Error Handling

**Strategy:** Try/catch with console.error logging. Frontend returns empty arrays on failure to prevent UI breaks during polling.

**Patterns:**
- `apiService.js`: All functions return empty arrays or `null` on error (polling-friendly pattern at lines 86-108, 302-306)
- `server.ts`: Routes return `{ error: error.message }` with 500 status
- Frontend pages: Error state displayed via `StatusMessages` component or inline error div (red banner pattern)

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` throughout — no structured logging library. Each server operation has descriptive emoji-prefixed log messages (e.g., `🏥 Starting patient identity verification...`).

**Validation:** Minimal — server checks required body fields exist. Frontend form validation is basic (required attribute, some pre-submit checks).

**Authentication:** None — all agents expose open endpoints with CORS `origin: "*"`. No API keys, JWTs, or session auth on any route.

---

*Architecture analysis: 2026-05-23*
