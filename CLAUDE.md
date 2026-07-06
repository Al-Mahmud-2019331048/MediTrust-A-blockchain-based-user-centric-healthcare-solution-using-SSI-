# CLAUDE.md — MediTrust Project Guide

> Read this file at the start of every session. Update it whenever a decision is made, a module is completed, or a constraint is discovered.
> Implementation pace: one module at a time, over 20 days. Do NOT implement anything the user has not explicitly approved for that session.

## How to Present Changes for Approval

Before making any code change, file edit, or running any Bash command that changes something (installs, deletes, commits, pushes, generates, migrates), always provide:

1. **What I'm doing** — plain English description of the change, no jargon
2. **Why** — what problem it solves or why it is needed
3. **What files are affected** — which files are being created, modified, or deleted
4. **What stays the same** — what is not being touched
5. **Any risks or things to watch** — anything that could go wrong or needs attention

**Exception:** Read-only commands (`git status`, `git log`, `ls`, `tsc --noEmit`, `git diff`) look at things and change nothing — no approval needed for these.

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

| #   | Module                                | What It Proves                                                                              | Status                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | SSI Identity Layer                    | DID creation, key pairs, DID registration on Indy ledger                                    | Exists in `demo/credo/`                                                     |
| 2   | Verifiable Credential System          | Hospital issues VC, patient stores in Bifold, doctor verifies                               | Exists in `demo/credo/`                                                     |
| 3   | Digital Wallet                        | Simple wallet API, encrypted local credential storage (Askar at rest)                      | Bifold handles this; agent wallet via Credo-TS/Askar                        |
| 4   | Selective Sharing (Core Contribution) | Attribute-level ZKP disclosure + DWN Protocol field filtering + W3C VP generation          | **Done** (Days 11–12) — Protocol field filtering enforced on reads; W3C VP (JWT-based) generated from AnonCreds proof records |
| 5   | DWN Implementation                    | Records + Permissions + Protocols interfaces, LevelDB storage, hash anchored on Indy       | Storage + Records + Permissions + Protocols **Done** (Days 5–12); on-chain anchoring is a placeholder until Days 16–17 |
| 6   | Encryption Layer                      | AES-256-GCM encrypt before DWN store, key wrapping                                         | **Done** — `dwn/patient-node/src/encryption/aes-service.ts` (Days 5–6); key-wrap uses placeholder KEK until patient wallet/DID exists |
| 7   | MPOA + SSS Key Recovery               | Split MEK (5,3), guardian approval flow, reconstruct from threshold                        | **Done** — `crypto/sss/src/`                                                |
| 8   | Consent Management                    | DWN Permissions (enforcement) + Verifiable Consent Receipt VC on Indy (on-chain proof)     | **Done** (folded into Module 5) — Days 9–10; consent receipt is a real signed JWT, on-chain anchoring deferred to Days 16–17 |
| 9   | Audit Trail                           | Log every DWN operation, persistent, signed — SQLite primary + selective Indy VC anchoring | **Done** (SQLite); on-chain anchoring for high-significance events Day 16–17 |
| 10  | Security Evaluation                   | Run 8 experiments + attack simulations, produce metrics table                               | **NOT BUILT** — Day 18                                                      |

---

## The 8 Required Experiments

| Experiment                     | Metric   | How to Measure                                                          |
| ------------------------------ | -------- | ----------------------------------------------------------------------- |
| VC issuance time               | ms       | `POST /issue-credential` → `credential-issued` state                    |
| VC verification time           | ms       | `POST /send-proof-request` → `isVerified: true`                         |
| Blockchain transaction latency | seconds  | Schema/credDef registration on BCovrin                                  |
| DWN storage overhead           | KB/MB    | Encrypted record size vs plaintext size ratio                           |
| Selective sharing overhead     | ms       | Full record retrieval vs Protocol-filtered retrieval                    |
| SSS recovery time              | ms       | `initiateRecovery` to MEK reconstructed (3 shares) — already captured  |
| Key recovery success rate      | %        | N runs with valid threshold → pass; N runs with <3 shares → correct fail |
| Access revocation time         | seconds  | `DELETE /revokeAccess` → subsequent read returns 403                    |

**Bonus metric** (already built): SSS split time (ms) via `splitTimeMs` in `splitMEK()`.

