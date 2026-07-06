# MediTrust — Implementation Context

> **Purpose:** Paste this at the start of any new session. It is the single source of truth for what's decided, what's built, what's left, and why. Update it as decisions are made.
> **Pace:** One module per session, over 20 days. Do NOT implement anything the user has not approved for that session.

---

## 1. What This Project Is

A thesis continuation implementing a **decentralized, patient-centric healthcare SSI system**.

The original defended thesis proposed SSI + DWN but the actual PoC used MongoDB as a pragmatic stand-in. This implementation round closes that gap by building what was proposed: a **full DWN node** with LevelDB embedded storage (no external DB server), patient-controlled encrypted records, SSI-based consent via DWN Permissions + Verifiable Consent Receipt VCs on Indy, key recovery via Shamir Secret Sharing, and a full signed audit trail.

**No MongoDB anywhere.** Every component is either on-chain (Indy), embedded file-based (LevelDB for DWN, SQLite for audit), or in-memory (agent caches). The patient's data lives on the patient's own machine.

---

## 2. The 10 Required Modules

| #   | Module                                                                     | Status                                               | Location                                         |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| 1   | SSI Identity Layer (DID creation, key pairs, Indy registration)            | Exists                                               | `demo/credo/`                                    |
| 2   | Verifiable Credential System (issue, store, verify)                        | Exists                                               | `demo/credo/`                                    |
| 3   | Digital Wallet (credential storage, Bifold mobile)                         | Exists                                               | Bifold + Credo-TS/Askar                          |
| 4   | Selective Sharing — ZKP attribute-level + DWN Protocol field filtering     | **Done** (Days 11–12) — Protocol-based field filtering enforced on reads; JWT-based W3C VP generated from AnonCreds proof records | `demo/credo/` + `dwn/patient-node/`              |
| 5   | DWN Implementation (Records + Permissions + Protocols interfaces, LevelDB) | **Done** (Days 5–13) — `server.ts` now mounts and runs everything as a real server | `dwn/patient-node/`                              |
| 6   | Encryption Layer (AES-256-GCM + key wrapping) — built into DWN             | **Done** (Days 5–6) — key-wrap uses placeholder KEK  | `dwn/patient-node/src/encryption/`               |
| 7   | MPOA + SSS Key Recovery (5 shares, 3 threshold, guardian approval)         | **Done**                                             | `crypto/sss/src/`                                |
| 8   | Consent Management — DWN Permissions + Consent Receipt VC on Indy          | **Done** (folded into Module 5) — consent receipt is a real signed JWT, on-chain anchoring deferred to Days 16–17 | `dwn/patient-node/src/interfaces/permissions.ts` |
| 9   | Audit Trail (persistent SQLite, signed, every DWN event)                   | **Done**                                             | `audit/src/`                                     |
| 10  | Security Evaluation (8 experiments, metrics table)                         | **Not built**                                        | `benchmark/`                                     |

---

## 3. The 8 Required Experiments

| Experiment                     | Metric                                | Status                                                   |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| VC issuance time               | ms                                    | Not yet — needs agent server.ts (Day 14–15)              |
| VC verification time           | ms                                    | Not yet — needs agent server.ts (Day 14–15)              |
| Blockchain transaction latency | seconds                               | Not yet — needs agent server.ts (Day 14–15)              |
| DWN storage overhead           | KB/MB ratio (encrypted vs plaintext)  | Not yet — needs DWN (Days 5–13)                          |
| Selective sharing overhead     | ms (full record vs Protocol-filtered) | Ready to measure — `ProtocolsInterface.applyFieldFilter()` live in `queryRecord` (Days 11–12) |
| SSS recovery time              | ms                                    | **Done** — `reconstructTimeMs` in `key-reconstructor.ts` |
| Key recovery success rate      | %                                     | Not yet — Day 18 benchmark                               |
| Access revocation time         | seconds                               | Ready to measure — `grantPermission` → read succeeds → `revokePermission` → read returns 403, verified Days 9–10 |

Bonus metric (already built): SSS split time (ms) via `splitTimeMs` in `key-splitter.ts`.

Results output: `benchmark/results/` as JSON + Markdown table.

---

## 4. Key Decisions (All Locked)

