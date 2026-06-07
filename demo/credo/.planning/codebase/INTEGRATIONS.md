# External Integrations

**Analysis Date:** 2026-05-23

## APIs & External Services

**Indy Ledger (BCovrin Test Net):**
- Public permissioned ledger for DID registration, schema publishing, credential definition publishing
- Network: `bcovrin:test` — Indy namespace configured in `network.ts`
- Genesis transactions: Hardcoded 4-node pool config for BCovrin Test Net in `network.ts:2-5`
- Pool connection: `IndyVdrModule` in `module.ts:20-23`, connects on startup
- Usage: DID registration (`agent.dids.import`), schema registration (`anoncreds.registerSchema`), credential definition registration (`anoncreds.registerCredentialDefinition`)
- Client: `@hyperledger/indy-vdr-nodejs` 0.2.2 via `@credo-ts/indy-vdr` 0.5.13
- Available custom ledger option: Commented-out example in `network.ts:15-23`

## Data Storage

**Databases:**
- **MongoDB** (primary document store)
  - Connection: `DATABASE_URL` env var via Prisma
  - ORM: `@prisma/client` 5.10
  - Schema: `prisma/schema.prisma` — single `Document` model with fields: `documentId`, `patientDid`, `content` (binary), `fileName`, `mimeType`, `sha256`, `docType`, `issuedBy`, `signature`
  - Client singleton: `src/lib/database.ts` — lazy-initialized `PrismaClient` with `$connect` on init
  - Accessed by: `src/lib/document-storage.ts` (CRUD operations), `src/services/document-service.ts` (service layer), `src/routes/document-routes.ts` (API routes)
  - Operations: Store documents with SHA-256 hash + JWT signature, retrieve metadata/content, verify integrity, list by patient DID
  - Prisma db push used for schema deployment (`setup-db.sh`)

**File Storage:**
- MongoDB itself (binary content stored in `Document.content` field as `Bytes` type)
- No external file storage (S3, IPFS) — IPFS is mentioned in README but NOT implemented in code; the `cid` field in `DocumentService` is set to empty string `""`

**Caching:**
- In-memory only: `proofStatusCache` in `server.ts:77-87` — simple object map keyed by proof record ID
- Cache holds state, verification flag, timestamp, connectionId
- Cleared via `POST /clear-proof-cache` endpoint

## Authentication & Identity

**Auth Provider:**
- **Decentralized Identity (DIDs)** — Self-Sovereign Identity model
  - DID Method: Indy (on BCovrin Test Net)
  - Key Type: Ed25519 (used in `agent.ts:225` for DID import)
  - DID import: `agent.dids.import()` with seed-based private key
  - DID creation fallback: `agent.dids.create()` with method `"key"` for development

**Credential Formats:**
- **AnonCreds** (primary) — v2 protocol, attribute-based credentials with predicates
  - Schema registration: `agent.createSchema()` via `anoncreds.registerSchema`
  - Credential definition: `agent.createCredentialDefinition()` with `supportRevocation: false`
  - Credential issuance: `agent.credentials.offerCredential()` with AnonCreds format
  - Proof requests: `agent.proofs.requestProof()` with requested attributes/predicates
- **W3C Verifiable Credentials** (fallback) — Basic message format in `agent.ts:428-463`
  - Used as fallback when AnonCreds issuance fails
  - Sent as formatted text message via `sendMessage()`

**Agent Roles:**
- **Issuer (Government)** — Creates patient identity credential schema/cred-def, issues identity credentials
- **Doctor** — Creates medical document schema/cred-def, issues medical credentials
- **Pharmacist** — Verifier only, requests and verifies proofs

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, DataDog, or similar detected)
- Errors logged to console via `console.error`

**Logs:**
- `console.log` / `console.error` throughout all files
- Structured logging: Agent events emit to console for connection state, credential state, proof state, and basic messages
- Agent event listeners registered in `agent.ts:78-191` for `ConnectionStateChanged`, `ProofStateChanged`, `CredentialStateChanged`, `BasicMessageStateChanged`

## CI/CD & Deployment

**Hosting:**
- No deployment target configured
- No Dockerfile, container config, or cloud deployment config detected
- Local execution only; ngrok used for public exposure during demo

**CI Pipeline:**
- None detected

## Environment Configuration

**Required env vars:**
- `ISSUER_DID`, `DOCTOR_DID`, `PHARMACIST_DID` — Agent DIDs
- `ISSUER_SEED`, `DOCTOR_SEED`, `PHARMACIST_SEED` — DID seeds
- `ISSUER_AGENT_PUBLIC_ENDPOINT`, `DOCTOR_AGENT_PUBLIC_ENDPOINT`, `PHARMACIST_AGENT_PUBLIC_ENDPOINT` — ngrok/public URLs
- `DATABASE_URL` — MongoDB connection string
- `DOCUMENT_SIGNING_SECRET` — JWT secret for document signing

**Optional env vars:**
- `ISSUER_API_PORT`, `DOCTOR_API_PORT`, `PHARMACIST_API_PORT` — API ports (defaults: 4000/4002/4004)
- `ISSUER_AGENT_LABEL`, `DOCTOR_AGENT_LABEL`, `PHARMACIST_AGENT_LABEL` — Agent display labels
- `NODE_ENV` — Set to `development` to bypass DID import errors
- `ISSUER_CRED_DEF_ID`, `DOCTOR_MEDICAL_CRED_DEF_ID`, `GOVERNMENT_MEDICAL_CRED_DEF_ID` — Cross-agent credential definition sharing

**Secrets location:**
- `.env` file (exists but not read for contents) — contains environment configuration
- Important: `DOCUMENT_SIGNING_SECRET` has a hardcoded fallback `'default-secret-key-change-in-production'` in `src/lib/document-storage.ts:9`

## Webhooks & Callbacks

**Incoming:**
- None detected (no webhook endpoints exposed)

**Outgoing:**
- None detected (no outbound webhook registration)

## Network Topology

**Agent Communication:**
- DIDComm v2 protocol over HTTP/WebSocket
- Inbound: `HttpInboundTransport` on agent port (API port + 1)
- Outbound: `HttpOutboundTransport` + `WsOutboundTransport` registered in `agent.ts:69-70`
- Connection handshake protocol: `HandshakeProtocol.Connections` (`agent.ts:285`)
- Agent endpoints exposed via ngrok tunnels during demo (ports 4001, 4002, 4003, 4005 per README)

**Ports:**
| Role | API Port | Agent Port |
|------|----------|------------|
| Issuer (Government) | 4000 | 4001 |
| Doctor | 4002 | 4003 |
| Pharmacist | 4004 | 4005 |

---

*Integration audit: 2026-05-23*
