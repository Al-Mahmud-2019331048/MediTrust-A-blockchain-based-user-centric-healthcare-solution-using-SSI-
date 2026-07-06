# MediTrust — Decentralised Patient-Centric Healthcare SSI System

A thesis implementation of a **decentralised, patient-centric healthcare identity and data system** using Self-Sovereign Identity (SSI) built on Hyperledger Indy + Credo-TS, with a full Decentralised Web Node (DWN) replacing centralised storage for off-chain medical records.

---

## What This Project Is

MediTrust implements the SSI trust triangle (Issuer → Holder → Verifier) in a healthcare context. Patients own their identity and medical data — no central authority stores or controls it.

The original defended thesis proposed SSI + DWN but the actual PoC used MongoDB as a pragmatic stand-in. This implementation round closes that gap by building what was proposed: a full DWN node with LevelDB embedded storage, patient-controlled encrypted records, SSI-based consent via DWN Permissions + Verifiable Consent Receipt VCs on Indy, key recovery via Shamir Secret Sharing, and a full signed audit trail.

**No MongoDB anywhere.** Every component is either on-chain (Indy), embedded file-based (LevelDB for DWN, SQLite for audit), or in-memory (agent caches).

**Smart contracts are explicitly out of scope.** Hyperledger Indy has no VM layer — consent and audit are handled by signed Verifiable Credentials and a signed local log, not on-chain contract logic. This is a deliberate, final architecture choice, not a placeholder.

---

## Architecture

