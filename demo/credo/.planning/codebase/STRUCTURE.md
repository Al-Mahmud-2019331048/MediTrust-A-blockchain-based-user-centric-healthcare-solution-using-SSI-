# Codebase Structure

**Analysis Date:** 2026-05-23

## Directory Layout

```
demo/credo/
├── agent.ts                  # BaseAgent class — Credo operations facade
├── module.ts                 # Credo module composition & configuration
├── network.ts                # bcovrin test network genesis config
├── server.ts                 # Entry point — Express app + route setup
├── types.ts                  # Shared TypeScript types
├── package.json              # Dependencies, scripts (issuer/doctor/pharmacist/verifier)
├── tsconfig.json             # TypeScript config — ES2020, NodeNext
├── yarn.lock                 # Yarn lockfile
├── package-lock.json         # npm lockfile (present alongside yarn.lock)
├── README.md                 # Documentation
├── setup-db.sh               # MongoDB + Prisma setup script
├── .env                      # Environment config (EXISTS — contains env vars)
├── .yarn/                    # Yarn cache
│   └── install-state.gz
├── prisma/
│   └── schema.prisma         # Prisma schema — MongoDB data source, Document model
├── src/
│   ├── lib/
│   │   ├── database.ts       # PrismaClient singleton, connect/disconnect
│   │   └── document-storage.ts # MongoDB CRUD with JWT signing + SHA-256 verification
│   ├── routes/
│   │   └── document-routes.ts  # Express handlers: upload, verify, share, download
│   └── services/
│       └── document-service.ts  # Static service layer wrapping document-storage
```

## Directory Purposes

**Root (`demo/credo/`):**
- Purpose: Application entry point and core agent logic
- Contains: TypeScript source files, configuration, prisma schema
- Key files:
  - `server.ts`: Main entry — Express server, route registration, agent lifecycle
  - `agent.ts`: BaseAgent facade over Credo framework
  - `module.ts`: Credo module assembly
  - `network.ts`: Indy ledger network configuration
  - `types.ts`: Shared type definitions
  - `package.json`: Dependencies, npm scripts for each agent type
  - `tsconfig.json`: TypeScript compiler config

**`prisma/`:**
- Purpose: Database schema and ORM configuration
- Contains: Single Prisma schema file
- Key files: `schema.prisma` — Document model with UUID, patientDid, content (Bytes), SHA-256 hash, JWT signature, timestamps. MongoDB datasource via `DATABASE_URL` env var.

**`src/lib/`:**
- Purpose: Core library utilities — database connection, document storage
- Contains: Database client singleton, document persistence with cryptographic verification
- Key files:
  - `database.ts`: PrismaClient singleton, `initDatabase()`, `disconnectDatabase()`
  - `document-storage.ts`: `storeDocument()`, `getDocument()`, `getDocumentMetadata()`, `verifyDocument()`, `listPatientDocuments()` — all using SHA-256 hashing + JWT signing

**`src/services/`:**
- Purpose: Business logic layer between HTTP routes and storage library
- Contains: `DocumentService` static class — delegates to `document-storage.ts`, converts between metadata formats, creates credential attributes
- Key files: `document-service.ts`

**`src/routes/`:**
- Purpose: HTTP route handlers for document operations
- Contains: Express route setup function `setupDocumentRoutes()`, HTTP helper for outbound requests
- Key files: `document-routes.ts` — 6 endpoints, HTTP POST helper

## Key File Locations

**Entry Points:**
- `server.ts`: Main application entry — invoked via `npx ts-node server.ts --agent-type`

**Configuration:**
- `package.json`: npm scripts, dependencies (Credo 0.5.13, Express 4, Prisma 5)
- `tsconfig.json`: TypeScript config
- `prisma/schema.prisma`: Database schema
- `.env`: Environment variables (contains secrets — do not read)

**Core Logic:**
- `agent.ts`: All Credo agent operations (580 lines)
- `module.ts`: Module composition (55 lines)
- `network.ts`: Network config (24 lines)
- `types.ts`: Shared types (42 lines)

