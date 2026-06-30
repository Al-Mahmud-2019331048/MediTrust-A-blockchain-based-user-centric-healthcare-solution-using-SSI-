# CLAUDE.md — MediTrust Project Guide

> Read this file at the start of every session. Update it whenever a decision is made, a module is completed, or a constraint is discovered.
> Implementation pace: one module at a time, over 20 days. Do NOT implement anything the user has not explicitly approved for that session.

## How to Present Changes for Approval

Before making any code change or asking the user to approve anything, always provide:

1. **What I'm doing** — plain English description of the change, no jargon
2. **Why** — what problem it solves or why it is needed
3. **What files are affected** — which files are being created, modified, or deleted
4. **What stays the same** — what is not being touched
5. **Any risks or things to watch** — anything that could go wrong or needs attention

---

## What This Project Is

A thesis continuation implementing a **decentralised, patient-centric healthcare SSI system** with 10 required modules and 8 measurable experiments.

- **Identity layer:** Hyperledger Indy (BCovrin TestNet) + Credo-TS 0.5.x (AnonCreds, DIDs, ZKP selective disclosure)
- **Storage layer:** Full DWN node (LevelDB embedded — no external DB server) — patients own their encrypted records on their own machine
- **Encryption:** AES-256-GCM at rest + per-record key wrapping. SHA-256 integrity hashing already exists.
- **Consent:** DWN Permissions interface (enforces access) + Verifiable Consent Receipt VC on Indy (cryptographic proof)
- **Audit:** Signed, structured, persistent audit log (SQLite via Prisma — file-based, no server)
- **Key recovery:** Shamir Secret Sharing (5 shares, any 3 recover) + MPOA multi-party approval
- **No MongoDB anywhere** — eliminated entirely from the architecture

The legacy PoC (`demo/credo/` + `interface/`) is kept as reference. All new work goes into the top-level folders.

---

## The 10 Required PoC Modules

| #   | Module                                | What It Proves                                                | Status                                                   |
| --- | ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | SSI Identity Layer                    | DID creation, key pairs, DID registration on Indy ledger      | Exists in `demo/credo/`                                  |
| 2   | Verifiable Credential System          | Hospital issues VC, patient stores in Bifold, doctor verifies | Exists in `demo/credo/`                                  |
| 3   | Digital Wallet                        | Simple wallet API, encrypted local credential storage         | Bifold handles this; agent wallet via Credo-TS/Askar     |
| 4   | Selective Sharing (Core Contribution) | Attribute-level ZKP disclosure + DWN Protocol field filtering | ZKP exists via AnonCreds; DWN Protocol layer to be built |
| 5   | DWN Implementation                    | Records + Permissions + Protocols interfaces, LevelDB storage | **NOT BUILT**                                            |
| 6   | Encryption Layer                      | AES-256-GCM encrypt before DWN store, key wrapping            | Utilities written, not wired                             |
| 7   | MPOA + SSS Key Recovery               | Split MEK (5,3), multi-party approval for recovery            | **NOT BUILT**                                            |
| 8   | Consent Management                    | DWN Permissions + Verifiable Consent Receipt VC on Indy       | **NOT BUILT** (folded into Module 5)                     |
| 9   | Audit Trail                           | Log every DWN operation, persistent, signed                   | Written but in-memory only                               |
| 10  | Security Evaluation                   | Run 8 experiments, produce metrics table                      | **NOT BUILT**                                            |

---

## The 8 Required Experiments

| Experiment                     | Metric   | How to Measure                                       |
| ------------------------------ | -------- | ---------------------------------------------------- |
| VC issuance time               | ms       | `POST /issue-credential` → `credential-issued` state |
| VC verification time           | ms       | `POST /send-proof-request` → `isVerified: true`      |
| Blockchain transaction latency | seconds  | Schema/credDef registration on BCovrin               |
| DWN storage overhead           | KB ratio | Encrypted record size vs plaintext size              |
| Selective sharing overhead     | ms       | Full retrieval vs Protocol-filtered retrieval        |
| SSS split time                 | ms       | `performance.now()` around `splitMEK()`              |
| SSS recovery time              | ms       | `initiateRecovery` to MEK reconstructed (3 shares)   |
| Access revocation time         | seconds  | `POST /revoke` → query returns 403                   |

Results go in `benchmark/results/` as JSON + Markdown table.

---

## Key Decisions (Locked)