**Attack simulation scenarios** (Day 18 benchmark — 5 scripted cases):
1. Read record without a permission grant → expect 403
2. SSS reconstruction with only 2 shares → expect thrown error
3. MPOA recovery attempt before all 3 approvals → expect 403
4. Expired MPOA request reconstruction attempt → expect 403 (status auto-set to `'expired'`)
5. Tampered audit entry verification → `AuditService.verify()` returns `false`

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
| Encryption              | AES-256-GCM at rest + per-record key wrapped by patient public key (placeholder KEK for now — see Known Constraints) |
| SSS threshold           | 5 shares total, any 3 reconstruct the MEK                                                    |
| SSS share holders       | Share 1: patient device, 2: hospital, 3: trusted family, 4: backup server, 5: recovery agent |
| MPOA approvals required | Patient + Hospital + Guardian (threshold = 3) — `approverRole: 'patient' \| 'hospital' \| 'guardian'` |
| Smart contracts         | Out of scope — Indy has no VM layer                                                          |
| Legacy PoC              | Keep for reference, don't delete or run in parallel                                          |
| SSS library             | `shamir-secret-sharing` npm package (pure JS, GF(2^8))                                       |
| DWN URL (agents → DWN) | `PATIENT_DWN_URL=http://localhost:5050` env var in each agent — PoC runs fully local, all services on one machine, no discovery mechanism needed. Port is 5050, not 5000, specifically to avoid macOS AirPlay Receiver's default use of 5000 |
| Hospital role in PoC   | Doctor agent (port 4002) is the hospital's clinical representative. Hospital also participates as MPOA approver (`approverRole: 'hospital'`) and SSS share holder (share 2) — both via API calls, no separate hospital server |
| Protocol role binding    | `Permission.actorRole` is only trusted when backed by `roleProofRecordId` — a verified AnonCreds proof (existing agent proof-request flow) that the grantedToDID holds a `ProfessionalRoleCredential` (attributes: `role`, `licenseId`, `issuedAt`). No bare self-reported role string is accepted. |
| VP format                | JWT-based W3C Verifiable Presentation (not JSON-LD/LD-Proof), consistent with this repo's JWT-only signing convention. Signed server-side with `VP_SIGNING_SECRET` — real patient-DID-based signing deferred until patient wallet/DID work lands. |

---

## Open Decisions

**VP output wiring — RESOLVED and BUILT (Days 11–12):** A W3C Verifiable Presentation is generated from the AnonCreds proof record via `ProtocolsInterface.generateVerifiablePresentation()`, signed as a JWT via `signVerifiablePresentation()`.

