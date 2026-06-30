# MediTrust — Blockchain-based Patient-Centric Healthcare SSI System

A thesis implementation of a **decentralized, patient-centric healthcare identity system** using Self-Sovereign Identity (SSI) built on Hyperledger Indy + Credo-TS, with Decentralized Web Nodes (DWN) replacing centralized MongoDB for off-chain medical record storage.

---

## What This Project Is

MediTrust implements the SSI trust triangle (Issuer → Holder → Verifier) in a healthcare context. Patients own their identity and medical data — no central authority stores or controls it. The system uses:

- **Hyperledger Indy** (BCovrin TestNet) as the permissioned blockchain ledger for DIDs, schemas, and credential definitions
- **Credo-TS** (Aries Framework JavaScript) as the SSI agent framework
- **AnonCreds** for zero-knowledge proof selective disclosure
- **DWN** (`@web5/api`) as the decentralized off-chain storage layer (replacing MongoDB from the original PoC)
- **AES-256** encryption for medical records at rest (new — the original PoC only hashed, never encrypted)

---

## Repository Structure

```
.
├── CONTEXT.md                   — session context, locked decisions, open questions (read this first)
├── README.md                    — this file
│
├── demo/                        — legacy PoC (Credo-TS + Express + MongoDB), kept for reference
│   └── credo/                   — working SSI agent: server.ts, agent.ts, module.ts, network.ts
│
├── interface/                   — legacy Next.js 15 frontend portals, kept for reference
│   └── src/app/                 — government/, doctor/, pharmacist/, patient/, verifier/ pages
│
├── agents/                      — NEW: Credo-TS + Indy SSI agents (4 independent processes)
│   ├── government-agent/        — issues patient identity credentials
│   ├── doctor-agent/            — verifies identity, issues medical document credentials
│   ├── pharmacy-agent/          — verifies identity + prescription, dispenses
│   ├── healthcare-authority-agent/ — NEW: issues doctor/hospital licensing creds + revocation
│   └── shared/                  — common Credo module/network/types config (no duplication)
│
├── dwn/                         — NEW: Decentralized Web Node layer (replaces MongoDB)
│   ├── patient-node/            — patient's own DWN instance
│   └── provider-node/           — provider's DWN instance
│
├── edge/                        — NEW: thin clients driving the 14-step auth+permission dataflow
│   ├── patient-edge/
│   └── provider-edge/
│
├── bridge/                      — NEW: orchestrates Credo/Indy world ↔ Web5/DWN world
│   └── src/
│       ├── routes/
│       ├── services/
│       └── coordinators/auth-flow.ts   — owns the full 14-step sequence end to end
│
├── crypto/
│   ├── encryption/              — NEW: real AES-256 at rest
│   └── sss/                     — NEW: Shamir Secret Sharing + multi-party key recovery (design pending)
│
├── consent/                     — NEW: Verifiable Consent Receipt VC issuance (Indy-native)
├── audit/                       — NEW: signed, structured, immutable audit log
│
├── apps/
│   └── web/                     — successor to interface/, ported once agents stabilize
│
├── docs/
│   ├── architecture/
│   └── decisions/               — ADR-style design decision records
│
└── infra/                       — docker-compose.yml, boot order, shared env templates
```

---

## What Is Already Built (Legacy PoC — `demo/` + `interface/`)

The original proof-of-concept is fully working and serves as the adaptation base for the new build.

### Backend (`demo/credo/`)

| File | Lines | Purpose |
|------|-------|---------|
| `server.ts` | 1799 | Express app, all route handlers, agent lifecycle, in-memory proof cache |
| `agent.ts` | 580 | `BaseAgent` — Credo Agent wrapper, DID ops, credential issuance |
| `document-routes.ts` | 627 | 6 document endpoints (upload, issue, verify, share, download) |
| `document-storage.ts` | 281 | MongoDB CRUD with SHA-256 hashing + JWT signing |
| `document-service.ts` | 211 | Service layer between routes and storage |
| `module.ts` | 55 | Credo module assembly |
| `network.ts` | 24 | BCovrin TestNet genesis config |
| `agent.ts` | — | `BaseAgent` class: DID creation, credential issuance, proof requests |

**Three agents run as independent Node.js processes:**

| Agent | API Port | DIDComm Port |
|-------|----------|--------------|
| Issuer (Government) | 4000 | 4001 |
| Doctor | 4002 | 4003 |
| Pharmacist | 4004 | 4005 |

### Frontend (`interface/`)