| Decision                | Choice                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Off-chain storage       | Full DWN node (LevelDB embedded) — NOT MongoDB, NOT @web5/api                                |
| DWN type                | Full implementation: Records + Permissions + Protocols interfaces                            |
| Audit storage           | SQLite via Prisma (file-based, no server) — NOT MongoDB                                      |
| Consent                 | DWN Permissions interface (enforcement) + Consent Receipt VC on Indy (proof)                 |
| MongoDB                 | **Removed entirely** — no MongoDB anywhere in the system                                     |
| SSI layer               | Keep Hyperledger Indy + Credo-TS                                                             |
| Encryption              | AES-256-GCM at rest + per-record key wrapped by patient public key                           |
| SSS threshold           | 5 shares total, any 3 reconstruct the MEK                                                    |
| SSS share holders       | Share 1: patient device, 2: hospital, 3: trusted family, 4: backup server, 5: recovery agent |
| MPOA approvals required | Patient + Hospital + Trusted Authority (threshold = 3)                                       |
| Smart contracts         | Out of scope — Indy has no VM layer                                                          |
| Legacy PoC              | Keep for reference, don't delete or run in parallel                                          |
| SSS library             | `shamir-secret-sharing` npm package (pure JS, GF(2^8))                                       |

---

## Open Decisions

**VP output wiring** — AnonCreds proof requests already do ZKP selective disclosure; decide before building module 4 whether to serialize a W3C Verifiable Presentation or treat the AnonCreds proof record as sufficient.

---

## File Map — Organised by Role

---

### FRONTEND

```
apps/web/                          ← NEW Next.js app (replaces interface/ over time)
  src/
    services/apiService.ts         ← HTTP client for all agents (TypeScript)
    hooks/
      usePolling.ts                ← Generic polling hook
      useProofVerification.ts      ← Proof request → poll → result
    utils/proof-parser.ts          ← Parses AnonCreds ZKP proof responses
    components/
      QRCodeDisplay.tsx            ← QR code display component
      ConnectionSetup.tsx          ← QR generation + connection polling
      ProofVerification.tsx        ← Proof request + result display

interface/                         ← LEGACY Next.js app (keep as reference, do not delete)
  src/
    services/apiService.js         ← Original HTTP client (plain JS)
    components/
      QRCodeDisplay.jsx
      EstablishConenction.jsx      ← (typo in original filename)
      ShareProof.jsx
    pages/                         ← Working portals: government, doctor, pharmacist
```

---

### BACKEND — SSI / Identity / Agents

```
agents/                            ← Credo-TS + Hyperledger Indy agent services
  shared/                          ← Shared code used by all agents (import from here)
    agent-base.ts                  ← BaseAgent class: DID, wallet, credential, proof methods
    cache-utils.ts                 ← In-memory proof status cache
    common-routes.ts               ← Routes shared by all agents (invitation, connections, proof)
    verifier-routes.ts             ← /proof-data/:id, /proof-status/:id
    debug-routes.ts                ← /debug-agent, /agent-status
    module/module-config.ts        ← Credo-TS module assembly (AnonCreds, Askar, IndyVdr)
    network/network-config.ts      ← BCovrin TestNet genesis transactions
    types/index.ts                 ← All shared TypeScript types
    NOTE: db-singleton.ts DELETED — agents no longer touch a database

  government-agent/                ← Issues patient identity VCs (port 4000)
    src/routes/credential-routes.ts  ← /issue-credential, /create-schema, /credential-definition
    server.ts                      ← NOT BUILT YET

  doctor-agent/                    ← Verifies identity, issues medical document VCs (port 4002)
    src/routes/medical-routes.ts   ← /issue-medical-credential, /issue-prescription
    server.ts                      ← NOT BUILT YET

  pharmacy-agent/                  ← Verifies identity + prescription (port 4004)
    src/routes/pharmacy-routes.ts  ← /verify-patient-identity, /verify-prescription
    server.ts                      ← NOT BUILT YET

demo/credo/                        ← LEGACY working agent system (keep as reference)
  server.ts                        ← Single file running all 3 agents on :4000/:4002/:4004
  agent.ts                         ← Original BaseAgent (replaced by agents/shared/agent-base.ts)
  module.ts, network.ts, types.ts  ← Originals (replaced by agents/shared/)
  src/routes/document-routes.ts    ← Document upload → MongoDB → SHA-256 → VC issuance
  src/services/document-service.ts ← DocumentService class
```

---

### BACKEND — Storage / Data

```
dwn/                               ← Decentralized Web Node — patient owns their data
  patient-node/                    ← Patient's DWN node (port 5000) — NOT BUILT YET
    src/
      interfaces/
        records.ts                 ← Records interface: createRecord, readRecord, updateRecord, deleteRecord
        permissions.ts             ← Permissions interface: grantPermission, revokePermission, checkPermission
                                      grantPermission() also issues Consent Receipt VC on Indy
        protocols.ts               ← Protocols interface: attribute-level field rules per actor role
      storage/
        leveldb.ts                 ← LevelDB adapter: get, put, del, scan (all interfaces use this)
      encryption/
        aes-service.ts             ← AES-256-GCM encrypt/decrypt + key wrapping (patient public key)
      routes/
        record-routes.ts           ← Express: /dwn/records/*
        permission-routes.ts       ← Express: /dwn/permissions/*
        protocol-routes.ts         ← Express: /dwn/protocols/*
    server.ts                      ← Express entry point, mounts all routes
    package.json + tsconfig.json

audit/                             ← Audit trail — logs every DWN operation
  src/services/audit-service.ts    ← AuditService: record(), getByActor(), verify() — IN-MEMORY ONLY (needs SQLite)
  prisma/schema.prisma             ← AuditLog model only (SQLite provider — needs update from mongodb)
```