**HTTP Layer:**
- `server.ts` (1799 lines): All route handlers + agent initialization + startup
- `src/routes/document-routes.ts` (627 lines): Document-specific routes

**Storage Layer:**
- `src/lib/database.ts` (36 lines): Prisma singleton
- `src/lib/document-storage.ts` (281 lines): Document CRUD + verification
- `src/services/document-service.ts` (211 lines): Service abstraction

**Testing:**
- Not detected — no test files found (`*.test.*`, `*.spec.*`). The `package.json` test script is `echo \"Error: no test specified\" && exit 1`.

## Naming Conventions

**Files:**
- Source files: kebab-case — `server.ts`, `document-routes.ts`, `document-storage.ts`, `document-service.ts`, `setup-db.sh`
- Configuration: standard — `package.json`, `tsconfig.json`, `schema.prisma`, `yarn.lock`
- Entry modules: descriptive — `agent.ts`, `module.ts`, `network.ts`, `types.ts`

**Functions:**
- Top-level async functions: `camelCase` — `initializeAgent()`, `setupIssuerRoutes()`, `startServer()`, `updateProofStatus()`, `clearProofStatusCache()`
- Public methods: `camelCase` — `agent.init()`, `agent.createInvitation()`, `agent.issueAnonCredsCredential()`
- Static methods: `camelCase` on class — `DocumentService.storeDocument()`, `DocumentService.verifyDocument()`
- Private/internal helpers: `camelCase` — `generateRandomString()`

**Variables:**
- Module-level: `camelCase` — `credentialDefinitionId`, `proofStatusCache`, `agentDid`, `agentSeed`
- Environment variables: `SCREAMING_SNAKE_CASE` — `ISSUER_API_PORT`, `DOCTOR_DID`, `DATABASE_URL`
- Configuration objects: `camelCase` — `schemaTemplate`, `medicalSchemaTemplate`
- Express app: `app`
- Interfaces/Types: `PascalCase` — `CreateInvitationOptions`, `SendProofRequest`, `AttributeElement`, `PredicateProps`

**Directories:**
- All lowercase — `src/lib/`, `src/routes/`, `src/services/`, `prisma/`

## Where to Add New Code

**New Feature (e.g., new agent role):**
- Primary code: Add new `setup<Role>Routes()` function in `server.ts` following the pattern of `setupIssuerRoutes()` / `setupDoctorRoutes()` / `setupPharmacistRoutes()`, OR extract to `src/routes/<role>-routes.ts`
- New agent type: Add npm script in `package.json` (e.g., `"specialist": "npx ts-node server.ts --specialist"`)
- Tests: No test directory exists — create `__tests__/` at root or `src/__tests__/`

**New Module/Component:**
- Implementation: `src/lib/<module>.ts` for library code, `src/services/<service>.ts` for service classes
- Routes: `src/routes/<name>-routes.ts` following document-routes.ts pattern
- Shared types: Add to `types.ts` or create `src/types/` directory for larger projects

**New Credo Module:**
- Module configuration: Add to `module.ts` inside `baseAgentModule()` object
- Agent methods: Add to `BaseAgent` class in `agent.ts`
- Routes: Add handlers in `server.ts` or dedicated route file

**Utilities:**
- Shared helpers: `src/lib/` for utility functions (e.g., database connection, storage operations)
- Pure business logic: `src/services/` for service classes

## Special Directories

**`prisma/`:**
- Purpose: ORM schema and generated client
- Generated: Prisma Client (via `prisma generate`) — `node_modules/.prisma/client/`
- Committed: `schema.prisma` only (generated client is in `.gitignore` via node_modules)

**`src/`:**
- Purpose: All application source code (library, services, routes)
- Generated: No
- Committed: Yes

**`.yarn/`:**
- Purpose: Yarn package cache for offline installs
- Generated: Yes (by yarn install)
- Committed: No (typically in `.gitignore`)

---

*Structure analysis: 2026-05-23*