Stack: Next.js 15 + React 18 + Tailwind CSS + `apiService.js` (centralized HTTP client)

| Page | Purpose |
|------|---------|
| `/government` | 4-step wizard: connect → issue identity credential |
| `/doctor` | 5-step wizard: connect → verify identity → upload document → issue credential |
| `/pharmacist` | 4-step wizard: connect → verify identity → verify prescription → retrieve document |
| `/patient` | Simulated wallet UI (mock data — real holder role lives in the Bifold mobile app) |
| `/verifier` | Generic verifier stepper |

### Existing Credential Flows

1. **Government issues identity credential** — patient scans QR, accepts AnonCreds credential with `name`, `age`, `email`, `nationalId`, `medicalCondition`, `bloodType`, `emergencyContact`
2. **Doctor verifies patient + issues prescription** — doctor requests ZKP proof restricted to government cred-def, then uploads document (stored in MongoDB as SHA-256 hash + JWT-signed), issues document metadata as credential to patient
3. **Pharmacist verifies identity + prescription** — double proof-request chain, then retrieves document from MongoDB and dispenses

### Known Gaps in the Legacy PoC (What This Build Closes)

| Gap | Detail |
|-----|--------|
| Storage is centralized (MongoDB) | Directly contradicts the decentralization thesis claim |
| No real encryption | SHA-256 hashing + JWT signing only — records were never encrypted at rest |
| Consent is implicit | No explicit Verifiable Consent Receipt VC issued when patient grants access |
| Audit trail is weak | Only MongoDB timestamps — no signed, structured, immutable log |
| No revocation for provider credentials | No healthcare-authority agent to revoke doctor/hospital licenses |
| Doctor and pharmacist shared the same DID/seed | Each new agent gets its own DID |

---

## What We Are Implementing (New Build)

All new work happens in the top-level folders (`agents/`, `dwn/`, `edge/`, `bridge/`, `crypto/`, `consent/`, `audit/`). The legacy `demo/` and `interface/` are kept as reference — not deleted, not run in parallel.

### Core Architecture Change: DWN Replaces MongoDB

Medical records are written to the patient's **Decentralized Web Node** (DWN) instead of a central MongoDB instance. The patient's DWN is their own data store — no provider can read it without an explicit permission grant.

### The 14-Step DWN Permission + Record-Write Dataflow

This is the core flow the new `dwn/`, `edge/`, and `bridge/` layers implement:

1. `provider-edge` generates QR code containing provider DID
2. `patient-edge` resolves provider DID through Indy VDR
3. `patient-edge` retrieves patient's own DID document from local wallet
4. `patient-edge` → `patient-node`: sends patient DID + freshly generated nonce
5. `patient-node` → `provider-node`: forwards patient DID + nonce over HTTP
6. `provider-node` resolves the patient DID through Indy VDR
7. `provider-node` → `provider-edge`: sends resolved patient DID document
8. `provider-edge` → `provider-node`: generates + sends authentication signature (provider private key)
9. `provider-node` issues an access token to the patient node
10. `provider-node` → `patient-node`: sends permission request
11. `patient-node` → `patient-edge`: forwards permission request, alerts the patient
12. `patient-edge` → `patient-node`: patient's grant/deny decision
13. `patient-node` → `provider-node`: forwards the permission grant
14. `provider-node` → `patient-node`: sends `RecordsWrite` message; patient node decrypts and stores

`bridge/src/coordinators/auth-flow.ts` orchestrates this full sequence.

### New Modules

| Module | What it does | Status |
|--------|-------------|--------|
| `agents/healthcare-authority-agent/` | Issues doctor/hospital licensing credentials + handles revocation | Net new |
| `agents/shared/` | Common Credo module config extracted from `demo/credo/module.ts` + `network.ts` | Net new |
| `dwn/patient-node/` | Patient's own DWN instance; owns steps 4, 5, 10–12, 14 of the dataflow | Net new |
| `dwn/provider-node/` | Provider's DWN instance; owns steps 5–9, 13, 14 | Net new |
| `edge/patient-edge/` + `edge/provider-edge/` | Thin clients driving the 14-step flow | Net new |
| `bridge/src/coordinators/auth-flow.ts` | Orchestrates the full Indy ↔ DWN auth sequence | Net new |
| `crypto/encryption/` | Real AES-256 at rest, wired into the DWN write path | Net new |
| `consent/` | Explicit Verifiable Consent Receipt VC (Indy-native signed credential, no smart contract) | Net new |
| `audit/` | Signed, structured, immutable audit log | Net new |
| `crypto/sss/` | Shamir Secret Sharing + multi-party key recovery/approval (design pending) | Net new |
| `apps/web/` | Next.js successor to `interface/`, ported once agents stabilize | Planned |
| `infra/docker-compose.yml` | Single-command boot of all services | Planned |

