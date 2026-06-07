<!-- refreshed: 2026-05-23 -->
# Architecture

**Analysis Date:** 2026-05-23

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Express HTTP API                          │
│  `server.ts` (1799 lines) — routes, middleware, lifecycle        │
├──────────────┬──────────────────────┬───────────────────────────┤
│ Issuer Agent │    Doctor Agent      │   Pharmacist Agent        │
│ `--issuer`   │   `--doctor`         │   `--pharmacist`          │
│ Port 4000    │   Port 4002          │   Port 4004               │
└──────┬───────┴──────────┬───────────┴─────────────┬─────────────┘
       │                  │                         │
       ▼                  ▼                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BaseAgent Class                             │
│  `agent.ts` (580 lines) — Credo agent lifecycle + operations     │
│  Wraps: Agent, DIDs, Connections, Credentials, Proofs, Messages    │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Credo Agent Modules                             │
│  `module.ts` (55 lines) — module composition                    │
│  - AnonCredsModule (AnonCredsCredentialFormatService)            │
│  - IndyVdrModule (bcovrin:test network)                         │
│  - AskarModule (secure wallet storage)                          │
│  - DidsModule (IndyVdrIndyDidResolver+Registrar)                │
│  - ConnectionsModule (auto-accept)                              │
│  - CredentialsModule (V2CredentialProtocol)                     │
│  - ProofsModule (V2ProofProtocol)                               │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Ledger Network + Storage                                        │
│  `network.ts` — bcovrin:test Indy ledger pool config            │
│  `prisma/schema.prisma` — MongoDB via Prisma ORM                │
│  `src/lib/` — database.ts (Prisma singleton), document-storage   │
│  `src/services/` — document-service.ts (business logic)          │
│  `src/routes/` — document-routes.ts (HTTP handlers)             │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `server.ts` | App entry, Express setup, route registration per agent type, proof-cache management | `server.ts` |
| `BaseAgent` | Credo agent lifecycle (init, shutdown), DID ops, connection/invitation mgmt, credential issuance, proof requests, messaging | `agent.ts` |
| `baseAgentModule` | Composes Credo modules (AnonCreds, IndyVdr, Askar, DIDs, Connections, Credentials, Proofs) | `module.ts` |
| `network.ts` | bcovrin test network genesis transactions, pool config export | `network.ts` |
| `types.ts` | Shared TypeScript types for invitations, connections, proof requests | `types.ts` |
| `DocumentService` | Static service class wrapping document storage, verification, credential attribute creation | `src/services/document-service.ts` |
| `documentStorage` | Prisma-based MongoDB ops: store, get, verify, list documents with JWT signing | `src/lib/document-storage.ts` |
| `database.ts` | PrismaClient singleton, connect/disconnect helpers | `src/lib/database.ts` |
| `document-routes.ts` | Express route handlers: upload, issue-credential, verify, share, access, download | `src/routes/document-routes.ts` |

## Pattern Overview

**Overall:** Monolithic single-process server with conditional agent-type branching.

Each server instance runs one of three agent roles (`--issuer`, `--doctor`, `--pharmacist`) determined by CLI argument. Routes are conditionally registered based on agent type, using inline `if (agentType === "--issuer")` blocks rather than a routing abstraction.

**Key Characteristics:**
- Single entry point (`server.ts`) dispatches role-specific behavior via `process.argv[2]`
- `BaseAgent` class encapsulates all Credo framework operations behind a facade
- Credo modules configured declaratively in `module.ts` with auto-accept settings
- Proof-verification status uses an in-memory cache (`proofStatusCache` object) — not persisted
- Document storage uses Prisma ORM over MongoDB with JWT-based digital signatures
- Fallback patterns: W3C credentials via basic messages when AnonCreds issuance fails

## Layers

**HTTP API Layer:**
- Purpose: Expose REST endpoints for connection management, credential issuance, proof verification, document operations
- Location: `server.ts`, `src/routes/document-routes.ts`
- Contains: Express route handlers, middleware (cors, multer), request validation
- Depends on: `BaseAgent`, `DocumentService`, `initDatabase`
- Used by: External clients (mobile wallet, web interface)