---

### BACKEND — Security / Crypto

```
crypto/
  encryption/src/                  ← Hashing + signing utilities (written, not wired yet)
    hash-utils.ts                  ← sha256(), verifyHash(), generateId()
    signing-utils.ts               ← JWT signing: document / audit / consent (3 separate secrets)
    verify-utils.ts                ← verifyDocumentIntegrity() — hash + signature + content check

  sss/src/                         ← Shamir Secret Sharing + MPOA — NOT BUILT YET
    key-splitter.ts                ← splitMEK(mek, n=5, k=3) → 5 shares
    key-reconstructor.ts           ← reconstructKey(shares[]) → original MEK
    mpoa-controller.ts             ← Multi-party approval: initiate, approve, release key
    routes/sss-routes.ts           ← REST API: /sss/split, /sss/recovery/*

consent/                           ← REMOVED — consent is now the DWN Permissions interface
```

---

### INFRASTRUCTURE / TOOLING

```
infra/                             ← NOT BUILT YET (last thing to build)
  docker-compose.yml               ← Starts all services in correct order

benchmark/                         ← NOT BUILT YET
  run-experiments.ts               ← Runs all 8 experiments, outputs results table
  results/                         ← JSON + Markdown output files

tsconfig.json                      ← Root TypeScript config (VS Code type checking for new files)
package.json                       ← Root package — @types/* + dotenv + jsonwebtoken (shared runtime deps for crypto/encryption/)
```

---

## DWN Record Schema

```typescript
// Records (stored in LevelDB under key: `record:{recordId}`)
{
  recordId: string,          // UUID
  patientDID: string,        // "did:indy:bcovrin:test:..."
  recordType: string,        // "medical" | "prescription" | "lab_report"
  protocol: string,          // which protocol governs this record type
  encryptedData: string,     // AES-256-GCM ciphertext (base64)
  encryptedKey: string,      // AES key wrapped with patient public key (base64)
  iv: string,                // GCM initialization vector (base64)
  tag: string,               // GCM auth tag (base64)
  hash: string,              // SHA-256 of plaintext (integrity)
  createdAt: string,         // ISO8601
  updatedAt: string          // ISO8601
}

// Permissions (stored in LevelDB under key: `permission:{permissionId}`)
{
  permissionId: string,
  patientDID: string,
  grantedToDID: string,
  recordType: string,        // "medical" | "prescription" | "lab_report"
  allowedFields: string[],   // ["prescription"] or ["diagnosis", "labResults"]
  purpose: string,           // "treatment" | "dispensing" | "insurance"
  grantedAt: string,
  expiresAt: string | null,
  revokedAt: string | null,
  consentVCId: string        // ID of Consent Receipt VC on Indy
}

// Protocols (stored in LevelDB under key: `protocol:{name}`)
{
  name: string,              // "MedicalRecord" | "Prescription" | "InsuranceClaim"
  actorRole: string,         // "doctor" | "pharmacist" | "insurer"
  allowedFields: string[]    // fields this role may read
}
```

---

## Build Status

| Module                                | Status              | Notes                                                          |
| ------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `agents/shared/`                      | Done                | BaseAgent, types, module config, network config, cache, routes |
| `agents/government-agent/src/routes/` | Done                | credential-routes.ts — no server.ts yet                        |
| `agents/doctor-agent/src/routes/`     | Done                | medical-routes.ts — no server.ts yet                           |
| `agents/pharmacy-agent/src/routes/`   | Done                | pharmacy-routes.ts — no server.ts yet                          |
| `crypto/encryption/src/`              | Done                | hash-utils, signing-utils, verify-utils — not wired in         |
| `audit/src/services/audit-service.ts` | Done                | SQLite via Prisma — persistent, signed JWT events              |
| `audit/prisma/schema.prisma`          | Done                | SQLite provider, AuditLog only — MongoDB types removed         |
| `audit/package.json`                  | Done                | @prisma/client ^5, dotenv, jsonwebtoken                        |
| `audit/tsconfig.json`                 | Done                | Extends root tsconfig                                          |
| `apps/web/src/`                       | Done                | apiService, hooks, utils, 3 components — no pages yet          |
| `crypto/sss/`                         | Not started         | Module 7 — Days 3–4                                            |
| `dwn/patient-node/`                   | Not started         | Full DWN — Modules 5, 6, 8 — Days 5–13                         |
| `consent/`                            | Removed             | Folded into DWN Permissions interface                          |
| `benchmark/`                          | Not started         | Module 10 — Day 18                                             |
| Per-agent `server.ts`                 | Not started         | Days 14–15                                                     |
| `infra/docker-compose.yml`            | Not started         | Last thing to build                                            |

