# External Integrations

**Analysis Date:** 2026-05-23

## APIs & External Services

**SSI/Verifiable Credential Protocol:**
- **Credo TS (Aries Framework JavaScript) 0.5.13** - Core SSI agent framework
  - Purpose: DID management, connection establishment (DIDComm), credential issuance/verification, proof requests, secure messaging
  - Agent types: Issuer (Government), Doctor, Pharmacist
  - Modules used: AnonCreds, Askar wallet, Indy VDR, Connections, Credentials, Proofs, DIDs, Basic Messages
  - All agent-agent communication happens through DIDComm protocols over HTTP/WSS outbound transports
  - Imports: `@credo-ts/core`, `@credo-ts/anoncreds`, `@credo-ts/askar`, `@credo-ts/indy-vdr`, `@credo-ts/node`

- **Hyperledger AnonCreds** - Anonymous credential format
  - Purpose: Issue and verify zero-knowledge proofs using the AnonCreds standard
  - SDK/Client: `@hyperledger/anoncreds-nodejs` 0.2.2 (native Node.js bindings)
  - Implementation: `demo/credo/agent.ts` and `demo/credo/module.ts`

- **Hyperledger Aries Askar** - Secure storage and wallet
  - Purpose: Encrypted wallet storage for DIDs, keys, and credentials
  - SDK/Client: `@hyperledger/aries-askar-nodejs` 0.2.3
  - Config: `AskarMultiWalletDatabaseScheme.ProfilePerWallet` in `demo/credo/module.ts`

- **Hyperledger Indy VDR** - Indy ledger interaction
  - Purpose: Submit and read from Indy blockchain (schemas, credential definitions, DIDs)
  - SDK/Client: `@hyperledger/indy-vdr-nodejs` 0.2.2
  - Ledger network: `bcovrin:test` (BCovrin TestNet)

## Data Storage

**Databases:**
- **MongoDB** - Document storage for medical documents
  - Connection: `DATABASE_URL` env var (connection string in `demo/credo/.env`)
  - Client: `@prisma/client` 5.10.0 (Prisma ORM with MongoDB adapter)
  - Prisma provider: `mongodb` in `demo/credo/prisma/schema.prisma`
  - Model: `Document` — stores documentId, patientDid, content (Buffer), fileName, mimeType, sha256, docType, issuedBy, issuedAt, signature
  - Queries: CRUD operations in `demo/credo/src/lib/document-storage.ts`
  - Index: `patientDid` field indexed for lookup performance

- **Askar Wallet** (local encrypted storage)
  - Purpose: Store agent DIDs, cryptographic keys, connection records, credential records
  - Encrypted with auto-generated random key (`crypto.randomBytes(32)` in `demo/credo/agent.ts`)
  - Wallet ID: Generated per agent instance (`wallet-{label}-{uuid}`)

**File Storage:**
- **MongoDB GridFS-compatible** (via Prisma Bytes field) - Medical document content stored directly as binary in MongoDB documents
  - Documents uploaded via `multer` (in-memory buffer) → stored to MongoDB as `Bytes`
  - Digital signatures applied via JWT (`jsonwebtoken` 9.0.2)
  - SHA-256 hashing for integrity verification (`crypto.createHash('sha256')`)
  - No IPFS/CID usage despite mentions in comments/README (code migrated away from IPFS)

**Caching:**
- **In-memory (Node.js)** - Proof verification status cache
  - Location: `demo/credo/server.ts` — `proofStatusCache` object (lines 87–114)
  - Purpose: Track proof state transitions (done, presentation-received, etc.)
  - Data: proof record ID → { state, isVerified, timestamp, connectionId }
  - No TTL/expiry; cleared explicitly via `/clear-proof-cache` endpoint

## Authentication & Identity

**SSI/DID-based Identity:**
- **DID Method**: `did:indy:bcovrin:test` — Indy DIDs on BCovrin TestNet
- **Wallet Import**: DIDs imported from seeds (`ISSUER_SEED`, `DOCTOR_SEED`, `PHARMACIST_SEED`)
- **Key Type**: `KeyType.Ed25519` for DID key pairs
- **Credential Format**: AnonCreds (Hyperledger AnonCreds standard v1)
- **Proof Format**: AnonCreds zero-knowledge proofs with selective disclosure and predicate support
- **Connection Protocol**: DIDComm Connections 1.0 handshake (`HandshakeProtocol.Connections`)