**Protocol role binding — RESOLVED and BUILT (Days 11–12):** Role claims are backed by a verified AnonCreds proof (`roleProofRecordId`) rather than a self-reported string, checked via `verifyActorRoleProof()` against an agent's existing `GET /proof-data/:id` endpoint. The `ProfessionalRoleCredential` schema itself is not yet registered on-chain — that's an operational step blocked on Days 14–15 (agent server.ts) existing; see Known Constraints.

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
  patient-node/                    ← Patient's DWN node (port 5050) — storage + encryption + Records + Permissions + Protocols Done
    src/
      interfaces/
        records.ts                 ← Done — RecordsInterface: createRecord, readRecord, queryRecords, decryptRecord
                                      createRecord() computes a real SHA-256 hash; integrityVCId is a
                                      local placeholder string until Days 16–17 wire in real on-chain Indy VC issuance
                                      decryptRecord() (Days 9–10) unwraps + decrypts; keeps the placeholder KEK private to this file
                                      updateRecord/deleteRecord deferred — not in CLAUDE.md's canonical required-functions list
        permissions.ts             ← Done — PermissionsInterface: grantPermission, revokePermission, checkPermission, listPermissions
                                      grantPermission() issues a real signConsentReceipt() JWT as consentVCId — on-chain
                                      Indy anchoring deferred to Days 16–17, same treatment as integrityVCId
                                      revokePermission() accepts a permissionId or a {patientDID,grantedToDID,recordType}
                                      triple (revokes all active matches); checkPermission has NO self-read exemption —
                                      that lives only in record-routes.ts's queryRecord handler
                                      (Days 11–12) grantPermission() now also requires roleProofRecordId whenever
                                      actorRole is supplied, verified via verifyActorRoleProof() before the grant is stored
        protocols.ts                ← Done (Days 11–12) — ProtocolsInterface: defineProtocol, getProtocol, listProtocols,
                                      applyFieldFilter (pure field-redaction helper, empty allowedFields = unrestricted);
                                      also generateVerifiablePresentation() — builds + signs a JWT-based W3C VP from an
                                      AnonCreds proof record's revealed attributes. Keyed by protocol:{name} (one row per
                                      name, matching CLAUDE.md's 1:1 examples), not per name+role
        role-verification.ts        ← Done (Days 11–12) — verifyActorRoleProof(): plain HTTP GET to an agent's existing
                                      GET /proof-data/:id, confirms isVerified + the revealed "role" attribute matches
                                      the claimed actorRole. Real logic, but only exercised against a mock server this
                                      session — no agent has a running HTTP server until Days 14–15
      storage/
        leveldb.ts                 ← Done — LevelDBAdapter: get, put, del, scan, close (all future interfaces use this)
      encryption/
        aes-service.ts             ← Done — AES-256-GCM encrypt/decrypt + wrapKey/unwrapKey (placeholder KEK)
      routes/
        record-routes.ts           ← Done — Express: POST /storeRecord, GET /queryRecord (mounted at /dwn/* by server.ts, Day 13)
                                      queryRecord now enforces permission checks (Days 9–10): requesterDID required,
                                      patient's own reads always allowed, others need an active grant (403 on single-record
                                      denial, silently excluded on list queries); authorized records are decrypted,
                                      accessPolicy is real (DID-keyed, not role-keyed — no role registry exists)
                                      (Days 11–12) non-self authorized reads now get field-level redaction applied —
                                      Permission.allowedFields intersected with a matching Protocol.allowedFields
                                      (by record.protocol + the permission's actorRole) via ProtocolsInterface.applyFieldFilter
        permission-routes.ts       ← Done — Express: POST /shareRecord, DELETE /revokeAccess (mounted at /dwn/* by server.ts, Day 13)
                                      (Days 11–12) shareRecord accepts actorRole/roleProofRecordId/verifierAgentBaseUrl;
                                      400 if actorRole given without roleProofRecordId, 403 if role-proof verification fails
        protocol-routes.ts         ← Done (Days 11–12) — Express: POST /dwn/protocols/define, GET /dwn/protocols/query,
                                      POST /dwn/protocols/generate-vp (mounted at /dwn/protocols/* by server.ts, Day 13)
    server.ts                      ← Done (Day 13) — Express entry point: dotenv.config() first, express.json({limit:'25mb'})
                                      (base64 images/PDFs exceed the 100kb default), mounts recordRouter+permissionRouter
                                      at /dwn, protocolRouter at /dwn/protocols; GET /health; 404 handler + final
                                      error-handling middleware (catches malformed-JSON body-parse errors); port via
                                      DWN_PORT env var (default 5050, not 5000 — see Known Constraints); SIGINT/SIGTERM close LevelDBAdapter before exit.
                                      No cors — nothing browser-based calls this server, only agents (server-to-server).
                                      Run via `npm run dwn:dev` (added tsx as a devDependency — the shared root
                                      tsconfig's module:ESNext/moduleResolution:bundler settings, needed for the Next.js
                                      frontend, aren't directly runnable by plain ts-node without a manual override; tsx
                                      avoids that friction). Smoke-tested end-to-end: storeRecord → self-read →
                                      protocols/define, all real (not throwaway/mocked) this time.
    tsconfig.json                  ← Done, extends root — no separate package.json needed

audit/                             ← Audit trail — logs every DWN operation
  src/services/audit-service.ts    ← AuditService: record(), getByActor(), verify(), toCredentialAttributes() — SQLite via Prisma
                                      toCredentialAttributes() formats any event for on-chain VC issuance (used Day 16–17)
  prisma/schema.prisma             ← AuditLog model (SQLite provider, 4 indexes — Done)
```

---

### BACKEND — Security / Crypto

```
crypto/
  encryption/src/                  ← Hashing + signing utilities (written, not wired yet)
    hash-utils.ts                  ← sha256(), verifyHash(), generateId()
    signing-utils.ts               ← JWT signing: document / audit / consent / VP (4 separate secrets — VP added Days 11–12)
    verify-utils.ts                ← verifyDocumentIntegrity() — hash + signature + content check

  sss/src/                         ← Shamir Secret Sharing + MPOA — Done
    key-splitter.ts                ← splitMEK(mek, n=5, k=3) → 5 shares + splitTimeMs
    key-reconstructor.ts           ← reconstructKey(shares[]) → original MEK + reconstructTimeMs
    mpoa-controller.ts             ← Multi-party approval: patient + hospital + guardian threshold
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

**Required DWN functions (from PoC requirements):**
`createRecord()` / `storeRecord()` / `queryRecord()` / `shareRecord()` / `revokeAccess()`
Internal names: createRecord, readRecord, grantPermission, revokePermission — HTTP routes expose the required names.

```typescript
// Records (stored in LevelDB under key: `record:{recordId}`)
{
  recordId: string,          // UUID
  patientDID: string,        // "did:indy:bcovrin:test:..."
  recordType: string,        // "medical" | "prescription" | "lab_report"
  protocol: string,          // which protocol governs this record type
  contentType: string,       // "application/json" | "application/pdf" | "image/jpeg" | "image/png"
  fileName: string | null,   // original filename for binary files, null for JSON records
  fileSize: number,          // byte size of plaintext before encryption
  encryptedData: string,     // AES-256-GCM ciphertext (base64)
  encryptedKey: string,      // AES key wrapped with patient public key (base64)
  iv: string,                // GCM initialization vector (base64)
  tag: string,               // GCM auth tag (base64)
  hash: string,              // SHA-256 of plaintext (integrity) — also anchored on Indy as VC
  integrityVCId: string,     // Indy VC ID containing hash + recordId (on-chain proof)
  createdAt: string,         // ISO8601
  updatedAt: string          // ISO8601
}
// API read responses include a computed accessPolicy field derived from Permissions:
// { ..record, accessPolicy: { "doctor": true, "insurance": false } }

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
  consentVCId: string,       // ID of Consent Receipt VC on Indy
  actorRole?: string,        // "doctor" | "pharmacist" | "insurer" — only trusted alongside roleProofRecordId (Days 11-12)
  roleProofRecordId?: string // verified AnonCreds proof backing actorRole; grantPermission() rejects actorRole without this
}

// Protocols (stored in LevelDB under key: `protocol:{name}` — one row per name, Days 11-12)
{
  name: string,              // "MedicalRecord" | "Prescription" | "InsuranceClaim"
  actorRole: string,         // "doctor" | "pharmacist" | "insurer"
  allowedFields: string[],   // fields this role may read; empty = unrestricted
  createdAt: string,
  updatedAt: string
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
| `audit/package.json`                  | N/A — intentional   | Deliberately consolidated into root `package.json` — monorepo structure, no per-module package files |
| `audit/tsconfig.json`                 | Done                | Extends root tsconfig                                          |
| `apps/web/src/`                       | Done                | apiService, hooks, utils, 3 components — no pages yet          |
| `crypto/sss/src/`                     | Done                | key-splitter, key-reconstructor, mpoa-controller, sss-routes — guardian threshold |
| `dwn/patient-node/src/storage/leveldb.ts` | Done            | Generic LevelDBAdapter (get/put/del/scan/close) — no domain knowledge of record/permission schemas |
| `dwn/patient-node/src/encryption/aes-service.ts` | Done     | AES-256-GCM encrypt/decrypt (Buffer + string input) + wrapKey/unwrapKey (placeholder KEK) |
| `dwn/patient-node/tsconfig.json`      | Done                | Extends root tsconfig, mirrors `audit/tsconfig.json`            |
| `dwn/patient-node/src/interfaces/records.ts` | Done         | createRecord/readRecord/queryRecords/decryptRecord; real SHA-256 hash; placeholder integrityVCId; update/delete deferred |
| `dwn/patient-node/src/routes/record-routes.ts` | Done       | POST /storeRecord, GET /queryRecord; queryRecord now permission-gated + decrypts on authorized read |
| `dwn/patient-node/src/interfaces/permissions.ts` | Done     | grantPermission/revokePermission/checkPermission/listPermissions; consentVCId is a real signConsentReceipt() JWT; actorRole now requires a verified roleProofRecordId (Days 11–12) |
| `dwn/patient-node/src/routes/permission-routes.ts` | Done   | POST /shareRecord, DELETE /revokeAccess; shareRecord now accepts actorRole/roleProofRecordId/verifierAgentBaseUrl |
| `dwn/patient-node/src/interfaces/protocols.ts` | Done       | ProtocolsInterface (defineProtocol/getProtocol/listProtocols/applyFieldFilter) + generateVerifiablePresentation — Days 11–12 |
| `dwn/patient-node/src/interfaces/role-verification.ts` | Done | verifyActorRoleProof() — real logic, tested against a mock proof-data server only (no live agent yet) |
| `dwn/patient-node/src/routes/protocol-routes.ts` | Done    | POST /dwn/protocols/define, GET /dwn/protocols/query, POST /dwn/protocols/generate-vp — Days 11–12 |
| `dwn/patient-node/server.ts`          | Done                | Day 13 — mounts all 3 routers, /health, 404 + error middleware, graceful shutdown; smoke-tested live (not throwaway) |
| `consent/`                            | Removed             | Folded into DWN Permissions interface                          |
| `benchmark/`                          | Not started         | Module 10 — Day 18                                             |
| Per-agent `server.ts`                 | Not started         | Days 14–15                                                     |
| `infra/docker-compose.yml`            | Not started         | Last thing to build                                            |
| `ProfessionalRoleCredential` schema (government agent) | Not registered | Attributes fixed (`role`, `licenseId`, `issuedAt`); registration blocked on Days 14–15 (agent server.ts) |

---

## 20-Day Build Order (Module by Module)

Build one module per session. Do not start the next until user approves.

| Day     | Module                               | Files + Gap Resolutions                                                                                                                                                               |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~1–2~~ | ~~Audit → SQLite (Module 9)~~        | ~~Done~~ — `audit/src/services/audit-service.ts` swapped to Prisma, `audit.db` created, types clean                                                                                  |
| ~~3–4~~ | ~~SSS + MPOA (Module 7)~~            | ~~Done~~ — `key-splitter.ts`, `key-reconstructor.ts`, `mpoa-controller.ts`, `sss-routes.ts`; guardian rename applied                                                                  |
| ~~5–6~~ | ~~DWN Storage + Encryption~~          | ~~Done~~ — `leveldb.ts` (generic KV adapter), `aes-service.ts` (encrypt/decrypt accepts `Buffer` or `string`; wrapKey/unwrapKey use a placeholder KEK — see Known Constraints) |
| ~~7–8~~ | ~~DWN Records Interface (Module 5)~~ | ~~Done~~ — `records.ts` (createRecord/readRecord/queryRecords, accepts `Buffer` or JSON string, real SHA-256 hash, placeholder `integrityVCId`), `record-routes.ts` (`POST /storeRecord`, `GET /queryRecord`, ciphertext-only reads); update/delete deferred |
| ~~9–10~~ | ~~DWN Permissions Interface (Module 8)~~ | ~~Done~~ — `permissions.ts` (grantPermission/revokePermission/checkPermission/listPermissions, real `signConsentReceipt()` JWT as `consentVCId`), `permission-routes.ts` (`POST /shareRecord`, `DELETE /revokeAccess`); `record-routes.ts`'s `queryRecord` now enforces permission checks + decrypts on authorized read |
| ~~11–12~~ | ~~DWN Protocols Interface (Module 4)~~ | ~~Done~~ — `protocols.ts` (defineProtocol/getProtocol/listProtocols/applyFieldFilter + generateVerifiablePresentation), `role-verification.ts` (verifyActorRoleProof), `protocol-routes.ts` (`/dwn/protocols/*`); `permissions.ts`/`record-routes.ts` wired for role-verified field redaction; `dwn/provider-node/` deleted |
| ~~13~~  | ~~DWN server.ts~~                    | **Done** — `dwn/patient-node/server.ts` (no separate package.json, root covers all deps); added `tsx` as a root devDependency + `dwn:dev` npm script to actually run it; smoke-tested live end-to-end |
| 14–15   | Agent server.ts files                | `agents/government-agent/server.ts`, `agents/doctor-agent/server.ts`, `agents/pharmacy-agent/server.ts`                                                                              |
| 16–17   | Wire agents → DWN                    | `agents/doctor-agent/src/routes/medical-routes.ts` — after issuing VC, call DWN createRecord; agents read `PATIENT_DWN_URL` from `.env` to call DWN HTTP API; **GAP:** call `AuditService.toCredentialAttributes()` + government agent to issue on-chain audit VC for key splits, consent grants/revocations |
| 18      | Benchmark (Module 10)                | `benchmark/run-experiments.ts` — all 8 experiments; **GAP:** add key recovery success rate (%); add 5 attack simulation scenarios                                                     |
| 19      | End-to-end testing                   | Full flow: DID → VC → DWN store → shareRecord → selective read → revokeAccess → audit → integrity VC verification                                                                    |
| 20      | Documentation                        | README, CONTEXT.md, CLAUDE.md final update                                                                                                                                            |

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
- `shamir-secret-sharing` npm package installed at root — already done
- `level` npm package installed at root (`^10.0.0`) — done Days 5–6
- `level@10`'s `get()` resolves to `undefined` for a missing key — it does NOT throw a `LEVEL_NOT_FOUND` error (verified by direct testing against the installed version, contradicting the initially-assumed abstract-level behavior). `LevelDBAdapter.get()` in `leveldb.ts` checks for `undefined` and returns `null`; do not reintroduce a try/catch on error code for this.
- `dwn/patient-node/src/storage/leveldb.ts`'s data directory is resolved with `path.resolve(__dirname, ...)`, anchored to the file's own location — NOT `process.cwd()`. This was a real bug caught during Day 5–6 testing (running from a different working directory created a stray nested data folder). `DWN_DATA_DIR` env var, if set, is still resolved relative to `process.cwd()` (standard env-var-path behavior) — only the default path is cwd-independent.
- Prisma SQLite requires `prisma generate` after schema change + no `@db.ObjectId` annotations
- Consent management uses DWN Permissions interface + Consent Receipt VC on Indy — NOT a smart contract, NOT a separate service
- Hyperledger Indy has NO smart contract layer — any "smart contract" requirement is fulfilled by signed VCs
- `agents/shared/db-singleton.ts` has been deleted — do not recreate it, agents do not touch any database
- `dwn/provider-node/` exists on disk but is not in the architecture — delete before Day 13
- `audit/package.json` intentionally does not exist — all deps consolidated into root `package.json` (monorepo structure); do not create per-module package files
- Doctor agent writes to patient DWN without a permission grant — doctor is the author of the clinical record; patient sovereignty is enforced at the READ layer only
- All reads require explicit patient permission grant via `shareRecord` — read without valid grant returns 403
- `PATIENT_DWN_URL=http://localhost:5050` must be set in each agent's `.env` — all agents call the DWN via this URL; no discovery mechanism needed for local PoC. (Port is 5050, not the originally-documented 5000 — changed Day 13 to sidestep a real macOS port conflict, see below.)
- `aes-service.ts`'s `wrapKey()`/`unwrapKey()` are KEK-agnostic — they accept any 32-byte key `Buffer` with no opinion on where it comes from. No patient public-key infrastructure exists yet (patient has no Credo-TS wallet/DID of their own). Real DID-derived key wrapping is deferred until patient wallet/DID work happens in a later session — until then, callers must supply a placeholder KEK.
- `records.ts`'s `getPlaceholderKEK()` reads a 32-byte base64 key from `DWN_MASTER_KEK` in `.env` — throws with a generation one-liner if unset or wrong length, matching `signing-utils.ts`'s secret-handling style. This is the placeholder KEK consumer referenced above; do not remove until real patient-DID-derived key wrapping replaces it.
- `DWNRecord.integrityVCId` (in `agents/shared/types/index.ts`) is a locally-generated placeholder string (`local-placeholder-{uuid}`), NOT a real on-chain Indy VC ID — no agent has a running Credo-TS wallet/HTTP server until Days 14–15, and even then VC issuance requires a DIDComm connection the wallet-less DWN patient-node doesn't have. Real on-chain issuance is deferred to Days 16–17, where the doctor agent (which does have a wallet) is expected to call back into the DWN with a real VC ID. The record's `hash` field IS a real SHA-256 of the plaintext today — only the on-chain anchor is deferred.
- `GET /dwn/queryRecord` now decrypts and returns a `data` field (JSON-parsed for `application/json`, base64 for binary types) instead of raw ciphertext, but only for authorized reads — this was resolved in Days 9–10 (previously ciphertext-only, pending Permissions). `readRecord()`/`queryRecords()` on `RecordsInterface` themselves still return the raw `DWNRecord` unchanged (ciphertext intact) — decryption only happens via the new `RecordsInterface.decryptRecord()`, called from the route layer after a permission check passes.
- The patient's own reads of their own records via `GET /dwn/queryRecord` always succeed, no permission grant needed (`requesterDID === patientDID` bypass, checked in the route handler). `PermissionsInterface.checkPermission()` itself has NO such exemption — it only checks stored grants. Permissions (`grantedToDID`) are for granting access to *other* parties, not the record owner.
- `GET /dwn/queryRecord`'s `requesterDID` query param is now **required** (400 if missing) — was previously optional/audit-only. This is a small breaking change to the route's Days 7–8 contract, necessary because there's no way to evaluate the self-read exemption or a permission check without knowing who's asking.
- `Permission.consentVCId` (in `agents/shared/types/index.ts`) is a REAL JWT from `signConsentReceipt()` (`crypto/encryption/src/signing-utils.ts`), not a bare placeholder string like `DWNRecord.integrityVCId` — genuine, independently verifiable cryptographic proof of consent exists today (off-chain). Only the "on Indy" on-chain anchoring is deferred to Days 16–17. Requires `CONSENT_SIGNING_SECRET` to be set in `.env` (already a required secret per the constraint above) — `grantPermission()` now has its first real caller.
- The computed `accessPolicy` field in `queryRecord` responses is keyed by `grantedToDID` (a DID string), NOT by role name like CLAUDE.md's illustrative `{"doctor": true}` example — the schema has no role registry, only DIDs. This is a deliberate, documented deviation, not a schema change.
- `DELETE /dwn/revokeAccess` is the correct verb (CLAUDE.md's Experiments table previously said `POST /revokeAccess`, contradicting the file map's `DELETE` — the Experiments table line has been corrected to match).
- `express` was missing as a runtime dependency until Days 7–8 (only `@types/express` existed) — added to root `package.json` `dependencies`. `crypto/sss/src/routes/sss-routes.ts` could type-check but not actually run before this fix; both it and `record-routes.ts` are runnable now.
- `updateRecord`/`deleteRecord` are not built — CLAUDE.md's own canonical "Required DWN functions" line only lists `createRecord()`/`storeRecord()`/`queryRecord()`/`shareRecord()`/`revokeAccess()`; update/delete only ever appeared in an aspirational file-map comment. Add `document_updated`/`document_deleted` to `AuditEventType` if/when they're actually built.
- **`RecordsInterface.queryRecords()` / `PermissionsInterface.listPermissions()` skip (rather than throw on) any individual corrupted LevelDB entry**, logging a `console.warn` with the offending key. Fixed after deep-testing found that a single malformed JSON value anywhere in the store previously threw an uncaught error that broke list/query reads — and, since `checkPermission()` calls `listPermissions()` internally, broke **every authenticated read node-wide**, not just the corrupted record's own patient. `RecordsInterface.readRecord()` (single-ID lookup) and `PermissionsInterface.revokePermission()`'s by-`permissionId` path still throw a clear, isolated error when the *specifically requested* resource itself is corrupted — that's a real, resource-specific failure worth surfacing, not something to silently paper over.
- **`approveRecovery()` in `mpoa-controller.ts` validates `approverRole` against `REQUIRED_APPROVER_ROLES` before accepting an approval.** Fixed after deep-testing found a raw HTTP body could send any string as `approverRole` (TypeScript's union type is compile-time only) — a bogus/typo'd role was silently stored but could never contribute to the 3-role threshold, permanently stranding that recovery request at `'pending'` with no error telling the caller why. Now rejected with a clear `400` naming the valid roles.
- **`PermissionsInterface.revokePermission()` uses a per-key in-memory async mutex (`withLock`, private to `permissions.ts`)** to serialize concurrent revokes of the same `permissionId` or the same `{patientDID, grantedToDID, recordType}` triple. Fixed after deep-testing found revoke's read-then-write (an `await` point between `LevelDBAdapter.get` and `.put`) let two concurrent — or even just sequential idempotent — revoke calls on the same permission both log a `'consent_revoked'` audit event for what was logically one action. `revokePermission()` now returns `{ permissions, freshlyRevoked }`; `permission-routes.ts` only audit-logs `freshlyRevoked`, so an idempotent re-revoke (concurrent or sequential) produces zero additional audit events, while the HTTP response still always reflects full current state.
- **Known limitation, deliberately left as-is (user decision):** MPOA's duplicate-approval check in `mpoa-controller.ts` is per-**role** only (`approvals.some(a => a.approverRole === approverRole)`), not per-**DID**. A single DID can approve as `patient`, `hospital`, and `guardian` on the same request and single-handedly satisfy the full 3-party threshold — nothing in this module cross-checks that a submitted `approverRole` actually matches the caller's real-world role. This weakens the "no single party can authorize recovery alone" guarantee to "no single *role* can be reused," not "no single *actor* can satisfy multiple roles." Confirmed via deep-testing (Day 1–10 regression), explicitly not fixed per user instruction — revisit if/when a real identity/role-binding layer exists (e.g., roles derived from verified credentials rather than caller-supplied strings).
- `dwn/provider-node/` has been deleted (Days 11–12) — it was an empty `.gitkeep`-only scaffold, confirmed not part of the architecture. Do not recreate it.
- **`Permission.actorRole` is only trusted when accompanied by `roleProofRecordId`** (Days 11–12) — this is the credential-backed fix for the exact role-binding weakness the MPOA known-limitation above describes, applied here instead of left as a limitation, per explicit user decision to pull it into scope. `grantPermission()` throws if `actorRole` is supplied without `roleProofRecordId`; `POST /shareRecord` maps that to 400, and a failed `verifyActorRoleProof()` call (unverified proof, or revealed role ≠ claimed role) to 403.
- **`verifyActorRoleProof()` (`dwn/patient-node/src/interfaces/role-verification.ts`) does a plain, unauthenticated HTTP `GET` to `${verifierAgentBaseUrl}/proof-data/:proofRecordId`** — same accepted trust boundary as `PATIENT_DWN_URL` (no mTLS/API keys, consistent with "no discovery mechanism needed for local PoC"). Network/parse failures throw (not a silent `false`), so a misconfigured URL doesn't look identical to "the proof genuinely failed."
- **No agent has a running HTTP server yet** (Days 14–15 not built), so role-proof verification could only be tested this session against a local mock server standing in for an agent's `/proof-data/:id` response — not a live agent. Same placeholder treatment as `DWN_MASTER_KEK`: the verification logic itself is real, live wiring is deferred to when its dependency (a running agent) exists.
- **The `ProfessionalRoleCredential` schema (attributes: `role`, `licenseId`, `issuedAt`) is not yet registered anywhere** — issuing it requires the government agent's already-generic `/create-schema` + `/credential-definition` + `issueAnonCredsCredential` routes, but there's no running agent server to call them against until Days 14–15. A new schema was chosen over extending the existing identity credential because Indy schemas are immutable once registered.
- `VP_SIGNING_SECRET` is a new required env var (Days 11–12), same throw-if-missing pattern as `DOCUMENT_SIGNING_SECRET`/`AUDIT_SIGNING_SECRET`/`CONSENT_SIGNING_SECRET` in `signing-utils.ts`. `VERIFIER_AGENT_BASE_URL` is a new optional env var providing the default base URL for `verifyActorRoleProof()`; `shareRecord` can override it per-call.
- **Field-level redaction on `GET /dwn/queryRecord` (Days 11–12):** applies only to non-self, JSON-content reads. `Permission.allowedFields` (empty = unrestricted) is intersected with a matching `Protocol.allowedFields` — matched by `record.protocol` name **and** the permission's `actorRole` equaling the protocol's `actorRole` — via `ProtocolsInterface.applyFieldFilter()`. If multiple active permissions exist for the same `{patientDID, grantedToDID, recordType}` triple, the first active match governs redaction (a simplification; no "most permissive wins" merge logic was built).
- `Protocol` is stored one row per `name` (`protocol:{name}` key), not per `name`+`actorRole` — matches CLAUDE.md's documented schema and its 1:1 examples (MedicalRecord/doctor, Prescription/pharmacist, InsuranceClaim/insurer). Calling `defineProtocol()` again with the same `name` overwrites its `actorRole`/`allowedFields`.
- The generated W3C Verifiable Presentation (`ProtocolsInterface.generateVerifiablePresentation()`) is **JWT-based, not JSON-LD/LD-Proof** — deliberate, matches this repo's existing JWT-only signing convention (nothing else here uses Linked Data Proofs). The JWT signature is the "proof" for now; real patient-DID-based signing is deferred until patient wallet/DID work lands, same placeholder treatment as `Permission.consentVCId`.
- **Deep-testing (Days 11–12, post-implementation adversarial pass) found and fixed 2 real bugs, same class as the Day 9–10 corrupted-entry findings:** (1) `GET /dwn/queryRecord`'s field-redaction step called `ProtocolsInterface.getProtocol(record.protocol)` unguarded — a single corrupted `Protocol` entry threw uncaught and 500'd every read of every record referencing that protocol name, **across every patient**, not just the corrupted protocol's own registrant. Now wrapped in try/catch with a `console.warn`; falls back to `Permission.allowedFields` alone (same as "no protocol defined for this name"). (2) `POST /dwn/protocols/define` (both the route's own pre-check and `ProtocolsInterface.defineProtocol()` internally) called `getProtocol()` unguarded to decide 200-vs-201/audit-event-type and to preserve `createdAt` — a corrupted entry at that exact name permanently blocked ever redefining/repairing it. Both call sites now treat a corrupted "existing" lookup as "none" (with a warning), so `defineProtocol()` can self-heal a corrupted protocol name instead of being permanently stuck.
- **A second "funky scenario" adversarial pass (Days 11–12) found and fixed 2 more bugs in the field-redaction path itself:** (1) `ProtocolsInterface.applyFieldFilter()` used `field in data`, which walks the prototype chain — requesting an `allowedFields` entry like `"toString"` or `"constructor"` returned the inherited `Object.prototype` method as if it were real record data, since those names are technically "in" every plain object even though the record never had that key. Fixed: switched to `Object.prototype.hasOwnProperty.call(data, field)` (own-properties-only) and build the filtered result via `Object.create(null)` instead of `{}`, so a field literally named `"__proto__"` can't alter the returned object's own prototype either (confirmed harmless either way — it only affects that one returned object, not global state — but fixed for correctness, not just safety). (2) `ProtocolsInterface.defineProtocol()` accepted `allowedFields` as any truthy value with no array-type check — sending a plain string was silently stored as-is; downstream code assuming a real array (e.g. `.includes()`) would then run against string-substring semantics instead of array-membership semantics. Fixed: `defineProtocol()` now throws (and `POST /dwn/protocols/define` now 400s) if `allowedFields` isn't an array.
- **A root `.env` now exists (Day 13, gitignored, never committed)** — holds `DWN_MASTER_KEK`, `DOCUMENT_SIGNING_SECRET`, `AUDIT_SIGNING_SECRET`, `CONSENT_SIGNING_SECRET`, `VP_SIGNING_SECRET`, all self-generated locally (not external credentials — no account/API-key needed anywhere for this PoC). `VERIFIER_AGENT_BASE_URL` deliberately left unset — nothing exists for it to point at until Days 14–15. Completely separate from, and unrelated to, the forbidden `demo/credo/.env`.
- **`tsx` added as a root devDependency (Day 13)**, with a `"dwn:dev": "tsx dwn/patient-node/server.ts"` script — the shared root `tsconfig.json`'s `module: "ESNext"` / `moduleResolution: "bundler"` (needed for the Next.js frontend elsewhere in the monorepo) isn't directly runnable by plain `node`/`ts-node` without a manual compiler-options override; `tsx` avoids that friction. Days 14–15's agent `server.ts` files will hit the identical problem and should use the same approach rather than reintroducing a `ts-node` override.
- **The DWN's port was changed from 5000 to 5050 (Day 13, resolved, not a flag for later)** — port 5000 is occupied by macOS's AirPlay Receiver (`ControlCenter` process) by default on Sonoma+ (confirmed via `lsof -nP -iTCP:5000 -sTCP:LISTEN` on the dev machine used for this project). Rather than asking every developer running this project to change a macOS system setting (System Settings → General → AirDrop & Handoff), the project's own default port was moved to 5050 instead — `dwn/patient-node/server.ts`'s `DWN_PORT` fallback, `PATIENT_DWN_URL`, and every doc reference are all updated to match. No further action needed for Days 14–17; agents should simply read `PATIENT_DWN_URL=http://localhost:5050` from their `.env` like any other config value.
- `dwn/patient-node/server.ts` was smoke-tested against a **real running instance** (not a throwaway in-memory Express app, unlike every prior day) — `storeRecord` → self-read `queryRecord` → `protocols/define`, plus `/health`, an unmounted-path 404, a malformed-JSON 400, and a clean `SIGINT`/`SIGTERM` shutdown via `LevelDBAdapter.close()`. No equivalent close exists for `AuditService`'s `PrismaClient` — not added, out of scope, noted as a minor gap.

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