---

## 20-Day Build Order (Module by Module)

Build one module per session. Do not start the next until user approves.

| Day   | Module                               | Files                                                                                                                          |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| ~~1–2~~ | ~~Audit → SQLite (Module 9)~~      | ~~Done~~ — `audit/src/services/audit-service.ts` swapped to Prisma, `audit.db` created, types clean |
| 3–4   | SSS + MPOA (Module 7)                | `crypto/sss/src/key-splitter.ts`, `key-reconstructor.ts`, `mpoa-controller.ts`, `routes/sss-routes.ts`                         |
| 5–6   | DWN Storage + Encryption             | `dwn/patient-node/src/storage/leveldb.ts`, `dwn/patient-node/src/encryption/aes-service.ts`                                    |
| 7–8   | DWN Records Interface (Module 5)     | `dwn/patient-node/src/interfaces/records.ts`, `routes/record-routes.ts`                                                        |
| 9–10  | DWN Permissions Interface (Module 8) | `dwn/patient-node/src/interfaces/permissions.ts`, `routes/permission-routes.ts` — includes Consent VC issuance on Indy         |
| 11–12 | DWN Protocols Interface (Module 4)   | `dwn/patient-node/src/interfaces/protocols.ts`, `routes/protocol-routes.ts` — attribute-level selective sharing                |
| 13    | DWN server.ts + package.json         | `dwn/patient-node/server.ts`, `package.json`, `tsconfig.json`                                                                  |
| 14–15 | Agent server.ts files                | `agents/government-agent/server.ts`, `agents/doctor-agent/server.ts`, `agents/pharmacy-agent/server.ts`                        |
| 16–17 | Wire agents → DWN                    | `agents/doctor-agent/src/routes/medical-routes.ts` — after issuing VC, call DWN createRecord. Wire permission grant into flow. |
| 18    | Benchmark (Module 10)                | `benchmark/run-experiments.ts` — all 8 experiments                                                                             |
| 19    | End-to-end testing                   | Full flow: DID → VC → DWN create → permission grant → selective read → revoke → audit                                          |
| 20    | Documentation                        | README, CONTEXT.md, CLAUDE.md final update                                                                                     |

---

## Code Quality Rules (Non-Negotiable)

- **Never use deprecated APIs, options, or patterns unless every non-deprecated alternative has been tried and failed.** If something is deprecated, find the current replacement first. Using `ignoreDeprecations`, `@ts-ignore`, `any`, or similar suppressors to silence a warning is not a fix — it is a deferred problem. Document the reason explicitly if a suppressor is truly unavoidable.
- **Never introduce a workaround for a problem that has a clean solution.** Band-aids accumulate and become load-bearing. Fix the root cause.
- Before using any library, check whether it is still actively maintained and whether a better-maintained alternative exists.

---

## Known Constraints

- `demo/credo/.env` has live MongoDB credentials committed to git — **never touch that file**
- Each new agent must have its **own DID and seed** — the old PoC shared them (bug)
- `apps/web/` needs `@types/node` installed for `process.env` TypeScript support
- Signing secrets (`DOCUMENT_SIGNING_SECRET`, `AUDIT_SIGNING_SECRET`, `CONSENT_SIGNING_SECRET`) must be set in `.env` — `signing-utils.ts` throws on startup if missing
- `shamir-secret-sharing` npm package needs to be installed for Module 7
- `level` npm package needed for LevelDB in DWN node (Days 5–13)
- Prisma SQLite requires `prisma generate` after schema change + no `@db.ObjectId` annotations
- Consent management uses DWN Permissions interface + Consent Receipt VC on Indy — NOT a smart contract, NOT a separate service
- Hyperledger Indy has NO smart contract layer — any "smart contract" requirement is fulfilled by signed VCs
- `agents/shared/db-singleton.ts` has been deleted — do not recreate it, agents do not touch any database

---

## Source of Truth Files

- `CONTEXT.md` — session context, decisions, open questions
- `CLAUDE.md` — this file (code map, build status, constraints, build order)
- `README.md` — project overview
  x

---

## How to Update This File

After each working session:

1. Mark the completed module as Done in the Build Status table
2. Cross off the day in the 20-Day Build Order
3. Add any new constraints discovered
4. Note any open decisions that were resolved
