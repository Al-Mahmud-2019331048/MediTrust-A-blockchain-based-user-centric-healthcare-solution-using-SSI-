# Coding Conventions

**Analysis Date:** 2026-05-23

## Language & Runtime

**Language:** TypeScript 5.7.2 (strict mode subset)
**Runtime:** Node.js >=20.0.0
**Module system:** ES modules via `NodeNext` module resolution (`tsconfig.json` line 4-5)
**TypeScript config:** `"allowUnreachableCode": false`, `"noImplicitAny": true`, `"strictNullChecks": true` (`tsconfig.json` lines 12-14)

## Naming Patterns

**Files:**
- `kebab-case.ts` for source files: `document-routes.ts`, `document-service.ts`, `document-storage.ts`, `setup-db.sh`
- PascalCase for class definition files: `BaseAgent` in `agent.ts`, `DocumentService` in `document-service.ts`
- Root-level entry points use flat names: `agent.ts`, `server.ts`, `types.ts`, `module.ts`, `network.ts`

**Classes:**
- PascalCase: `BaseAgent` (`agent.ts:33`), `DocumentService` (`src/services/document-service.ts:29`)
- Generic naming for Prisma client: `PrismaClient` (`src/lib/database.ts:1`)

**Functions/Methods:**
- `camelCase` for all methods and functions: `init()`, `createSchema()`, `getConnections()`, `storeDocument()`, `verifyDocument()`
- Private methods prefixed with underscore? **No** — observed `generateRandomString` is private but not underscored (`agent.ts:570`)
- Helper functions use camelCase: `makeHttpRequest()` (`src/routes/document-routes.ts:12`), `updateProofStatus()` (`server.ts:90`)

**Variables:**
- `camelCase` throughout: `agentType`, `credentialDefinitionId`, `proofStatusCache`
- Constants use `SCREAMING_SNAKE_CASE`: `SIGNING_SECRET` (`src/lib/document-storage.ts:9`), `BCOVRIN_GENESIS` (`network.ts:2`)

**Types/Interfaces:**
- PascalCase: `CreateInvitationOptions` (`types.ts:3`), `SendProofRequest` (`types.ts:20`), `AttributeElement` (`types.ts:28`), `DocumentMetadata` (`src/lib/document-storage.ts:12`), `ProofStatusCache` (`server.ts:77`)
- Enums PascalCase: `DocumentType` with UPPERCASE members: `PRESCRIPTION`, `LAB_REPORT`, `MEDICAL_RECORD` (`src/services/document-service.ts:9-13`)

**Modules (re-exports):**
- Type alias for composed agent module: `AgentModules` (`module.ts:55`)

## Code Style

**Formatting:**
- No Prettier, ESLint, or Biome config detected — no formatting tool configured
- Inconsistent quote style:
  - Single quotes: `src/lib/` and `src/services/` files (`'@prisma/client'`, `'dotenv'`)
  - Double quotes: `src/routes/document-routes.ts` and root `*.ts` files (`"express"`, `"cors"`)
- Semicolons: mostly present, but `server.ts` uses semicolons while root files inconsistently omit them (e.g., `types.ts` lines 3-7 have no semicolons)
- Indentation: 2 spaces in `agent.ts`, `module.ts`, `network.ts`, `types.ts`; 4 spaces in `tsconfig.json` and `src/` files

**Linting:**
- No linter config detected

## Import Organization

**Order observed:**
1. Third-party dependencies (npm packages): `import express from "express"`, `import crypto from "crypto"`
2. Local modules relative to project: `import { BaseAgent } from "./agent"`, `import { agentDependencies } from "@credo-ts/node"`
3. Local modules via relative path: `import { DocumentService } from "../services/document-service"`
4. `dotenv` config call immediately after imports: `dotenv.config()` (`src/lib/database.ts:4`, `src/lib/document-storage.ts:6`)

**Path Aliases:**
- None defined in `tsconfig.json` (`"paths": {}` at line 9)
- All local imports use relative paths: `../../agent`, `../lib/database`, `../services/document-service`

**Type imports:**
- No consistent use of `import type` — type imports mixed with value imports: `import { AnonCredsSchema } from "@credo-ts/anoncreds"` (`agent.ts:1`)
- Some types imported from dedicated `types.ts`: `import { AttributeElement, CreateInvitationOptions, ... } from "./types"` (`agent.ts:27-31`)

## Error Handling

**Pattern: try-catch-log-rethrow**
- All async operations wrapped in try-catch blocks
- Pattern: `try { ... } catch (error) { console.error("...", error); throw error; }`
- `document-storage.ts` functions consistently use this pattern (lines 43-92, 103-126, 136-163, 176-251)
- `document-service.ts` uses identical pattern (lines 39-65, 72-97, 104-131, 139-176)
- `agent.ts` methods use mixed patterns — some rethrow, some just `throw` without wrapping (`agent.ts:306`)

**Error wrapping:**
- Inconsistent: some throw the original error (`throw error`), some wrap in new Error (`throw new Error("message: " + error.message)`)
- `BaseAgent.init()` wraps: `throw new Error(`Error initializing agent: ${e}`)` (`agent.ts:193`)
- `BaseAgent.createInvitation()` rethrows raw: `throw error` (`agent.ts:308`)
- `BaseAgent.acceptInvitation()` rethrows raw: `throw error` (`agent.ts:339`)

**Development mode error softening:**
- `importDid()` method checks `process.env.NODE_ENV === "development"` and logs warnings instead of throwing (`agent.ts:203-210`)
- Used for DID import and seed validation