```
Patient (Bifold Wallet — iOS/Android, or an automated test-patient agent for local testing)
        │
        │ DIDComm / OOB invitation
        ▼
Government Agent  :4000     ← Issues Identity VC (AnonCreds on Indy)
Doctor Agent      :4002     ← Verifies identity ZKP, issues medical VC/prescription, writes to DWN
Pharmacy Agent    :4004     ← Verifies identity + prescription via ZKP proof request
        │
        │ After issuance — doctor's agent writes the record into the patient's own DWN
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Full DWN Patient Node  :5050  (runs on patient's machine)  │
│                                                             │
│  Records Interface                                          │
│    createRecord()/storeRecord() → AES-256-GCM → LevelDB     │
│    queryRecord()   → permission check → protocol filter     │
│                      → decrypt → return                     │
│    (update/delete are not part of this project's required   │
│    function set and were never built)                       │
│                                                             │
│  Permissions Interface                                       │
│    shareRecord()   → LevelDB + Consent Receipt VC (JWT)      │
│    revokeAccess()  → LevelDB, immediate enforcement          │
│    checkPermission() → LevelDB lookup                        │
│                                                             │
│  Protocols Interface                                         │
│    defineProtocol() → LevelDB (MedicalRecord, Prescription,  │
│    InsuranceClaim) — attribute-level field caps per role     │
│    generateVerifiablePresentation() → JWT-based W3C VP       │
│    from an AnonCreds ZKP proof record                        │
│                                                             │
│  Storage: LevelDB (embedded, patient's own files)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ audit event on every operation
                           ▼
Audit Service         ← AuditService.record() → SQLite via Prisma
                         Signed JWT, file-based, no server

SSS / MPOA Service    ← splitMEK() on patient registration (port 4008)
                         3-of-5 Shamir shares + Patient+Hospital+Guardian approval on recovery

Hyperledger Indy      ← DIDs, VCs, credential definitions
(BCovrin TestNet)        (on-chain anchoring of audit events/record integrity is a
                         documented, deferred placeholder — see Known Constraints)
```

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js ≥20 | Servers run via `tsx`, not `ts-node` (avoids fighting the shared tsconfig's bundler-oriented settings needed by the Next.js frontend) |
| Language | TypeScript 5 | |
| SSI Framework | Credo-TS 0.5.x | AnonCreds, Askar wallet, IndyVdr — real runtime dependencies at the project root |
| Ledger | Hyperledger Indy (BCovrin TestNet) | DIDs, schemas, credential definitions |
| ZKP | AnonCreds | Attribute-level selective disclosure |
| Off-chain storage | LevelDB (embedded) | Full DWN node — no external DB server |
| Audit storage | SQLite via Prisma | File-based, no server |
| Record encryption | AES-256-GCM | Per-record key wrapped by a placeholder KEK (real patient-DID-derived wrapping deferred until patient wallet/DID infrastructure exists) |
| Key recovery | Shamir Secret Sharing | 5 shares, any 3 reconstruct (pure JS, `shamir-secret-sharing` package) |
| Consent proof | Verifiable Consent Receipt (signed JWT) | Issued at every permission grant; on-chain anchoring deferred |
| Mobile wallet | Bifold | Real patient holder role — iOS/Android. For local dev/testing, `benchmark/test-patient-helper.ts` spins up an automated stand-in agent instead |
| Frontend | Next.js 15 + React 18 | `apps/web/` has reusable components only (no pages yet — see Known Constraints); `interface/` is the working legacy reference |

---

## The 10 Required Modules

| # | Module | Status |
|---|--------|--------|
| 1 | SSI Identity Layer — DID creation, key pairs, Indy registration | Done — real DIDs registered on BCovrin for all 3 agents |
| 2 | Verifiable Credential System — issue, store, verify | Done (falls back to a plain DIDComm message when ledger connectivity is unavailable — see Known Constraints) |
| 3 | Digital Wallet — Bifold mobile + Credo-TS/Askar | Bifold handles the real patient wallet; agent-side wallets via Credo-TS/Askar |
| 4 | Selective Sharing (core contribution) — ZKP + DWN Protocol field filtering + W3C VP | Done — attribute-level field filtering enforced on reads; JWT-based W3C VP generated from AnonCreds proofs |
| 5 | DWN Implementation — Records + Permissions + Protocols, LevelDB | Done — all three interfaces + a real running server |
| 6 | Encryption Layer — AES-256-GCM + key wrapping | Done — placeholder KEK until patient wallet/DID work lands |
| 7 | MPOA + SSS Key Recovery — 5 shares, threshold 3 | Done, including a real running service (`crypto/sss/server.ts`) |
| 8 | Consent Management — DWN Permissions + Consent Receipt VC | Done (folded into Module 5) — signed JWT receipt, not a smart contract (Indy has no VM) |
| 9 | Audit Trail — persistent SQLite, signed, every DWN operation | Done |
| 10 | Security Evaluation — 8 experiments, metrics table, attack simulations | Done — `benchmark/run-experiments.ts` |

---

## 20-Day Build Order

| Day | Module | Status |
|-----|--------|--------|
| 1–2 | Audit Trail → SQLite (Module 9) | Done |
| 3–4 | SSS + MPOA Key Recovery (Module 7) | Done |
| 5–6 | DWN Storage + Encryption | Done |
| 7–8 | DWN Records Interface (Module 5) | Done |
| 9–10 | DWN Permissions Interface (Module 8) | Done |
| 11–12 | DWN Protocols Interface (Module 4) | Done |
| 13 | DWN server.ts | Done |
| 14–15 | Per-agent server.ts entry points | Done |
| 16–17 | Wire agents → DWN | Done (doctor-agent) |
| 18 | Benchmark — all 8 experiments (Module 10) | Done |
| 19 | End-to-end testing | Done |
| 20 | Documentation | Done (this file + CLAUDE.md/CONTEXT.md) |

See `CLAUDE.md` for the complete file-by-file build log and every design decision's reasoning.

---

## Repository Structure

```
.
├── CLAUDE.md              ← Project guide: file map, build status, constraints (read this)
├── CONTEXT.md             ← Session context: decisions, architecture, build order
├── README.md              ← This file
│
├── agents/                ← Credo-TS + Indy SSI agent services
│   ├── shared/            ← BaseAgent, types, module config, network config, routes, dwn-client
│   ├── government-agent/  ← Issues patient identity VCs (port 4000), server.ts
│   ├── doctor-agent/      ← Verifies identity, issues medical VCs/prescriptions, writes to DWN (port 4002), server.ts
│   └── pharmacy-agent/    ← Verifies identity + prescription (port 4004), server.ts
│
├── dwn/                   ← Decentralised Web Node (patient owns their data)
│   └── patient-node/      ← Records + Permissions + Protocols interfaces, LevelDB, server.ts (port 5050)
│
├── audit/                 ← Audit trail — logs every DWN operation
│   ├── prisma/            ← SQLite schema + audit.db + migrations
│   └── src/services/      ← AuditService: record, query, verify, sign
│
├── crypto/
│   ├── encryption/        ← AES-256-GCM, SHA-256, JWT signing utilities
│   └── sss/               ← Shamir Secret Sharing + MPOA key recovery, server.ts (port 4008)
│
├── apps/web/              ← New Next.js frontend — reusable components only, no pages yet
│
├── benchmark/             ← 8-experiment runner, 5 attack simulations, results output
├── e2e/                   ← Full end-to-end flow test, results output
├── infra/                 ← docker-compose.yml (not built)
│
├── demo/credo/            ← LEGACY working PoC (keep as reference, do not delete)
└── interface/             ← LEGACY Next.js frontend (keep as reference, do not delete)
```

---

## Running It Locally

### Setup

```bash
npm install    # installs everything for every module — no per-module package.json exists
```

Create a `.env` file at the repo root (gitignored, never commit it — completely separate from and unrelated to `demo/credo/.env`, which must never be touched). Required:

```bash
# Self-generated secrets — not external credentials, no account/signup needed anywhere.
DWN_MASTER_KEK=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
DOCUMENT_SIGNING_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
AUDIT_SIGNING_SECRET=<same command, different output>
CONSENT_SIGNING_SECRET=<same command, different output>
VP_SIGNING_SECRET=<same command, different output>

# Agent identity — real DIDs registered via https://test.bcovrin.vonx.io/register
# ({seed, role: "ENDORSER", alias} → {did, seed, verkey}), each agent needs its own
# distinct seed (never share one across agents).
GOVERNMENT_DID=did:indy:bcovrin:test:...
GOVERNMENT_SEED=...
DOCTOR_DID=did:indy:bcovrin:test:...
DOCTOR_SEED=...
PHARMACY_DID=did:indy:bcovrin:test:...
PHARMACY_SEED=...
```

See `.env` comments in a working checkout (or `CLAUDE.md`'s Known Constraints) for the complete list of every optional override.

### Run every service

```bash
npm run dwn:dev       # DWN patient node — http://localhost:5050
npm run sss:dev       # SSS/MPOA key recovery service — http://localhost:4008
npm run gov:dev       # Government agent — http://localhost:4000
npm run doctor:dev    # Doctor agent — http://localhost:4002
npm run pharmacy:dev  # Pharmacy agent — http://localhost:4004
```

**Important**: agent servers accept connections immediately but only mount their full route set *after* their ledger-registration attempt finishes — wait for each agent's own `"...routes mounted. Ready."` log line before hitting its API, especially on a network where ledger connectivity is restricted (see below).

### Run the benchmark and end-to-end test

```bash
npm run benchmark   # all 8 experiments + 5 attack simulations → benchmark/results/
npm run e2e-test    # full DID → VC → storeRecord → shareRecord → selective read → revokeAccess flow → e2e/results/
```

Both scripts attempt every step for real against the actually-running services above (no mocking) and honestly report `blocked`/`degraded` for any step that specifically needs ledger connectivity this network doesn't have, rather than fabricating a result.

### A real network caveat, not a code bug

Real credential issuance, ledger DID resolution, and schema/credential-definition registration all need a raw TCP connection to BCovrin's validator nodes (`138.197.138.255`, ports 9701–9708) — separate from the plain HTTPS endpoint used to *register* a DID, which works fine everywhere. Some networks (this project was built on a home connection in Bangladesh) block outbound traffic on these unusual ports by default. If you see `Pool timeout: Request was interrupted` in an agent's logs, that's this — try a different network (mobile hotspot, VPN) rather than assuming something is broken. Every script in this repo is designed to degrade gracefully and report honestly when this happens, rather than crash or fake a result.

---

## The 8 Required Experiments

| Experiment | Metric | Status on a ledger-blocked network |
|-----------|--------|---------------|
| VC issuance time | ms | Real DIDComm flow runs; reports `degraded` (W3C-message fallback) without ledger access |
| VC verification time | ms | Reports `blocked` — needs a real credential to verify against |
| Blockchain transaction latency | seconds | Reports `blocked` with the real underlying ledger error |
| DWN storage overhead | ratio | Fully real, no ledger needed |
| Selective sharing overhead | ms | Fully real, no ledger needed |
| SSS recovery time | ms | Fully real, no ledger needed |
| Key recovery success rate | % | Fully real, no ledger needed |
| Access revocation time | seconds | Fully real, no ledger needed |

Plus a bonus SSS split-time metric and 5 attack simulations (unauthorized read, insufficient SSS shares, MPOA before threshold, expired MPOA request, tampered audit entry) — all fully real regardless of ledger access. Results in `benchmark/results/` as JSON + Markdown.

---

## Running the Legacy PoC

The original working demo lives in `demo/credo/` + `interface/`. It runs on MongoDB and demonstrates the full SSI flow with real, working QR-code pages. Keep it as reference — do not run it in parallel with the new build, and never touch `demo/credo/.env` (it has live committed credentials).

```bash
cd demo/credo
yarn install
cp .env.sample .env    # fill in agent seeds, ngrok endpoints
yarn issuer            # Government agent  http://localhost:4000
yarn doctor            # Doctor agent      http://localhost:4002
yarn pharmacist        # Pharmacy agent    http://localhost:4004
```

```bash
ngrok http 4001    # copy URL → ISSUER_AGENT_PUBLIC_ENDPOINT in .env
ngrok http 4003    # copy URL → DOCTOR_AGENT_PUBLIC_ENDPOINT
ngrok http 4005    # copy URL → PHARMACIST_AGENT_PUBLIC_ENDPOINT
```

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
| Encryption | AES-256-GCM at rest, per-record key wrapped by a placeholder KEK |
| SSS threshold | 5 shares total, any 3 reconstruct the MEK |
| Share holders | Patient device, Hospital, Trusted family, Backup server, Recovery agent |
| MPOA approvals | Patient + Hospital + Guardian (threshold = 3) |
| Smart contracts | **Permanently out of scope** — Indy has no VM layer; not a placeholder, not revisited |
| Legacy PoC | Kept for reference — not deleted, not run in parallel |
| Frontend (new pages) | Deferred — `apps/web/` has reusable components only; a patient DWN dashboard is buildable independent of agent work whenever prioritized |

---

## Known Constraints (highlights — see CLAUDE.md for the complete list)

- `demo/credo/.env` has live credentials committed to git — **never touch that file**.
- Each agent has its own DID and seed — never shared across agents.
- No patient wallet/DID infrastructure exists yet — `patientDID` for DWN writes is currently derived from the DIDComm connection's ephemeral `theirDid`, a documented placeholder (same treatment as the KEK).
- `updateRecord`/`deleteRecord` were never part of this project's required DWN function set and were never built — only `createRecord`/`storeRecord`/`queryRecord`/`shareRecord`/`revokeAccess` are required and implemented.
- On-chain anchoring (record integrity VCs, audit-event VCs) is a documented, deferred placeholder — the DWN has no wallet/DIDComm identity of its own to receive a credential, which is a genuine open design question, not a quick fix.
- `apps/web/` has zero Next.js scaffolding (no `package.json`, no `next.config.js`, no `app/` directory) — only reusable components/hooks/services exist.
- Run `npm install` at the project root after cloning — one shared `package.json` covers every module (agents, DWN, crypto/sss, benchmark, e2e); no per-module `package.json` files exist anywhere.
