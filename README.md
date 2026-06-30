# MediTrust — Decentralised Patient-Centric Healthcare SSI System

A thesis implementation of a **decentralised, patient-centric healthcare identity and data system** using Self-Sovereign Identity (SSI) built on Hyperledger Indy + Credo-TS, with a full Decentralised Web Node (DWN) replacing centralised storage for off-chain medical records.

---

## What This Project Is

MediTrust implements the SSI trust triangle (Issuer → Holder → Verifier) in a healthcare context. Patients own their identity and medical data — no central authority stores or controls it.

The original defended thesis proposed SSI + DWN but the actual PoC used MongoDB as a pragmatic stand-in. This implementation round closes that gap by building what was proposed: a full DWN node with LevelDB embedded storage, patient-controlled encrypted records, SSI-based consent via DWN Permissions + Verifiable Consent Receipt VCs on Indy, key recovery via Shamir Secret Sharing, and a full signed audit trail.

**No MongoDB anywhere.** Every component is either on-chain (Indy), embedded file-based (LevelDB for DWN, SQLite for audit), or in-memory (agent caches).

---

## Architecture

```
Patient (Bifold Wallet — iOS/Android)
        │
        │ DIDComm / OOB invitation
        ▼
Government Agent  :4000     ← Issues Identity VC (AnonCreds on Indy)
Doctor Agent      :4002     ← Verifies identity ZKP, issues medical VC, uploads record to DWN
Pharmacy Agent    :4004     ← Verifies identity + prescription via DWN query
        │
        │ After verification — doctor uploads record to patient's DWN
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Full DWN Patient Node  :5000  (runs on patient's machine)  │
│                                                             │
│  Records Interface                                          │
│    createRecord()  → AES-256-GCM encrypt → LevelDB         │
│    readRecord()    → permission check → protocol filter     │
│                      → decrypt → return                     │
│    updateRecord()  → re-encrypt → LevelDB                   │
│    deleteRecord()  → remove from LevelDB                    │
│                                                             │
│  Permissions Interface                                      │
│    grantPermission()   → LevelDB + Consent Receipt VC       │
│    revokePermission()  → LevelDB + Indy revoke              │
│    checkPermission()   → LevelDB lookup                     │
│                                                             │
│  Protocols Interface                                        │
│    defineProtocol()    → LevelDB                            │
│    (MedicalRecord, Prescription, InsuranceClaim)            │
│                                                             │
│  Storage: LevelDB (embedded, patient's files)               │
└──────────────────────────┬──────────────────────────────────┘
                           │ audit event on every operation
                           ▼
Audit Service         ← AuditService.record() → SQLite via Prisma
                         Signed JWT, file-based, no server

SSS / MPOA Service    ← splitMEK() on patient registration
                         3-of-5 Shamir shares + multi-party approval on recovery

Hyperledger Indy      ← DIDs, VCs, Consent Receipt VCs, Revocation Registry
(BCovrin TestNet)
```

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js ≥20 | |
| Language | TypeScript 5 | |
| SSI Framework | Credo-TS 0.5.x | AnonCreds, Askar wallet, IndyVdr |
| Ledger | Hyperledger Indy (BCovrin TestNet) | DIDs, schemas, credential definitions |
| ZKP | AnonCreds | Attribute-level selective disclosure |
| Off-chain storage | LevelDB (embedded) | Full DWN node — no external DB server |
| Audit storage | SQLite via Prisma | File-based, no server |
| Record encryption | AES-256-GCM | Per-record key wrapped by patient public key |
| Key recovery | Shamir Secret Sharing | 5 shares, any 3 reconstruct (pure JS) |
| Consent proof | Verifiable Consent Receipt VC | Issued on Indy at permission grant |
| Mobile wallet | Bifold | Patient holder role — iOS/Android |
| Frontend | Next.js 15 + React 18 + Tailwind | `apps/web/` (new), `interface/` (legacy reference) |

---

## The 10 Required Modules

| # | Module | Status |
|---|--------|--------|
| 1 | SSI Identity Layer — DID creation, key pairs, Indy registration | Exists in `demo/credo/` |
| 2 | Verifiable Credential System — issue, store, verify | Exists in `demo/credo/` |
| 3 | Digital Wallet — Bifold mobile + Credo-TS/Askar | Exists |
| 4 | Selective Sharing — ZKP attribute-level + DWN Protocol field filtering | ZKP exists; DWN Protocol layer pending |
| 5 | DWN Implementation — Records + Permissions + Protocols, LevelDB | Not built |
| 6 | Encryption Layer — AES-256-GCM + key wrapping | Written, not wired |
| 7 | MPOA + SSS Key Recovery — 5 shares, threshold 3 | Not built |
| 8 | Consent Management — DWN Permissions + Consent Receipt VC | Not built (folded into Module 5) |
| 9 | Audit Trail — persistent SQLite, signed, every DWN operation | **Complete** |
| 10 | Security Evaluation — 8 experiments, metrics table | Not built |

---

## 20-Day Build Order

