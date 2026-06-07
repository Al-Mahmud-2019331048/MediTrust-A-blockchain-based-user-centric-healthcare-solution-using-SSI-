# Testing Patterns

**Analysis Date:** 2026-05-23

## Test Framework

**Status: No test framework installed or configured.**

- No test runner detected — no Jest, Vitest, Mocha, or other test framework in `package.json`
- The `package.json` `"scripts"` section contains only a placeholder:
  ```json
  "test": "echo \"Error: no test specified\" && exit 1"
  ```
- No `jest.config.*`, `vitest.config.*`, or test configuration files exist in the project
- No `*.test.ts`, `*.test.js`, `*.spec.ts`, or `*.spec.js` files found anywhere in the repository

## Test File Organization

**Location:** Not applicable — no test directory or test files exist.

**Expected pattern (by convention):** Based on the project structure, tests would likely be placed either:
- Co-located with source files: `src/lib/database.test.ts` alongside `src/lib/database.ts`
- In a top-level `__tests__/` directory: `__tests__/agent.test.ts`

## What Should Be Tested

Based on the codebase analysis, the following areas are prime candidates for test coverage:

### Unit Tests

| Module | File | Key Functions to Test |
|--------|------|----------------------|
| Document Storage | `src/lib/document-storage.ts` | `storeDocument()`, `getDocument()`, `verifyDocument()`, `listPatientDocuments()` |
| Document Service | `src/services/document-service.ts` | `createDocumentCredentialAttributes()`, `verifyDocument()` |
| Agent Module | `module.ts` | `baseAgentModule()` configuration |
| Network Config | `network.ts` | ledger pool configuration |
| Types | `types.ts` | type definitions (compile-time only) |
| Database | `src/lib/database.ts` | `initDatabase()`, `getPrismaClient()` singleton behavior |

### Integration Tests

| Flow | Key Files | Dependencies |
|------|-----------|--------------|
| Document store → verify | `document-storage.ts`, `document-service.ts` | MongoDB, JWT secret |
| Agent initialization | `agent.ts`, `module.ts` | Credo Agent, Indy ledger |
| Credential issuance | `agent.ts`, `server.ts` | Credo Agent, Indy ledger |
| Proof request flow | `agent.ts`, `server.ts` | Credo Agent, Indy ledger |

### End-to-End Tests

| Scenario | Components |
|----------|------------|
| Issuer creates invitation → patient accepts → credential issued | `agent.ts`, `server.ts` |
| Doctor verifies patient → issues medical credential | `agent.ts`, `server.ts`, `document-routes.ts` |
| Pharmacist verifies prescription credential | `agent.ts`, `server.ts`, `document-routes.ts` |

## Testing Approach Recommendations

**Given the SSI/blockchain nature of this project, the following testing strategy is recommended:**

**Unit tests (fast, no external deps):**
- `DocumentService.createDocumentCredentialAttributes()` — pure function, easy to test
- `document-storage.ts` functions with mocked Prisma client
- `agent.ts` method logic with mocked Credo Agent

**Integration tests (require Mongo):**
- Document CRUD operations against a test MongoDB instance
- `initDatabase()` connection lifecycle

**E2E tests (require full agent stack):**
- Inter-agent communication (requires Indy ledger access)
- Credential issuance and proof verification flows
- These would typically be manual or require a test ledger

## Mocking Strategy

**No mocking framework installed.**

If adding tests, the following would be needed:

- **Prisma client mocking:** The singleton `getPrismaClient()` pattern in `src/lib/database.ts:7-13` will need special handling for mocking — the module-level `prisma` variable must be reset between tests
- **Credo Agent mocking:** `BaseAgent` in `agent.ts` depends on `@credo-ts/core` Agent, `@credo-ts/node` transports — all should be mocked for unit tests
- **JWT verification mocking:** `jsonwebtoken.verify()` in `document-storage.ts:207` needs mocking for testing verification failure paths
- **crypto mocking:** `crypto.randomUUID()`, `crypto.createHash()` used in `agent.ts:58-59`, `document-storage.ts:45-48` — may need mocking for deterministic tests

## Fixtures and Factories

**No test fixtures exist.**

Recommended test fixtures to create:
- Sample `Express.Multer.File` objects for document upload tests
- Sample `DocumentMetadata` objects for credential attribute tests
- Sample DID strings, seed values, schema templates
- Mock connection records for agent method tests

## Coverage

**Requirements:** Not defined — no coverage tool configured.

**Potential coverage tool:** `c8` or `jest --coverage` if Jest is adopted.

## Error Testing Patterns

Current codebase patterns that tests should cover:

**try-catch + rethrow:**
```typescript
// Pattern in document-storage.ts
try {
  // operation
  return result;
} catch (error) {
  console.error("Error ...:", error);
  throw error;
}
```

**Development mode error suppression:**
```typescript
// Pattern in agent.ts importDid()
if (isDevMode) {
  console.warn(`⚠️ Warning: ${message} (continuing in development mode)`);
  return;
}
throw new Error(message);
```

**HTTP validation patterns:**
```typescript
// Pattern in server.ts route handlers
if (!connectionId) {
  return res.status(400).send({ error: "connectionId is required" });
}
```

## Async Testing Patterns

All significant functions are async (return Promises). Testing would require:
- Proper `await` in test assertions
- Timeout handling for agent operations that involve network calls
- Event listener testing for agent event callbacks (e.g., `ProofStateChanged`)

## Current Manual Testing Approach

Based on `package.json` scripts and `README.md`, testing is currently done **manually** by:

1. Running agents: `yarn issuer`, `yarn doctor`, `yarn pharmacist`
2. Using a mobile wallet app (Bifold) for credential interactions
3. API calls via the Express server endpoints
4. Ngrok tunnels for public endpoint exposure between agents

**No automated testing is in place.**

---

*Testing analysis: 2026-05-23*
