# Technology Stack

**Analysis Date:** 2026-05-23

## Languages

**Primary:**
- TypeScript 5.7 - All source files (`agent.ts`, `server.ts`, `module.ts`, `network.ts`, `types.ts`, all files under `src/`)

**Secondary:**
- JavaScript - Build tooling (Prisma client generation, ts-node execution)

## Runtime

**Environment:**
- Node.js >=20.0.0 (enforced via `package.json` `engines` field)

**Package Manager:**
- npm (primary — `package-lock.json` present)
- Yarn (secondary — `yarn.lock` also present, README references `yarn install`)
- Lockfile: both `package-lock.json` and `yarn.lock` present

## Frameworks

**SSI / Verifiable Credentials (core framework):**
- Credo 0.5.13 (formerly Aries Framework JavaScript) — Decentralized identity agent framework
  - `@credo-ts/core` 0.5.13 — Core agent, DID comm, transports
  - `@credo-ts/anoncreds` 0.5.13 — AnonCreds credential format
  - `@credo-ts/askar` 0.5.13 — Secure wallet storage (Aries Askar)
  - `@credo-ts/indy-vdr` 0.5.13 — Indy ledger interaction
  - `@credo-ts/node` 0.5.13 — Node.js dependencies & transports

**Web Server:**
- Express 4.21 — HTTP API server (runs on ports 4000-4005 depending on agent role)
  - `cors` 2.8.5 — Cross-origin support
  - `multer` 1.4.5-lts.2 — File upload handling
  - `dotenv` 16.4.7 — Environment variable loading

**Database ORM:**
- Prisma 5.10 (client + CLI) — MongoDB ORM for document storage

**Hyperledger Native Bindings:**
- `@hyperledger/anoncreds-nodejs` 0.2.2 — Native AnonCreds crypto
- `@hyperledger/aries-askar-nodejs` 0.2.3 — Native secure storage
- `@hyperledger/indy-vdr-nodejs` 0.2.2 — Native Indy ledger client

**Testing:**
- Not detected (no test runner configured; `package.json` test script: `echo "Error: no test specified" && exit 1`)

**Build/Dev:**
- `ts-node` 10.9.2 — TypeScript execution without build step
- `typescript` 5.7.2 — TypeScript compiler
- `node-fetch` 3.3.2 — HTTP client (ESM)

## Key Dependencies

**Critical:**
- `@credo-ts/core` — Agent initialization, DID communication, connection management, credential issuance/verification
- `@credo-ts/anoncreds` — AnonCreds credential format protocol (v2), proof format service
- `@credo-ts/askar` + `aries-askar-nodejs` — Wallet key management (`AskarMultiWalletDatabaseScheme.ProfilePerWallet`)
- `@credo-ts/indy-vdr` + `indy-vdr-nodejs` — Indy ledger pool connection (BCovrin Test Net)
- `express` — HTTP REST API for agent interactions

**Infrastructure:**
- `@prisma/client` / `prisma` — MongoDB document schema management
- `jsonwebtoken` — Document signing and verification (JWT-based signatures)
- `cors` — API CORS configuration (allows `*` origin)
- `multer` — Medical document file upload (memory storage)
- `dotenv` — Environment configuration loading

## Configuration

**Environment:**
- `.env` file present — contains environment configuration (not read)
- `dotenv.config()` called at `server.ts:12` and `src/lib/database.ts:4` and `src/lib/document-storage.ts:6`

**Environment variables used (all via `process.env`):**

| Variable | Purpose | Default |
|----------|---------|---------|
| `ISSUER_API_PORT` | Issuer HTTP API port | 4000 |
| `DOCTOR_API_PORT` | Doctor HTTP API port | 4002 |
| `PHARMACIST_API_PORT` | Pharmacist HTTP API port | 4004 |
| `ISSUER_AGENT_PUBLIC_ENDPOINT` | Issuer agent public URL (ngrok) | — |
| `DOCTOR_AGENT_PUBLIC_ENDPOINT` | Doctor agent public URL (ngrok) | — |
| `PHARMACIST_AGENT_PUBLIC_ENDPOINT` | Pharmacist agent public URL (ngrok) | — |
| `ISSUER_AGENT_LABEL` | Issuer agent label | MyAgent |
| `DOCTOR_AGENT_LABEL` | Doctor agent label | MyAgent |
| `PHARMACIST_AGENT_LABEL` | Pharmacist agent label | MyAgent |
| `ISSUER_DID` | Issuer decentralized identifier | — |
| `DOCTOR_DID` | Doctor decentralized identifier | — |
| `PHARMACIST_DID` | Pharmacist decentralized identifier | — |
| `ISSUER_SEED` | Issuer DID seed | — |
| `DOCTOR_SEED` | Doctor DID seed | — |
| `PHARMACIST_SEED` | Pharmacist DID seed | — |
| `DATABASE_URL` | MongoDB connection string | — |
| `DOCUMENT_SIGNING_SECRET` | JWT secret for document signatures | `default-secret-key-change-in-production` |
| `NODE_ENV` | Environment mode (`development` bypasses DID import errors) | — |
| `ISSUER_CRED_DEF_ID` | Government credential definition ID (cross-agent) | — |
| `DOCTOR_MEDICAL_CRED_DEF_ID` | Doctor's medical credential definition ID | — |
| `GOVERNMENT_MEDICAL_CRED_DEF_ID` | Government-issued medical credential def ID | — |

**Build:**
- `tsconfig.json` — Target ES2020, module NodeNext, strictNullChecks, noImplicitAny
- No build step; uses `ts-node` for direct execution
- Running: `npx ts-node server.ts --issuer|--doctor|--pharmacist`

**Scripts (package.json):**
```bash
yarn issuer      # npx ts-node server.ts --issuer
yarn doctor      # npx ts-node server.ts --doctor
yarn pharmacist  # npx ts-node server.ts --pharmacist
yarn verifier    # npx ts-node server.ts --verifier
```

## Platform Requirements

**Development:**
- Node.js >=20
- MongoDB instance (local or remote)
- Ngrok (for public agent endpoints during demo)
- BCovrin Test Net access (public Indy ledger)

**Production:**
- Deployment target: Not specified (no Dockerfile, no deployment config detected)
- Production considerations: All env vars should use real values; `DOCUMENT_SIGNING_SECRET` must be changed

---

*Stack analysis: 2026-05-23*