**Agent Layer:**
- Purpose: Wrap all Credo agent operations into a single class with public methods
- Location: `agent.ts`
- Contains: Agent init, DID import/create, invitation create/accept, connections, schema/cred-def management, credential issuance (AnonCreds + W3C fallback), proof requests, basic messaging, event listeners
- Depends on: `@credo-ts/core`, `@credo-ts/node`, `@credo-ts/anoncreds`, `@credo-ts/askar`, `@credo-ts/indy-vdr`, `module.ts`
- Used by: `server.ts`

**Module Configuration Layer:**
- Purpose: Assemble Credo modules with specific configuration
- Location: `module.ts`
- Contains: Module instantiation with auto-accept settings, IndyVdr pool config
- Depends on: `@hyperledger/anoncreds-nodejs`, `@hyperledger/aries-askar-nodejs`, `@hyperledger/indy-vdr-nodejs`, `network.ts`
- Used by: `BaseAgent` constructor

**Storage Layer:**
- Purpose: Document persistence and verification
- Location: `src/lib/`, `src/services/`, `prisma/`
- Contains: Prisma schema (MongoDB), PrismaClient singleton, document CRUD with JWT signing/verification, SHA-256 hashing
- Depends on: `@prisma/client`, `jsonwebtoken`, `mongodb`
- Used by: `src/routes/document-routes.ts`, `server.ts`

## Data Flow

### Primary Request Path — Credential Issuance

1. Client POSTs to `/issue-credential` with `connectionId` + attributes (`server.ts:380`)
2. Express handler validates required fields (`server.ts:391-411`)
3. Calls `agent.issueAnonCredsCredential(connectionId, credDefId, attributes)` (`server.ts:461`)
4. `BaseAgent.issueAnonCredsCredential()` calls `agent.credentials.offerCredential()` with AnonCreds format (`agent.ts:409`)
5. If AnonCreds fails, falls back to `agent.offerW3cCredential()` using basic message (`server.ts:479-516`)
6. Response returned with credential exchange ID and state (`server.ts:468-473`)

### Proof Verification Flow

1. Client POSTs to `/send-proof-request` with `connectionId` (`server.ts:1374`)
2. Handler selects attributes/predicates based on `agentType` (`server.ts:1380-1451`)
3. Calls `agent.sendProofRequest()` → `agent.proofs.requestProof()` (`agent.ts:500`)
4. Agent event listener updates `proofStatusCache` on state change (`server.ts:147-170`)
5. Client polls `/proof-status/:proofRecordId` to check verification (`server.ts:1658`)
6. On GET `/proof-data/:proofRecordId`, checks cache then agent (`server.ts:1597`)

### Document Upload + Credential Issuance

1. Client POSTs to `/medical-document/upload` with file + `patientDid` (`document-routes.ts:257`)
2. Multer parses multipart, `DocumentService.storeDocument()` stores in MongoDB (`document-routes.ts:275`)
3. `storeDocument()` SHA-256 hashes content, signs with JWT, stores in Prisma (`document-storage.ts:33-93`)
4. Finds connection with patient by `theirDid` (`document-routes.ts:283-294`)
5. Issues AnonCreds credential (or falls back to structured message) (`document-routes.ts:301-401`)

**State Management:**
- `proofStatusCache` — in-memory object (not persisted, lost on restart)
- `credentialDefinitionId` — module-level variable set during agent init
- PrismaClient singleton — module-level in `database.ts`
- `SIGNING_SECRET` — from `process.env.DOCUMENT_SIGNING_SECRET` with hardcoded default

## Key Abstractions

**BaseAgent:**
- Purpose: Single unified interface to Credo agent operations
- Files: `agent.ts`
- Pattern: Facade pattern — wraps Agent, DidsModule, ConnectionsModule, CredentialsModule, ProofsModule, BasicMessagesModule
- Public methods: `init()`, `createInvitation()`, `acceptInvitation()`, `getConnections()`, `createSchema()`, `createCredentialDefinition()`, `issueAnonCredsCredential()`, `offerW3cCredential()`, `sendProofRequest()`, `getProofRecords()`, `getProofData()`, `sendMessage()`, `importDid()`, `registerProofStateListener()`

**DocumentService:**
- Purpose: Static service layer between storage and routes
- Files: `src/services/document-service.ts`
- Pattern: Static utility class with methods that delegate to `document-storage.ts` functions
- Methods: `storeDocument()`, `getDocumentMetadata()`, `getDocument()`, `verifyDocument()`, `createDocumentCredentialAttributes()`

