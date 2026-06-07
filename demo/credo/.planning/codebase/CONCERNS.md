# Codebase Concerns

**Analysis Date:** 2026-05-23

## Tech Debt

### Monolithic `server.ts` (1799 lines)

- **Issue:** Single file combines agent initialization, all route handlers (issuer/doctor/pharmacist), proof status cache, Express setup, and server bootstrap. No separation of concerns.
- **Files:** `server.ts` (1799 lines)
- **Impact:** Hard to test, navigate, or modify without side effects. Route handlers for three agent types are intertwined with conditionals.
- **Fix approach:** Split into route modules per agent type (`routes/issuer-routes.ts`, `routes/doctor-routes.ts`, `routes/pharmacist-routes.ts`), extract proof cache into `services/proof-cache.ts`, extract config resolution into `config.ts`.

### Excessive `any` Type Usage

- **Issue:** 10+ functions use `any` types instead of proper TypeScript interfaces, defeating type safety.
- **Files:**
  - `src/routes/document-routes.ts:12` — `makeHttpRequest` returns `Promise<any>`
  - `src/routes/document-routes.ts:69,73` — `app: any`, `upload: any`
  - `server.ts:1745` — `const status: any = {...}`
  - `agent.ts:428` — `offerW3cCredential(connectionId: string, credential: any)`
  - `agent.ts:530` — `callback: (proofRecord: any) => void`
  - `agent.ts:543` — `attributes: any[]`
  - `src/services/document-service.ts:140` — `document?: any`
  - `src/lib/document-storage.ts:175` — `document?: any`
- **Impact:** Runtime type errors, no compile-time validation, harder to refactor.
- **Fix approach:** Define proper interfaces for each usage (e.g., `ProofRecord`, `W3cCredentialPayload`, `DocumentVerificationResult`).

### Typo in Method Name

- **Issue:** `getIssuedCredenitalRecords` — missing "e" in "Credential" (should be `getIssuedCredentialRecords`).
- **Files:** `agent.ts:485`, called at `server.ts:559` and `server.ts:969`
- **Impact:** API inconsistency; refactoring would break callers.
- **Fix approach:** Deprecate old name, add correctly-spelled method, migrate callers.

### In-Memory Proof Status Cache — Unbounded Growth

- **Issue:** `proofStatusCache` (`server.ts:87`) is an in-memory object with no size limit, TTL, or eviction policy. Entries accumulate indefinitely.
- **Files:** `server.ts:77-115`
- **Impact:** Memory leak under sustained load. No persistence across restarts.
- **Fix approach:** Add TTL-based eviction (e.g., purge entries older than 5 minutes), cap max entries, or replace with Redis.

### Phantom `--verifier` Agent Type

- **Issue:** `package.json:12` defines `"verifier": "npx ts-node server.ts --verifier"` but `server.ts` has no handler for `--verifier`. It falls through to the `else` branch and uses `process.env.PHARMACIST_API_PORT` as default port.
- **Files:** `package.json:12`, `server.ts:24-28`
- **Impact:** Running `yarn verifier` starts a broken agent defaulting to pharmacist config. Confusing for users.
- **Fix approach:** Add explicit `--verifier` branch or remove from package.json scripts.

### Duplicated Route Setup Logic

- **Issue:** Document route setup (`/medical-document/issue-credential` and `/medical-document/upload`) contains nearly identical blocks for credential issuance vs. structured message fallback, duplicated across both endpoints (~100 lines duplicated).
- **Files:** `src/routes/document-routes.ts:138-233` and `:306-401`
- **Impact:** Bug fixes or changes must be applied to two places. Already observed drift potential.
- **Fix approach:** Extract credential issuance and message fallback into shared service methods.

### Non-null Assertions on Environment Variables

- **Issue:** Heavy use of `!` non-null assertions on `process.env.*` values (`server.ts:50,52,53,57,59,60`). If env vars are missing, this silently produces `undefined` at runtime.
- **Files:** `server.ts:48-60`
- **Impact:** Runtime crashes with opaque error messages when env vars are missing.
- **Fix approach:** Add validation layer that throws descriptive errors on startup for required vars.

## Security Considerations

### Hardcoded Credentials in `.env` (Committed to Git)

- **Risk:** MongoDB connection string contains plaintext username/password (`tahmidkabiraddin:tahmidkabiraddin`). Seed values for DIDs are hardcoded. Committed to version control.
- **Files:** `.env:18,22,25,35,38`
- **Current mitigation:** None. `.env` is tracked in git (not in `.gitignore`).
- **Recommendations:** Add `.env` to `.gitignore`. Rotate exposed credentials. Use environment variable injection or a secrets manager. Remove `.env` from repository history.

### CORS Allows All Origins