| Decision          | Choice                                                                  | Why                                                                                                    |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Off-chain storage | Full DWN node (LevelDB embedded)                                        | No external DB server — patient's data lives on patient's machine. Decentralization claim is airtight. |
| DWN type          | Full: Records + Permissions + Protocols interfaces                      | Matches DIF DWN spec intent. More academically defensible than a simplified prototype.                 |
| MongoDB           | **Removed entirely**                                                    | Eliminated from all layers — DWN uses LevelDB, audit uses SQLite                                       |
| Audit storage     | SQLite via Prisma (file-based)                                          | No server required. Prisma still works with `provider = "sqlite"`.                                     |
| Consent           | DWN Permissions (enforcement) + Consent Receipt VC on Indy (proof)      | Permissions handle access control inside DWN; VC gives cryptographic on-chain proof of consent         |
| SSI layer         | Hyperledger Indy + Credo-TS 0.5.x                                       | Already working. No rework needed.                                                                     |
| Encryption        | AES-256-GCM at rest, per-record key wrapped by patient's public key     | Hybrid encryption: fast symmetric encrypt + asymmetric key protection                                  |
| SSS threshold     | 5 total shares, any 3 reconstruct MEK                                   | (5,3) Shamir — thesis requirement                                                                      |
| Share holders     | Patient device, Hospital, Trusted family, Backup server, Recovery agent | Per requirements document                                                                              |
| MPOA              | Patient + Hospital + Guardian must approve before key release           | Threshold = 3 approvals                                                                                |
| Smart contracts   | Out of scope                                                            | Indy has no VM. Consent and audit are handled by VCs and signed logs.                                  |
| SSS library       | `shamir-secret-sharing` npm (pure JS, GF(2^8))                          | No native deps, well-maintained — installed at root                                                    |
| DWN URL (agents → DWN) | `PATIENT_DWN_URL=http://localhost:5050` env var in each agent      | PoC runs fully local, all services on one machine, no discovery mechanism needed. 5050 not 5000 — avoids macOS AirPlay Receiver's default port |
| Hospital role in PoC   | Doctor agent (port 4002) is hospital's clinical representative      | Hospital participates as MPOA approver + SSS share holder (share 2) via API calls — no separate server |
| Protocol role binding   | `Permission.actorRole` only trusted with a verified `roleProofRecordId` (AnonCreds proof of a `ProfessionalRoleCredential`) | Closes the same self-reported-role weakness documented as a known MPOA limitation — user chose to fix it here rather than defer |
| VP format               | JWT-based W3C Verifiable Presentation, not JSON-LD/LD-Proof          | Matches this repo's existing JWT-only signing convention (signing-utils.ts) |

---

## 5. Architecture Overview

```
Patient (Bifold Wallet)
        │
        │ DIDComm / OOB invitation
        ▼
Government Agent :4000          ← Issues Identity VC (AnonCreds on Indy)
Doctor Agent     :4002          ← Verifies identity ZKP, issues medical VC, uploads record to DWN
Pharmacy Agent   :4004          ← Verifies identity + prescription via DWN query
        │
        │ After verification — doctor uploads record to DWN
        ▼
┌─────────────────────────────────────────────────┐
│  Full DWN Patient Node :5050                    │
│  (runs on patient's machine)                    │
│                                                 │
│  Records Interface                              │
│    createRecord() → AES-256-GCM → LevelDB       │
│    readRecord()   → Permission check → Protocol │
│                     filter → decrypt → return   │
│    updateRecord() → re-encrypt → LevelDB        │
│    deleteRecord() → remove from LevelDB         │
│                                                 │
│  Permissions Interface                          │
│    grantPermission()  → LevelDB + Consent VC   │
│    revokePermission() → LevelDB + Indy revoke  │
│    checkPermission()  → LevelDB lookup          │
│                                                 │
│  Protocols Interface (Done, Days 11-12)         │
│    defineProtocol()   → LevelDB                 │
│    (MedicalRecord, Prescription, InsuranceClaim)│
│    applyFieldFilter() → redaction on read       │
│    generateVerifiablePresentation() → JWT VP    │
│                                                 │
│  Storage: LevelDB (embedded, patient's files)   │
└──────────────┬──────────────────────────────────┘
               │ audit event on every operation
               ▼
Audit Service               ← AuditService.record() → SQLite via Prisma
                               Signed JWT, file-based, no server

SSS Service                 ← splitMEK() on patient registration
                               MPOA approval → reconstructKey() on recovery

Hyperledger Indy (BCovrin)  ← DIDs, VCs, Consent Receipt VCs, Revocation
```

---