**HTTP error handling (server.ts):**
- Express route handlers return `res.status(400).send({ error: "..." })` for validation errors
- Express route handlers return `res.status(500).send({ error: error.message })` for catch blocks
- Consistent pattern: validate inputs first, return 400; then try execution, catch 500

## Logging

**Framework:** `console.log()` / `console.error()` / `console.warn()` — no structured logging library

**Patterns:**
- `console.log()` for info/debug messages throughout root and `src/` files
- `console.error()` for catch blocks: `console.error("Error ...:", error)`
- Emoji prefixes in certain contexts: `"✅ ..."`, `"❌ ..."`, `"📋 ..."`, `"🏥 ..."`, `"⚠️ ..."` (`server.ts`, `src/routes/document-routes.ts`)
- Informational logging with template literals: `console.log(\`Connection State Changed: ${previousState} -> ${connectionRecord.state}\`)`
- No log levels (debug/info/warn/error) — all use plain `console`

## Comments

**When to Comment:**
- JSDoc-style comments on exported functions in `src/lib/document-storage.ts`: `/**\n * Store a document in MongoDB with digital signature\n * @param ...\n */` (lines 23-32, 95-101, 128-135, 166-174)
- `src/services/document-service.ts` uses minimal JSDoc: `/**\n * Store a document in MongoDB with digital signature\n */` (lines 31-32)
- Inline comments for debugging/logging explanations: `// Log the effective endpoint being used` (`agent.ts:294`)
- Section comments using emoji markers: `// Import document handling functionality` (`server.ts:8`)
- Legacy/fallback comments: `// No longer using CID since we're not using IPFS` (`src/services/document-service.ts:54`)
- Commented-out code: network.ts lines 16-24

**JSDoc/TSDoc:**
- Used sparsely — only in `document-storage.ts` and minimally in `document-service.ts`
- `agent.ts` methods have no JSDoc except `createNewDid()` and `offerW3cCredential()`
- `server.ts` has no JSDoc — only inline comments for section delineation

## Function Design

**Size:**
- Functions range from 1-line passthroughs (`getSchema` at `agent.ts:366`) to 200+ line route handlers (`setupIssuerRoutes` at `server.ts:376`)
- Route setup functions in `server.ts` are very large: `setupIssuerRoutes` (~397 lines), `setupDoctorRoutes` (~234 lines), `setupPharmacistRoutes` (~263 lines)

**Parameters:**
- Methods taking 2+ related params use object destructuring: `createInvitation({ label, alias, domain })` (`agent.ts:278`)
- Methods taking positional params for strong ordering: `createSchema(did, schema)` (`agent.ts:357`), `issueAnonCredsCredential(connectionId, credentialDefinitionId, attributes)` (`agent.ts:404`)
- Static methods use positional params: `DocumentService.storeDocument(file, patientDid, issuerDid, docType)` (`src/services/document-service.ts:33`)

**Return Values:**
- Async functions return Promises throughout
- `getX()` methods return the agent response directly
- `storeDocument()` returns the created record
- Functions that can fail return `null` for not-found: `getDocumentMetadata()` returns `DocumentMetadata | null`

## Module Design

**Exports:**
- Named exports for functions: `export async function initDatabase()` (`src/lib/database.ts:17`)
- Named exports for classes: `export class DocumentService` (`src/services/document-service.ts:29`)
- Named exports for types: `export type CreateInvitationOptions` (`types.ts:3`)
- Default exports: **not used** anywhere

**Barrel Files:**
- None used — `src/lib/` and `src/services/` have no index.ts
- Consumers import directly from specific files

**Module pattern in agent.ts:**
- Single class `BaseAgent` contains all agent operations as public methods
- Constructor takes config object, initializes Agent, registers transports
- Agent module configuration separated into `module.ts` with factory function `baseAgentModule()`

## TypeScript Usage

**Type annotations:**
- Explicit return types on public methods: `public async init(): Promise<void>` (implied)
- No `any` used except where unavoidable: `credential: any` (`agent.ts:428`), proof `callback(proofRecord: any)` (`agent.ts:533`)
- Interface for request body shapes defined inline: `ProofStatusCache` (`server.ts:77`)
- `satisfies` keyword used: `satisfies InitConfig` (`agent.ts:61`), `satisfies IndyVdrPoolConfig` (`network.ts:13`)
- `as const` used on module definition: `module.ts:52`

## Dependency Injection

**Pattern:** Manual constructor injection
- `BaseAgent` receives config via constructor object (`agent.ts:41-49`)
- `setupDocumentRoutes()` receives `app`, `agent`, `agentDid`, `credentialDefinitionId`, `upload` as parameters (`src/routes/document-routes.ts:68-74`)
- No DI container or inversion-of-control pattern

## File Organization

**Directory structure:**
```
credo/
├── agent.ts              # Core agent class
├── module.ts             # Agent module composition
├── network.ts            # Ledger network config
├── server.ts             # Express server + routes
├── types.ts              # Shared type definitions
└── src/
    ├── lib/              # Low-level utilities (database, document storage)
    │   ├── database.ts
    │   └── document-storage.ts
    ├── routes/           # Express route handlers
    │   └── document-routes.ts
    └── services/         # Business logic layer
        └── document-service.ts
```

**Route organization:**
- Routes defined inline in `server.ts` as anonymous functions within `setupIssuerRoutes()`, `setupDoctorRoutes()`, `setupPharmacistRoutes()`
- Document-related routes separated into `src/routes/document-routes.ts` with `setupDocumentRoutes()` export

---

*Convention analysis: 2026-05-23*