### Build Order

Dependencies run one direction — build in this sequence:

1. `bridge/src/services/event-bus.ts` — everything else eventually publishes/subscribes through it
2. `agents/shared/` — common config so the four agents don't each duplicate it
3. `agents/healthcare-authority-agent/` — simplest new agent, proves the adapted pattern works
4. `dwn/patient-node/` — start with patient-side permission flow (most thesis-relevant part)
5. `dwn/provider-node/` — mirror of patient-node
6. `edge/patient-edge/` + `edge/provider-edge/` — thin UIs once nodes work headless
7. `crypto/encryption/` — wire AES-256 into the DWN write path before any real data flows
8. `consent/` + `audit/` — attach to credential-issuance and permission-grant paths
9. `crypto/sss/` — once recovery/approval design is settled
10. `infra/docker-compose.yml` — last, once individual services are independently runnable
11. `apps/web/` — port the working portal UI from `interface/` once new agents are stable

---

## Technology Stack

### Existing (Legacy PoC)

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >=20 |
| Language | TypeScript | 5.7.2 |
| SSI Framework | Credo-TS | 0.5.13 |
| Web Server | Express | 4.21 |
| Storage | MongoDB via Prisma | 5.10 |
| Document Signing | jsonwebtoken | 9.0.2 |
| Ledger | Hyperledger Indy (BCovrin TestNet) via indy-vdr | 0.2.2 |
| Wallet | Aries Askar | 0.2.3 |
| Crypto | AnonCreds | 0.2.2 |
| Frontend | Next.js 15 + React 18 + Tailwind CSS | — |

### New (This Build)

| Layer | Technology |
|-------|-----------|
| Off-chain storage | DWN via `@web5/api` (replaces MongoDB) |
| Record encryption | AES-256 at rest |
| Key recovery | Shamir Secret Sharing (`shamirs-secret-sharing` or equivalent) |
| Consent | Verifiable Consent Receipt VC (Indy AnonCreds) |

---

## Running the Legacy PoC

### Prerequisites

- Node.js >=20
- MongoDB instance
- ngrok (for mobile wallet DIDComm)
- Bifold mobile wallet (iOS/Android) — the patient holder role lives here

### Backend

```bash
cd demo/credo
yarn install
cp .env.sample .env   # fill in DIDs, seeds, MongoDB URL, ngrok endpoints
./setup-db.sh
npx prisma db push

# Start in three separate terminals:
yarn issuer      # http://localhost:4000 (API) + 4001 (DIDComm)
yarn doctor      # http://localhost:4002 (API) + 4003 (DIDComm)
yarn pharmacist  # http://localhost:4004 (API) + 4005 (DIDComm)
```

### ngrok (one tunnel per agent DIDComm port)

```bash
ngrok http 4001   # copy URL → ISSUER_AGENT_PUBLIC_ENDPOINT in .env
ngrok http 4003   # copy URL → DOCTOR_AGENT_PUBLIC_ENDPOINT
ngrok http 4005   # copy URL → PHARMACIST_AGENT_PUBLIC_ENDPOINT
```

### Frontend

```bash
cd interface
npm install
cp .env.sample .env.local   # set NEXT_PUBLIC_API_URL and ISSUER_CRED_DEF_ID
npm run dev                  # http://localhost:3000
```

---

## Open Decisions

- **SSS/MPOA scheme**: who holds shares (patient / hospital / regulator)? What threshold (e.g. 2-of-3)? What triggers reconstruction — key recovery, emergency access, both?
- **DWN encryption key management**: whose key encrypts a given record — patient's, or a per-record key wrapped by the patient's key?
- **Migration of `interface/` → `apps/web/`**: full rewrite vs. incremental port (recommendation: incremental — existing pages work, just repoint at new agent endpoints)

---

## Known Constraints

- `demo/credo/.env` has live MongoDB credentials committed to git — rotate before touching that file again
- Doctor and pharmacist agents in the old PoC shared the same DID/seed — new `agents/` build gives each agent its own DID
- No test framework exists in the legacy PoC — the new build should introduce one

---

## Context File

`CONTEXT.md` is the single source of truth for all locked decisions, the full 14-step dataflow, the module status table, build order, and open questions. Paste it at the start of any new session working on this project.