## 6. DWN Data Schemas

```typescript
// Record (LevelDB key: `record:{recordId}`)
{
  recordId: string,
  patientDID: string,        // "did:indy:bcovrin:test:..."
  recordType: string,        // "medical" | "prescription" | "lab_report"
  protocol: string,          // "MedicalRecord" | "Prescription" | "InsuranceClaim"
  contentType: string,       // "application/json" | "application/pdf" | "image/jpeg" | "image/png"
  fileName: string | null,   // original filename for binary files, null for JSON records
  fileSize: number,          // byte size of plaintext before encryption
  encryptedData: string,     // AES-256-GCM ciphertext (base64)
  encryptedKey: string,      // AES key wrapped with patient public key (base64)
  iv: string,                // GCM initialization vector (base64)
  tag: string,               // GCM auth tag (base64)
  hash: string,              // SHA-256 of plaintext for integrity verification
  integrityVCId: string,     // Indy VC ID (on-chain proof) — placeholder until Days 16-17, see Known Constraints
  createdAt: string,
  updatedAt: string
}

// Permission (LevelDB key: `permission:{permissionId}`)
{
  permissionId: string,
  patientDID: string,
  grantedToDID: string,
  recordType: string,
  allowedFields: string[],   // attribute-level: ["prescription"] or ["diagnosis","labResults"]
  purpose: string,           // "treatment" | "dispensing" | "insurance"
  grantedAt: string,
  expiresAt: string | null,
  revokedAt: string | null,
  consentVCId: string,       // Real signConsentReceipt() JWT — on-chain Indy anchoring deferred to Days 16-17
  actorRole?: string,        // "doctor" | "pharmacist" | "insurer" — only trusted with roleProofRecordId (Days 11-12)
  roleProofRecordId?: string // Verified AnonCreds proof backing actorRole
}

// Protocol (LevelDB key: `protocol:{name}` — one row per name, Days 11-12)
{
  name: string,              // "MedicalRecord" | "Prescription" | "InsuranceClaim"
  actorRole: string,         // "doctor" | "pharmacist" | "insurer"
  allowedFields: string[],   // fields this role may read; empty = unrestricted
  createdAt: string,
  updatedAt: string
}
```

---

## 7. What Already Exists (Do Not Rebuild)

### Legacy (fully working, demo/credo/)

- DID creation, importDid, createNewDid → `demo/credo/agent.ts`
- AnonCreds VC issuance → `issueAnonCredsCredential()`
- ZKP selective disclosure proof → `sendProofRequest()` with predicates
- Document upload → MongoDB store → SHA-256 hash + JWT sign → `demo/credo/src/routes/document-routes.ts`
- Server entry point for all 3 agents → `demo/credo/server.ts`

### New build (written, not wired)