**No external auth providers** — all identity is SSI-native, no OAuth/OIDC, no social login.

**Document-level Auth:**
- JWT-based document signing using `jsonwebtoken` 9.0.2
  - Secret: `DOCUMENT_SIGNING_SECRET` env var
  - Payload includes: documentId, patientDid, sha256, docType, issuedBy, issuedAt
  - Token expiry: 10 years
  - Implementation: `demo/credo/src/lib/document-storage.ts`

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, Datadog, or similar service

**Logs:**
- `console.log` / `console.error` throughout all backend files
- Server-side only; no structured logging library
- Debug endpoints available: `GET /debug-agent`, `GET /debug-credential-definitions`, `GET /debug-medical-credential-definitions`

## CI/CD & Deployment

**Hosting:**
- Local development only — no production deployment configuration
- Agents exposed via **ngrok** tunnels for mobile wallet connectivity
- Frontend runs on Next.js dev server

**CI Pipeline:**
- None detected

**Source Control:**
- GitHub repository: `CrypticConsultancyLimited/ssi-tutorial` (branch `credo-acapy` per README)

## Environment Configuration

**Required env vars (in `demo/credo/.env`):**
| Variable | Purpose |
|---|---|
| `ISSUER_API_PORT` | Government agent HTTP port |
| `DOCTOR_API_PORT` | Doctor agent HTTP port |
| `PHARMACIST_API_PORT` | Pharmacist agent HTTP port |
| `ISSUER_AGENT_PUBLIC_ENDPOINT` | Government ngrok/public URL |
| `DOCTOR_AGENT_PUBLIC_ENDPOINT` | Doctor ngrok/public URL |
| `PHARMACIST_AGENT_PUBLIC_ENDPOINT` | Pharmacist ngrok/public URL |
| `ISSUER_DID` | Government agent's Indy DID |
| `ISSUER_SEED` | Government DID seed phrase |
| `DOCTOR_DID` | Doctor agent's Indy DID |
| `DOCTOR_SEED` | Doctor DID seed phrase |
| `PHARMACIST_DID` | Pharmacist agent's Indy DID |
| `PHARMACIST_SEED` | Pharmacist DID seed phrase |
| `DATABASE_URL` | MongoDB connection string (Prisma) |
| `DOCUMENT_SIGNING_SECRET` | JWT signing secret for documents |
| `NODE_ENV` | Environment mode (development) |
| `ISSUER_CRED_DEF_ID` | Government credential definition ID |
| `GOVERNMENT_MEDICAL_CRED_DEF_ID` | Medical document credential def ID |

**Required env vars (in `interface/.env.sample`):**
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (default: `http://localhost:4002`) |
| `ISSUER_CRED_DEF_ID` | Credential definition ID for identity credentials |

**Secrets location:**
- `demo/credo/.env` — Contains Docker secrets (DB connection string) and credentials
- `interface/.env.sample` — Template only, no secrets
- **Note:** `.env` file at `demo/credo/.env` is committed to git (not in `.gitignore`) which is a security concern

## Webhooks & Callbacks

**Incoming:**
- None — agent communication uses DIDComm protocols, not webhooks

**Outgoing:**
- None — no outbound webhooks configured

**Event Listeners (internal):**
- `ConnectionStateChanged` — Logs and processes connection state transitions (`demo/credo/agent.ts`)
- `ProofStateChanged` — Updates in-memory proof status cache (`demo/credo/server.ts`)
- `CredentialStateChanged` — Logs credential state changes (`demo/credo/agent.ts`)
- `BasicMessageStateChanged` — Logs received messages (`demo/credo/agent.ts`)

## External Blockchains / Ledgers

**BCovrin TestNet:**
- Public Indy ledger test network
- Genesis transactions hardcoded in `demo/credo/network.ts`
- 4 validator nodes (Node1–Node4)
- Namespace: `bcovrin:test`
- Used for: Registering schemas, credential definitions; resolving DIDs
- Connection mode: `connectOnStartup: true`

**Bifold Wallet (Mobile):**
- Aries Framework React Native-based mobile wallet for holders
- Used to scan QR codes, accept credentials, share proofs
- Downloaded separately (APK link in `demo/credo/README.md`)

---

*Integration audit: 2026-05-23*