- **Risk:** `origin: "*"` (`server.ts:125`) disables CORS protections entirely. Any website can make requests to the agent API.
- **Files:** `server.ts:124-129`
- **Current mitigation:** None.
- **Recommendations:** Restrict to known frontend origins in production. Use per-agent-type origin whitelists.

### Weak Document Signing Secret

- **Risk:** Document signing secret defaults to `'default-secret-key-change-in-production'` if `DOCUMENT_SIGNING_SECRET` is not set. The JWT has a 10-year expiry.
- **Files:** `src/lib/document-storage.ts:9`, `src/lib/document-storage.ts:61`
- **Current mitigation:** None for the default. The `.env` file contains a placeholder value.
- **Recommendations:** Generate a strong random secret. Reject startup if using the default. Reduce JWT expiry from 10 years to a reasonable duration.

### Sensitive Data Leaked in `/agent-status` Response

- **Risk:** `server.ts:1755-1758` returns `ISSUER_DID`, `DOCTOR_DID`, `PHARMACIST_DID`, `DOCTOR_MEDICAL_CRED_DEF_ID` in the response body. These are internal identifiers.
- **Files:** `server.ts:1743-1781`
- **Impact:** Exposes DID seeds and credential definition IDs to any caller.
- **Fix approach:** Remove sensitive env vars from the response, or require authentication to access this endpoint.

### No Authentication or Authorization

- **Risk:** All API endpoints are unauthenticated. Any network actor can create invitations, issue credentials, send messages, and access documents.
- **Files:** All route handlers in `server.ts` and `src/routes/document-routes.ts`
- **Current mitigation:** None.
- **Recommendations:** Add API key auth or session-based auth for production use.

### Doctor and Pharmacist Share the Same DID/Seed

- **Risk:** Both doctor and pharmacist use `Kpd1uvShTi84YLmUGsHsYF` / `SSIVERIFIER000000000000000000000`.
- **Files:** `.env:21-25`
- **Impact:** Agents cannot be distinguished on the ledger. Security boundaries between roles are nonexistent.
- **Fix approach:** Use unique DIDs and seeds for each agent type.

### Verification States Are Wrong

- **Risk:** `verifiedStates` at `server.ts:153-158` and `:1678-1683` includes `"request-received"` and `"presentation-sent"` as verified. These are intermediate protocol states, not proof of verification.
- **Files:** `server.ts:153-158,1678-1683`
- **Impact:** Proofs can be reported as "verified" when the presentation hasn't actually been validated yet.
- **Fix approach:** Only consider `"done"` and `"presentation-received"` as verified states. Remove `"request-received"` and `"presentation-sent"`.

### No HTTPS

- **Risk:** All communications use plain HTTP (`.env:6-8` shows `http://` endpoints).
- **Files:** `.env:6-8`, `server.ts`
- **Impact:** All data including credentials, proofs, and DID seeds transmitted in cleartext.
- **Fix approach:** Use HTTPS in production with valid TLS certificates.

## Known Bugs

### Dev Mode Silently Continues on Critical Failures

- **Symptoms:** When `NODE_ENV=development`, `importDid()` logs a warning and returns without importing when DID is missing or empty. This means the agent runs without a proper DID.
- **Files:** `agent.ts:203-248`
- **Trigger:** Running with `NODE_ENV=development` and missing/invalid DID.
- **Workaround:** None — the bug is the feature. Agents appear healthy but operate without proper identity.

### Fallback "dummy-" Credential Definitions Mask Failures

- **Symptoms:** When doctor or pharmacist agent initialization fails, they set `credentialDefinitionId = "dummy-credential-definition-id-for-doctor"` (or pharmacist variant). Many routes check `startsWith("dummy-")` to decide behavior, silently degrading to unverifiable structured messages.
- **Files:** `server.ts:327,356,800,877,1039`, `src/routes/document-routes.ts:138,306`
- **Trigger:** Doctor/pharmacist startup failure (e.g., schema creation failure, ledger unavailability).
- **Workaround:** Check `/agent-status` endpoint to verify `isInitialized` is `true`.

### Random Schema Versions Cause Conflicts

- **Symptoms:** Schema version includes `Math.floor(Math.random() * 100)` (`server.ts:181,247`). On restart with a different random value, a new schema is created on the ledger instead of reusing the existing one.
- **Files:** `server.ts:181,247`
- **Trigger:** Each agent restart generates a different schema version.
- **Workaround:** Manually set version to a fixed value.

### StructuredMessage Credential Fallback Has No Cryptographic Verification

- **Symptoms:** When AnonCreds issuance fails, the system falls back to sending credential data as a plain text DIDComm basic message (`sendCredentialAsMessage`, `offerW3cCredential`). These messages cannot be cryptographically verified as credentials.
- **Files:** `agent.ts:428-463,469-484`, `server.ts:477-517`, `src/routes/document-routes.ts:192-217,360-385`
- **Trigger:** AnonCreds credential issuance failure.
- **Impact:** Received "credentials" are unverifiable strings, not actual verifiable credentials.