- `agents/shared/agent-base.ts` — clean BaseAgent rewrite (duplicate event listener bug fixed)
- `agents/shared/types/index.ts` — all types including ConsentReceiptAttributes, AuditEventType
- `agents/shared/module/module-config.ts` — Credo-TS module assembly
- `agents/shared/network/network-config.ts` — BCovrin TestNet genesis
- `agents/shared/common-routes.ts`, `verifier-routes.ts`, `debug-routes.ts`
- `agents/government-agent/src/routes/credential-routes.ts`
- `agents/doctor-agent/src/routes/medical-routes.ts`
- `agents/pharmacy-agent/src/routes/pharmacy-routes.ts`
- `crypto/encryption/src/hash-utils.ts`, `signing-utils.ts`, `verify-utils.ts`
- `audit/src/services/audit-service.ts` — SQLite via Prisma, JWT-signed, persistent (Done Day 1–2)
- `audit/prisma/schema.prisma` — Done: sqlite provider, AuditLog only, MongoDB types removed
- `apps/web/src/` — apiService, 2 hooks, proof-parser, 3 components
- `dwn/patient-node/src/storage/leveldb.ts` — LevelDBAdapter (get/put/del/scan/close), generic, no domain knowledge (Done Day 5–6)
- `dwn/patient-node/src/encryption/aes-service.ts` — AES-256-GCM encrypt/decrypt (Buffer + string input), wrapKey/unwrapKey with placeholder KEK (Done Day 5–6)
- `dwn/patient-node/tsconfig.json` — extends root tsconfig (Done Day 5–6)
- `dwn/patient-node/src/interfaces/records.ts` — RecordsInterface: createRecord/readRecord/queryRecords/decryptRecord; real SHA-256 hash; `integrityVCId` is a local placeholder; update/delete deferred (Done Day 7–10)
- `dwn/patient-node/src/routes/record-routes.ts` — `POST /storeRecord`, `GET /queryRecord`; queryRecord now permission-gated + decrypts on authorized read (Done Day 7–10)
- `dwn/patient-node/src/interfaces/permissions.ts` — PermissionsInterface: grantPermission/revokePermission/checkPermission/listPermissions; `consentVCId` is a real `signConsentReceipt()` JWT; `checkPermission` has no self-read exemption (that lives in `record-routes.ts` only) (Done Day 9–10); `actorRole` now requires a verified `roleProofRecordId` (Done Day 11–12)
- `dwn/patient-node/src/routes/permission-routes.ts` — `POST /shareRecord`, `DELETE /revokeAccess` (Done Day 9–10); accepts `actorRole`/`roleProofRecordId`/`verifierAgentBaseUrl` (Done Day 11–12)
- `dwn/patient-node/src/interfaces/protocols.ts` — ProtocolsInterface: defineProtocol/getProtocol/listProtocols/applyFieldFilter + generateVerifiablePresentation (JWT-based W3C VP from an AnonCreds proof record) (Done Day 11–12)
- `dwn/patient-node/src/interfaces/role-verification.ts` — verifyActorRoleProof(): HTTP call to an agent's `GET /proof-data/:id`, checks `isVerified` + revealed `role` attribute (Done Day 11–12; tested against a mock server only, no live agent yet)
- `dwn/patient-node/src/routes/protocol-routes.ts` — `POST /dwn/protocols/define`, `GET /dwn/protocols/query`, `POST /dwn/protocols/generate-vp` (Done Day 11–12)
- `crypto/encryption/src/signing-utils.ts` — `signVerifiablePresentation`/`verifyVerifiablePresentation` added, 4th JWT secret (`VP_SIGNING_SECRET`) (Done Day 11–12)
- `dwn/patient-node/server.ts` — Express entry point mounting `recordRouter`+`permissionRouter` at `/dwn`, `protocolRouter` at `/dwn/protocols`; `GET /health`; 404 + error-handling middleware; `DWN_PORT` (default 5050, not 5000 — see Known Constraints); SIGINT/SIGTERM close `LevelDBAdapter`; run via `npm run dwn:dev` (Done Day 13, smoke-tested live end-to-end)

---

## 8. Build Order (20 Days, One Module Per Session)

| Day     | Module                       | Files + Gap Resolutions                                                                                                                                                                                                                                                              |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~1–2~~ | ~~Audit → SQLite~~           | **Done** — Prisma + SQLite wired, `audit.db` live, JWT-signed, types clean                                                                                                                                                                                                           |
| ~~3–4~~ | ~~SSS + MPOA~~               | **Done** — `key-splitter.ts`, `key-reconstructor.ts`, `mpoa-controller.ts`, `sss-routes.ts`; guardian rename done                                                                                                                                                                    |
| ~~5–6~~ | ~~DWN Storage + Encryption~~ | **Done** — `leveldb.ts` (generic KV adapter, cwd-independent data path), `aes-service.ts` (encrypt/decrypt accepts `Buffer` or `string`; wrapKey/unwrapKey use a placeholder KEK pending patient wallet/DID work)                                                                      |
| ~~7–8~~ | ~~DWN Records Interface~~     | **Done** — `records.ts` (createRecord/readRecord/queryRecords, `Buffer`/JSON string input, real SHA-256 hash, placeholder `integrityVCId`), `record-routes.ts` (`POST /storeRecord`, `GET /queryRecord`, ciphertext-only reads); update/delete deferred |
| ~~9–10~~ | ~~DWN Permissions Interface~~ | **Done** — `permissions.ts` (grantPermission/revokePermission/checkPermission/listPermissions, real `signConsentReceipt()` JWT), `permission-routes.ts` (`POST /shareRecord`, `DELETE /revokeAccess`); `queryRecord` now permission-gated + decrypts on authorized read |
| ~~11–12~~ | ~~DWN Protocols Interface~~ | **Done** — `protocols.ts`, `role-verification.ts`, `protocol-routes.ts`; generates a JWT-based W3C VP from an AnonCreds proof; `permissions.ts`/`record-routes.ts` wired for role-verified field redaction; `dwn/provider-node/` deleted |
| ~~13~~  | ~~DWN server.ts~~            | **Done** — `dwn/patient-node/server.ts`; added `tsx` devDependency + `dwn:dev` script to actually run it; smoke-tested live (storeRecord → self-read → protocols/define, health, 404, malformed-JSON, graceful shutdown) |
| 14–15   | Agent server.ts              | `agents/government-agent/server.ts`, `agents/doctor-agent/server.ts`, `agents/pharmacy-agent/server.ts`                                                                                                                                                                              |
| 16–17   | Wire agents → DWN            | `medical-routes.ts` — VC → DWN createRecord; agents read `PATIENT_DWN_URL` from `.env` to call DWN HTTP API; **+** on-chain audit VC for key splits and consent events                                                                                                               |
| 18      | Benchmark                    | `benchmark/run-experiments.ts` — all 8 experiments; **+** key recovery success rate (%); **+** 5 attack simulation scenarios                                                                                                                                                         |
| 19      | End-to-end test              | Full flow: DID → VC → storeRecord → shareRecord → selective read (VP) → revokeAccess → on-chain audit VC                                                                                                                                                                             |
| 20      | Documentation                | README, CLAUDE.md, CONTEXT.md final update                                                                                                                                                                                                                                           |