## Entry Points

**Server Entry:**
- Location: `server.ts:1796`
- Triggers: `npx ts-node server.ts --issuer|--doctor|--pharmacist`
- Responsibilities: Parse CLI args, set up Express, configure agent env vars, initialize agent, register routes, listen on port

**Agent Initialization:**
- Location: `server.ts:136` (`initializeAgent()`)
- Responsibilities: Connect MongoDB, init Credo agent, register event listeners, import DID, create schema+cred-def (issuer/doctor), register role-specific routes, register document routes

**Module Assembly:**
- Location: `module.ts:11` (`baseAgentModule()`)
- Responsibilities: Configure and return all Credo modules with auto-accept settings

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. All async operations use `async/await`.
- **Global state:** `proofStatusCache` (in-memory object in `server.ts:87`), `credentialDefinitionId` (module-level string `server.ts:118`), PrismaClient singleton (module-level in `database.ts:7`)
- **Circular imports:** Not detected — import DAG is linear: `types.ts` → `network.ts` → `module.ts` → `agent.ts` → `server.ts` and `document-storage.ts` → `document-service.ts` → `document-routes.ts`
- **Role isolation:** Each agent process is a separate Node.js process; no shared state between agents (except MongoDB database)
- **TypeScript strictness:** `noImplicitAny: true`, `strictNullChecks: true` enabled
- **Module resolution:** `NodeNext` with `ES2020` target
- **No dependency injection:** `BaseAgent` is instantiated directly; `DocumentService` uses static methods; dependencies passed as function parameters (routes receive `app, agent, agentDid, credentialDefinitionId, upload`)

## Anti-Patterns

### Monolithic server.ts

**What happens:** `server.ts` is 1799 lines containing agent initialization, all route handlers (issuer, doctor, pharmacist, common), proof cache management, and startup logic in a single file. Route setup functions (`setupIssuerRoutes`, `setupDoctorRoutes`, `setupPharmacistRoutes`) are nested closures.
**Why it's wrong:** Single file obscures responsibility boundaries; all routes share the same scope; hard to test in isolation; the agentType branching throughout creates implicit coupling.
**Do this instead:** Extract route groups into separate files (e.g., `src/routes/issuer-routes.ts`, `src/routes/doctor-routes.ts`, `src/routes/pharmacist-routes.ts`, `src/routes/common-routes.ts`) following the pattern already established by `src/routes/document-routes.ts`.

### In-memory proof status cache

**What happens:** `proofStatusCache` is a plain object in `server.ts:87` storing verification state. Lost on server restart.
**Why it's wrong:** If the server crashes or restarts, all in-progress verification states are lost. There is no persistence or recovery mechanism.
**Do this instead:** Persist proof state to MongoDB via Prisma, or rely on Credo agent's built-in record storage.

### Hardcoded credential definition ID fallback

**What happens:** When agent initialization fails, `credentialDefinitionId` becomes `"dummy-credential-definition-id-for-*"` and routes continue to operate (`server.ts:327-333`).
**Why it's wrong:** Routes check for `startsWith("dummy-")` to trigger fallback behavior — a fragile string-matching pattern that couples error handling to route logic.
**Do this instead:** Use a proper `Option<string>` type (null when unavailable) or a status enum.

## Error Handling

**Strategy:** Try-catch blocks in each route handler, returning `500 { error: error.message }`. Agent initialization has nested try-catch with fallback behavior. Document storage functions throw on error.

**Patterns:**
- Route handlers: `try { ... } catch (error) { res.status(500).send({ error: error.message }) }`
- Agent initialization: try-catch with console.error logging, sets fallback `credentialDefinitionId`
- Credential issuance: AnonCreds path in try-catch, W3C fallback in nested try-catch
- Document verification: Returns `{ verified: boolean, reason?: string }` rather than throwing

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` throughout — no structured logging library. Agent-type emoji prefixes (🏥, ✅, ❌, ⚠️) used for visual distinction in logs.

**Validation:** Inline validation in route handlers with early returns and 400 status. No schema-based validation library (Joi, Zod, etc.).

**Authentication:** No authentication middleware. Routes are open. JWT is used only for document signing (`jsonwebtoken`), not for API authentication.

---

*Architecture analysis: 2026-05-23*