## Performance Bottlenecks

### MongoDB Document Content Stored as Binary — No Streaming

- **Problem:** Document content is stored as `Bytes` (BSON binary) in MongoDB and loaded entirely into memory before serving (`src/lib/document-storage.ts:158`). Large medical files (e.g., radiology images, PDFs) will cause high memory usage.
- **Files:** `prisma/schema.prisma:17`, `src/lib/document-storage.ts:133-164`
- **Cause:** No streaming or chunked reads. Entire document loaded into Node.js buffer.
- **Improvement path:** Use GridFS or a dedicated object store (S3-compatible) for large binary content. Stream responses instead of buffering.

### Schema/Credential Definition Registration on Every Startup

- **Problem:** Every agent startup calls `createSchema()` and `registerCredentialDefinition()`, even if the schema already exists on the ledger. Creation is synchronous and blocks server startup.
- **Files:** `server.ts:173-230` (issuer), `server.ts:244-314` (doctor)
- **Cause:** No caching or existence check before registration attempt.
- **Improvement path:** Check if schema/cred-def already exists before registering. Cache IDs in config or environment.

## Fragile Areas

### Three-Way Agent Type Conditionals

- **Files:** `server.ts:23-60,172-363,1278-1370,1374-1472,1595-1722`
- **Why fragile:** Nearly every function has branching on `agentType === "--issuer" | "--doctor" | "--pharmacist"`. Adding a new agent type requires touching every conditional.
- **Test coverage:** None.
- **Safe modification:** Extract agent-type-specific behavior into strategy pattern or separate server classes per type.

### Proof Verification Logic Duplicated

- **Files:** `server.ts:147-170` (event listener) and `:1678-1683` (HTTP endpoint)
- **Why fragile:** The "verified states" list is defined in two places. If one is updated and not the other, verification status becomes inconsistent.
- **Test coverage:** None.

### Document Routes `app` Parameter Typed as `any`

- **Files:** `src/routes/document-routes.ts:69`
- **Why fragile:** The `app: any` parameter bypasses all Express type safety. Route registration errors surface at runtime, not compile time.
- **Test coverage:** None.

## Missing Critical Features

### No Graceful Shutdown

- **Problem:** No `SIGTERM`/`SIGINT` handlers. Agent connections, wallet, and database are not cleaned up on shutdown.
- **Files:** `server.ts:1796-1798` — only handles uncaught errors via `process.exit(1)`.
- **Blocks:** Clean container orchestration (Kubernetes, Docker Compose). Wallet corruption risk on forced termination.

### No Health Check Endpoint for Readiness

- **Problem:** `/agent-status` (`server.ts:1743`) reports status but is mixed with debug data. No liveness/readiness distinction for orchestration systems.
- **Blocks:** Kubernetes liveness/readiness probes, load balancer health checks.

### No Rate Limiting

- **Problem:** All API endpoints are unprotected against abuse. An attacker can spam `/create-invitation` or `/issue-credential`.
- **Blocks:** Production deployment under load.

## Dependencies at Risk

### Credo Packages Pinned to 0.5.13

- **Risk:** `@credo-ts/*` packages are pinned at `0.5.13` (package.json lines 35-39). Credo is pre-1.0 software with active development. Breaking changes expected.
- **Impact:** Security patches and bug fixes require manual version bumps.
- **Migration plan:** Monitor Credo releases, test upgrades in staging environment before applying.

### `ts-node` in Production Scripts

- **Risk:** All npm scripts use `npx ts-node server.ts` for execution, which runs TypeScript via JIT compilation. No build step.
- **Impact:** Slower startup, potential runtime type errors (ts-node doesn't enforce strict type checking the same way `tsc` does), and no distribution artifact.
- **Fix approach:** Add `tsc` build step and run compiled JavaScript in production scripts.

## Test Coverage Gaps

**Entire codebase has zero tests.** `package.json:7` confirms `"test": "echo \"Error: no test specified\" && exit 1"`.

| Area | What's Not Tested | Files | Risk | Priority |
|------|-------------------|-------|------|----------|
| Agent initialization | DID import, schema creation, cred def creation | `agent.ts` | High | High |
| Credential issuance | AnonCreds issuance, W3C fallback, error paths | `agent.ts`, `server.ts` | High | High |
| Proof verification | State machine, status cache, verification logic | `server.ts` | High | High |
| Document storage | Store, retrieve, verify, hash integrity | `src/lib/document-storage.ts` | High | High |
| Document routes | Upload, issue, verify, share token flow | `src/routes/document-routes.ts` | Medium | Medium |
| Route handlers | All agent-type-specific HTTP endpoints | `server.ts` | High | High |

---

*Concerns audit: 2026-05-23*