---

## 9. Known Constraints (Carry Forward)

- Root `package.json` now has `dotenv` and `jsonwebtoken` as `dependencies` — needed by `crypto/encryption/src/signing-utils.ts` which is imported by all modules; keep them here so TypeScript can resolve them monorepo-wide
- `demo/credo/.env` has live MongoDB credentials committed to git — **NEVER touch that file**
- Doctor and pharmacist agents in demo/credo share the same DID/seed — each new agent in `agents/` must have its own DID
- `agents/shared/db-singleton.ts` has been deleted — do not recreate; agents do not touch any database
- `tsconfig.json` `@prisma/client` path alias removed — audit has its own Prisma instance in `audit/`
- `signing-utils.ts` throws on startup if `DOCUMENT_SIGNING_SECRET`, `AUDIT_SIGNING_SECRET`, `CONSENT_SIGNING_SECRET` are not set in `.env`
- `apps/web/` needs `npm i -D @types/node` for `process.env` TypeScript support
- `shamir-secret-sharing` npm package installed at root — already done
- `level` npm package installed at root (`^10.0.0`) — done Day 5–6
- `level@10`'s `get()` resolves to `undefined` for a missing key, it does NOT throw `LEVEL_NOT_FOUND` — verified against the installed version; `LevelDBAdapter.get()` checks for `undefined`, do not reintroduce error-code catching
- `leveldb.ts`'s default data directory is resolved via `path.resolve(__dirname, ...)`, anchored to the file's location, not `process.cwd()` — a real bug caught and fixed during Day 5–6 testing (a different cwd previously created a stray nested data folder)
- `aes-service.ts`'s `wrapKey()`/`unwrapKey()` are KEK-agnostic (accept any 32-byte `Buffer`) — no patient public-key infrastructure exists yet; real DID-derived key wrapping deferred to a later session once patient wallet/DID work lands
- `records.ts`'s `getPlaceholderKEK()` reads a 32-byte base64 key from `DWN_MASTER_KEK` in `.env`, throws with a generation one-liner if unset/wrong length — the concrete consumer of the placeholder-KEK constraint above
- `DWNRecord.integrityVCId` is a locally-generated placeholder (`local-placeholder-{uuid}`), not a real on-chain Indy VC ID — no agent has a running wallet/HTTP server until Days 14–15, and VC issuance needs a DIDComm connection the wallet-less DWN doesn't have; real issuance deferred to Days 16–17 (doctor agent calls back into DWN). The `hash` field IS a real SHA-256 today — only the on-chain anchor is deferred
- `GET /dwn/queryRecord` now decrypts and returns a `data` field for authorized reads — resolved Days 9–10 (previously ciphertext-only). `readRecord()`/`queryRecords()` on `RecordsInterface` itself still return raw ciphertext unchanged; only `RecordsInterface.decryptRecord()`, called from the route layer after a permission check, decrypts
- `express` was missing as a runtime dependency until Days 7–8 (only `@types/express` existed) — added to root `package.json`; `sss-routes.ts` and `record-routes.ts` are both actually runnable now, not just type-checkable
- `updateRecord`/`deleteRecord` not built — CLAUDE.md's canonical "Required DWN functions" line omits them; only an aspirational file-map comment lists them. Add `document_updated`/`document_deleted` to `AuditEventType` if/when built
- Patient self-reads always succeed with no permission grant needed (`requesterDID === patientDID` bypass, checked only in `record-routes.ts`'s `queryRecord` handler — `PermissionsInterface.checkPermission()` has no such exemption itself)
- `GET /dwn/queryRecord`'s `requesterDID` is now required (400 if missing) — was optional/audit-only in Days 7–8; needed to evaluate the self-read exemption and permission checks
- `Permission.consentVCId` is a real `signConsentReceipt()` JWT (not a bare placeholder like `integrityVCId`) — genuine off-chain cryptographic proof today, on-chain anchoring deferred to Days 16–17; requires `CONSENT_SIGNING_SECRET` set in `.env`
- `queryRecord`'s `accessPolicy` is DID-keyed (`grantedToDID`), not role-keyed like CLAUDE.md's illustrative `{"doctor": true}` example — no role registry exists in the schema
- `DELETE /dwn/revokeAccess` is the correct verb — CLAUDE.md's Experiments table previously said `POST`, contradicting the file map's `DELETE`; corrected to `DELETE` everywhere
- Prisma SQLite: no `@db.ObjectId` annotations, `Bytes` fields become `String`, run `prisma generate` after schema change
- `agents/shared/db-singleton.ts` is now unused — do not import it in new agents
- No server.ts entry points exist for any new agent — they cannot run yet
- No package.json exists in `dwn/`, `crypto/sss/`, `benchmark/`, `agents/*/`
- `consent/` directory is removed — do not create it
- `dwn/provider-node/` exists on disk but is not in the architecture — delete before Day 13
- `audit/package.json` intentionally does not exist — all deps consolidated into root `package.json` (monorepo structure); do not create per-module package files
- Doctor agent writes to patient DWN without a permission grant — doctor is the author of the clinical record; patient sovereignty is enforced at the READ layer only
- All reads require explicit patient permission grant via `shareRecord` — read without valid grant returns 403
- `PATIENT_DWN_URL=http://localhost:5050` must be set in each agent's `.env` — all agents call the DWN via this URL; no discovery mechanism needed for local PoC. Port changed from the originally-documented 5000 to 5050 on Day 13 to avoid a real macOS AirPlay Receiver conflict.
- Deep-testing (Day 1–10 full regression, post Days 9–10) found and fixed 3 real bugs: (1) a single corrupted LevelDB entry used to throw uncaught and break `queryRecords`/`listPermissions` node-wide — since `checkPermission()` calls `listPermissions()`, this broke *every* authenticated read, not just the corrupted record's own patient; both now skip corrupted entries with a `console.warn`, while a *directly requested* corrupted resource (`readRecord`, revoke-by-`permissionId`) still throws a clear, isolated error. (2) `approveRecovery()` accepted any string as `approverRole` via raw HTTP with no server-side validation (TS union types are compile-time only) — a typo'd role was silently stored but could never satisfy the threshold, permanently stranding the request; now validated, rejected with `400`. (3) `revokePermission()`'s read-then-write had an await-point race — concurrent *or even sequential idempotent* re-revokes of the same permission logged duplicate `consent_revoked` audit events; fixed with a per-key async mutex (`withLock`, private to `permissions.ts`) plus a `{ permissions, freshlyRevoked }` return split so only genuine state transitions get audited.
- **Known limitation, left as-is (explicit user decision):** MPOA's duplicate-approval check is per-role, not per-DID — one DID can approve as `patient`+`hospital`+`guardian` and single-handedly satisfy the full 3-party threshold. Confirmed via testing, not fixed. Revisit once a real identity/role-binding layer exists.
- `dwn/provider-node/` deleted (Days 11–12) — was an empty `.gitkeep`-only scaffold, not part of the architecture.
- **`Permission.actorRole` requires `roleProofRecordId`** (Days 11–12) — the credential-backed fix for the exact role-binding weakness MPOA's known limitation describes above, applied here per explicit user decision rather than left as a documented gap. `grantPermission()` throws without it; `shareRecord` maps to 400 (missing) / 403 (verification failed).
- `verifyActorRoleProof()` makes an unauthenticated HTTP `GET` to an agent's `/proof-data/:id` — same accepted trust boundary as `PATIENT_DWN_URL` (no auth, consistent with "no discovery mechanism needed for local PoC"). Errors throw rather than silently returning `false`.
- No agent has a running HTTP server yet (Days 14–15), so role-proof verification was tested this session against a local mock server only, not a live agent — same placeholder treatment as `DWN_MASTER_KEK`.
- `ProfessionalRoleCredential` schema (`role`, `licenseId`, `issuedAt`) is not yet registered — needs a running government agent (Days 14–15) to call its already-generic schema/creddef routes against. New schema chosen over extending the identity credential because Indy schemas are immutable once registered.
- `VP_SIGNING_SECRET` (required) and `VERIFIER_AGENT_BASE_URL` (optional, overridable per-call) are new env vars from Days 11–12.
- Field-level redaction on `GET /dwn/queryRecord` applies only to non-self, JSON-content reads; if multiple active permissions exist for the same grant triple, the first active match governs redaction (no "most permissive wins" merge across multiple grants was built).
- The generated W3C VP is JWT-based, not JSON-LD/LD-Proof — matches this repo's JWT-only signing convention; real patient-DID-based signing deferred until patient wallet/DID work lands, same treatment as `consentVCId`.
- **Post-implementation adversarial testing (Days 11–12) found and fixed 2 bugs, same class as the Day 9–10 corrupted-entry findings:** a corrupted `Protocol` entry used to 500 `queryRecord` for every record referencing it, across every patient (fixed: soft-fallback to `Permission.allowedFields` alone, same as no-protocol-defined); and `POST /dwn/protocols/define` used to be permanently blocked from ever repairing a corrupted entry at the same name (fixed: a corrupted "existing" lookup is now treated as "none" rather than propagating). See CLAUDE.md Known Constraints for full detail.
- **A follow-up "funky scenario" pass found and fixed 2 more bugs in the redaction path:** `applyFieldFilter()`'s `field in data` check leaked inherited `Object.prototype` methods (e.g. `"toString"`) as if they were real record fields (fixed with `hasOwnProperty` + `Object.create(null)`); and `defineProtocol()` accepted non-array `allowedFields` silently (fixed with an explicit array-type check, 400 at the route). See CLAUDE.md Known Constraints for full detail.
- A root `.env` now exists (Day 13, gitignored) with 5 self-generated secrets (no external credentials needed anywhere for this PoC) — see CLAUDE.md for the exact generation commands.
- `tsx` added as a root devDependency (Day 13) to actually run `server.ts` — the shared tsconfig's bundler-oriented settings (needed for Next.js) aren't directly runnable by plain `ts-node`; Days 14–15's agent servers should reuse this approach.
- **DWN port changed from 5000 to 5050 (Day 13, resolved)** — port 5000 is occupied by macOS's AirPlay Receiver by default; rather than requiring a system-setting change, the project's own default port moved to 5050 everywhere (`server.ts`, `PATIENT_DWN_URL`, all docs). No action needed for Days 14–17.

---

## 10. Resolved Open Decisions

| Was Open                      | Resolution                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- |
| SSS share count and threshold | 5 shares, any 3 reconstruct                                                  |
| Who holds shares              | Patient, Hospital, Trusted family, Backup server, Recovery agent             |
| DWN storage backend           | LevelDB (embedded) — MongoDB removed                                         |
| DWN implementation type       | Full: Records + Permissions + Protocols interfaces                           |
| Consent mechanism             | DWN Permissions (enforcement) + Consent Receipt VC on Indy (proof)           |
| Audit storage                 | SQLite via Prisma — MongoDB removed                                          |
| `consent/` service            | Removed — folded into DWN Permissions interface                              |
| `interface/` migration        | Not a priority — legacy interface/ stays, apps/web/ gets new pages as needed |
| DWN URL discovery             | Not needed — `PATIENT_DWN_URL=http://localhost:5050` env var; PoC is fully local (port moved from 5000 to 5050 Day 13, AirPlay conflict) |
| Hospital role                 | Doctor agent is hospital's clinical rep; hospital in MPOA + SSS fulfilled via API calls — no separate server |
| DWN Protocols enforcement     | Attribute-level field filtering via `allowedFields` (Permission) intersected with `Protocol.allowedFields`, applied on `queryRecord` reads |
| Role-based Protocol claims    | Credential-backed (`roleProofRecordId` + `verifyActorRoleProof()`), not a self-reported string — explicit user decision |
| W3C VP format                 | JWT-based, generated from an AnonCreds proof record's revealed attributes |