| Day | Module | Status |
|-----|--------|--------|
| ~~1–2~~ | ~~Audit Trail → SQLite (Module 9)~~ | **Done** |
| 3–4 | SSS + MPOA Key Recovery (Module 7) | Next |
| 5–6 | DWN Storage + Encryption | Pending |
| 7–8 | DWN Records Interface (Module 5) | Pending |
| 9–10 | DWN Permissions Interface (Module 8) | Pending |
| 11–12 | DWN Protocols Interface (Module 4) | Pending |
| 13 | DWN server.ts + package.json | Pending |
| 14–15 | Per-agent server.ts entry points | Pending |
| 16–17 | Wire agents → DWN | Pending |
| 18 | Benchmark — all 8 experiments (Module 10) | Pending |
| 19 | End-to-end testing | Pending |
| 20 | Documentation | Pending |

---

## Repository Structure

```
.
├── CLAUDE.md              ← Project guide: file map, build status, constraints (read this)
├── CONTEXT.md             ← Session context: decisions, architecture, build order
├── README.md              ← This file
│
├── agents/                ← Credo-TS + Indy SSI agent services
│   ├── shared/            ← BaseAgent, types, module config, network config, routes
│   ├── government-agent/  ← Issues patient identity VCs (port 4000)
│   ├── doctor-agent/      ← Verifies identity, issues medical VCs (port 4002)
│   └── pharmacy-agent/    ← Verifies identity + prescription (port 4004)
│
├── dwn/                   ← Decentralised Web Node (patient owns their data)
│   └── patient-node/      ← Records + Permissions + Protocols interfaces, LevelDB
│
├── audit/                 ← Audit trail — logs every DWN operation
│   ├── prisma/            ← SQLite schema + audit.db + migrations
│   └── src/services/      ← AuditService: record, query, verify, sign
│
├── crypto/
│   ├── encryption/        ← AES-256-GCM, SHA-256, JWT signing utilities
│   └── sss/               ← Shamir Secret Sharing + MPOA key recovery
│
├── apps/web/              ← New Next.js frontend (replaces interface/ over time)
│
├── benchmark/             ← 8 experiments runner + results output
├── infra/                 ← docker-compose.yml (last to build)
│
├── demo/credo/            ← LEGACY working PoC (keep as reference, do not delete)
└── interface/             ← LEGACY Next.js frontend (keep as reference, do not delete)
```

---

## The 8 Required Experiments

| Experiment | Metric | How to Measure |
|-----------|--------|---------------|
| VC issuance time | ms | `POST /issue-credential` → `credential-issued` state |
| VC verification time | ms | `POST /send-proof-request` → `isVerified: true` |
| Blockchain transaction latency | seconds | Schema/credDef registration on BCovrin |
| DWN storage overhead | KB ratio | Encrypted record size vs plaintext size |
| Selective sharing overhead | ms | Full retrieval vs Protocol-filtered retrieval |
| SSS key split time | ms | `performance.now()` around `splitMEK()` |
| SSS key recovery time | ms | `initiateRecovery` to MEK reconstructed (3 shares) |
| Access revocation time | seconds | `POST /revoke` → query returns 403 |

Results output to `benchmark/results/` as JSON + Markdown table.

---

## Running the Legacy PoC

The original working demo lives in `demo/credo/` + `interface/`. It runs on MongoDB and demonstrates the full SSI flow. Keep it as reference — do not run it in parallel with the new build.

### Prerequisites

- Node.js ≥20
- ngrok (for Bifold mobile wallet DIDComm)
- Bifold mobile wallet (iOS/Android)

### Backend

```bash
cd demo/credo
yarn install
cp .env.sample .env    # fill in agent seeds, ngrok endpoints
yarn issuer            # Government agent  http://localhost:4000
yarn doctor            # Doctor agent      http://localhost:4002
yarn pharmacist        # Pharmacy agent    http://localhost:4004
```

### ngrok (one tunnel per DIDComm port)

```bash
ngrok http 4001    # copy URL → ISSUER_AGENT_PUBLIC_ENDPOINT in .env
ngrok http 4003    # copy URL → DOCTOR_AGENT_PUBLIC_ENDPOINT
ngrok http 4005    # copy URL → PHARMACIST_AGENT_PUBLIC_ENDPOINT
```

### Frontend

```bash
cd interface
npm install
cp .env.sample .env.local
npm run dev        # http://localhost:3000
```

---

## Key Decisions (Locked)

| Decision | Choice |
|----------|--------|
| Off-chain storage | Full DWN node (LevelDB embedded) — not MongoDB, not @web5/api |
| Audit storage | SQLite via Prisma — file-based, no server |
| Consent | DWN Permissions (enforcement) + Consent Receipt VC on Indy (proof) |
| MongoDB | Removed entirely from all layers |
| Encryption | AES-256-GCM at rest, per-record key wrapped by patient public key |
| SSS threshold | 5 shares total, any 3 reconstruct the MEK |
| Share holders | Patient device, Hospital, Trusted family, Backup server, Recovery agent |
| MPOA approvals | Patient + Hospital + Trusted Authority (threshold = 3) |
| Smart contracts | Out of scope — Indy has no VM layer |
| Legacy PoC | Kept for reference — not deleted, not run in parallel |

---

## Known Constraints

- `demo/credo/.env` has live credentials committed to git — **never touch that file**
- Each new agent must have its own DID and seed — the old PoC shared them
- `AUDIT_SIGNING_SECRET`, `DOCUMENT_SIGNING_SECRET`, `CONSENT_SIGNING_SECRET` must be set in `.env` before any service starts
- `audit/prisma/audit.db` is excluded from git (`.gitignore`) — regenerate with `prisma migrate dev` after cloning
- Run `npm install` at project root after cloning — provides `dotenv` and `jsonwebtoken` for monorepo-wide resolution
