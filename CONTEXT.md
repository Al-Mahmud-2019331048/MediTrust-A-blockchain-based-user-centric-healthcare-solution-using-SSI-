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
| 9   | Audit Trail (persistent SQLite, signed, every DWN event)                   | **Done** — on-chain anchoring evaluated post-Day-20, resolved as intentionally out of scope (see §9) | `audit/src/`                                     |
| 10  | Security Evaluation (8 experiments, metrics table)                         | **Done** (Day 18) — 6/8 real, 2 honestly blocked (ledger connectivity), all 5 attack sims pass | `benchmark/`                                     |

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
| Smart contracts   | Out of scope, permanently, per explicit user instruction                | Indy has no VM. Consent and audit are handled by VCs and signed logs. Re-confirmed directly against the original requirements doc — the doc only *suggested* Fabric/Ethereum, didn't mandate it; Indy's DID/VC-native fit was the deliberate choice. Do not revisit. |
| SSS library       | `shamir-secret-sharing` npm (pure JS, GF(2^8))                          | No native deps, well-maintained — installed at root                                                    |
| DWN URL (agents → DWN) | `PATIENT_DWN_URL=http://localhost:5050` env var in each agent      | PoC runs fully local, all services on one machine, no discovery mechanism needed. 5050 not 5000 — avoids macOS AirPlay Receiver's default port |
| DID hierarchy | 3-tier, real (built → reverted → rebuilt): Government → Healthcare-Authority (:4006) → Doctor | Built once, reverted to 2-tier as unnecessary complexity, then explicitly rebuilt again per direct later-session user instruction. Government issues HospitalAuthorizationCredential to Healthcare-Authority, which issues ProfessionalRoleCredential to Doctor. `verifyActorRoleProof()` verifies one hop only (doctor's proof vs. Healthcare-Authority), not the full chain |
| Hospital role in MPOA/SSS | `approverRole: 'hospital'` / SSS share holder 2 are unrelated to the Healthcare-Authority agent | Just role labels in key-recovery, not backed by any DID/credential — don't conflate the two "hospital" concepts |
| Protocol role binding   | `Permission.actorRole` only trusted with a verified `roleProofRecordId` (AnonCreds proof of a `ProfessionalRoleCredential`) | Closes the same self-reported-role weakness documented as a known MPOA limitation — user chose to fix it here rather than defer; now has a real issuer behind it (Healthcare-Authority) |
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
- `agents/doctor-agent/src/routes/medical-routes.ts` — (Days 16–17) now calls `writeIssuedDocumentToDWN()` after issuance succeeds
- `agents/shared/dwn-client.ts` — (Days 16–17, new) thin `storeRecord()` HTTP client, `PATIENT_DWN_URL`'s first real consumer
- `agents/pharmacy-agent/src/routes/pharmacy-routes.ts`
- `agents/healthcare-authority-agent/` — NEW (post-Day-20): `server.ts` + `src/routes/healthcare-authority-routes.ts` (`POST /issue-role-credential`), completing the real Government -> Healthcare-Authority -> Doctor chain, port 4006
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
| ~~14–15~~ | ~~Agent server.ts~~         | **Done** — all 3 boot/init/mount live; added real `@credo-ts/*`/`@hyperledger/*` root deps (were type-check-only before); real DIDs registered on BCovrin; schema/credDef writes blocked by dev-network pool connectivity, not a code issue (see Known Constraints) |
| ~~16–17~~ | ~~Wire agents → DWN~~      | **Done (doctor-agent only)** — `agents/shared/dwn-client.ts` (new), `medical-routes.ts`'s `writeIssuedDocumentToDWN()`; `PATIENT_DWN_URL` has its first real consumer. On-chain audit VC for key splits/consent events was an open design question at the time — **since resolved (post-Day-20): intentionally excluded from scope, see §9** |
| ~~18~~  | ~~Benchmark~~                | **Done** — `benchmark/run-experiments.ts`, all 8 experiments attempted + key recovery success rate + 5 attack simulations, all passing; `crypto/sss/server.ts` built as a necessary companion (SSS/MPOA had no server anywhere before) |
| ~~19~~  | ~~End-to-end test~~          | **Done** — `e2e/full-flow-test.ts`, real 10-step flow; also fixed `/issue-medical-credential`'s hard-fail (no fallback) to match `/issue-prescription`'s pattern |
| ~~20~~  | ~~Documentation~~            | **Done** — README.md rewritten, this final docs pass                                                                                                                                                                                                                                |

**Frontend Track (future, unscheduled):** `apps/web/` has only reusable components/hooks/services today, no Next.js scaffolding (no `package.json`, `next.config.js`, or `app/` directory). A patient consent dashboard is buildable now, independent of agent work, since the DWN already runs. Government/doctor/pharmacist portal pages (real QR codes for Bifold) become buildable once Days 14–17 land, by porting `interface/`'s already-verified-working equivalent pages onto the new agent contract. `interface/`'s `patient`/`verifier` pages are non-functional mockups, not a porting target.

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
- **`crypto/sss/server.ts` (Day 18, new)** — first server ever built for SSS/MPOA; mounts `sssRouter` at `/sss`, `SSS_PORT` default `4008`, `npm run sss:dev`.
- **`initiateRecovery()` gained an optional `expiryHours` param (default 24)** — lets the "expired MPOA request" attack test a real expiry without waiting 24h or mocking the clock. `POST /sss/recovery/initiate` forwards it.
- **`benchmark/run-experiments.ts` (Day 18):** 6/8 experiments are fully real today (DWN storage/selective-sharing/revocation, SSS recovery/split, key recovery success rate). 2 (blockchain tx latency, VC verification) honestly report `blocked` with the real error. VC issuance genuinely runs the full DIDComm flow via a temporary test-patient agent but reports `degraded` since it falls back to the existing W3C-message path when no real credDef exists — real timing, clearly labeled as the fallback, not the intended metric.
- **Discovery: an agent's HTTP routes mount only after its ledger-timeout retries finish** — on this network that takes noticeably longer than a few seconds. Wait for the `"...routes mounted. Ready."` log line before treating a quick "not reachable" check as meaningful.
- **Fixed (Day 19, per explicit user instruction): `/issue-medical-credential` used to hard-400 with no fallback, unlike `/issue-prescription`'s proven graceful pattern** — a leftover from before Days 16-17's fallback+DWN-write system existed, not deliberate. Now mirrors `/issue-prescription` exactly; confirmed working live in Day 19's E2E test.
- `benchmark/test-patient-helper.ts` (Day 19) — shared test-patient connection logic, used by both `benchmark/` and `e2e/`.
- `e2e/full-flow-test.ts` (Day 19) — real, permanent 10-step flow test (not throwaway), all steps passed on first run. Results in `e2e/results/`.
- `README.md` was significantly stale before Day 20 (wrong port, claimed unbuilt functions as done, pre-Day-5 module status) — fully rewritten.
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
- **Real blocker fixed (Days 14–15): `@credo-ts/*`/`@hyperledger/*` weren't actually installed at root** — only type-check-resolvable via a `demo/credo/node_modules` path alias, which doesn't affect Node's real runtime module resolution. Added as real root dependencies matching `demo/credo/package.json`'s pinned versions; removed the now-dead path aliases. `cors` also added as a real dependency (was type-stubs only).
- **All 3 agent servers boot and mount routes live, verified this session** (not throwaway) — government/doctor each register their own schema+credDef with a dummy-id fallback on failure; pharmacy is verifier-only, creates neither. Cross-agent credDef env vars (`ISSUER_CRED_DEF_ID`, `DOCTOR_MEDICAL_CRED_DEF_ID`) don't propagate automatically between agents — each is a separate process, manual copy+restart required.
- **Real DIDs registered for all 3 agents on BCovrin** via `test.bcovrin.vonx.io/register` (not `selfserve.bcovrin.vonx.io` — that hostname doesn't resolve). Genuinely distinct seeds per agent.
- **Known environment limitation, not a code defect:** the actual Indy ledger pool connection (raw TCP to BCovrin validator nodes, ports 9701–9708) is blocked on the dev network used this session — confirmed via direct port tests. DID *registration* (HTTPS) works fine; DID *resolution*/schema/credDef writes (which need the pool link) don't, from this network. See CLAUDE.md for full detail.
- **`patientDID` for DWN writes is derived from the DIDComm connection's `theirDid`, falling back to the bare `connectionId`** (Days 16–17) — a deliberate placeholder (same treatment as the KEK placeholder), since `theirDid` is ephemeral/connection-scoped, not a stable patient identity; matches an identical existing pattern already in legacy `demo/credo/src/routes/document-routes.ts`. Real fix needs the patient to have their own persistent wallet-anchored DID.
- **DWN write failures don't fail the issuance HTTP response** (Days 16–17) — the credential was already issued and can't be un-issued; surfaced as a non-fatal `dwnWriteError` field instead. Verified via 9 checks against a real running DWN with a hand-built fake agent (real issuance still blocked by the network limitation above).
- **Real security bug found and fixed via post-Day-20 live adversarial testing: `GET /proof-data/:id` used to report `isVerified: true` for proofs that were never actually presented or cryptographically checked** — it treated Credo-TS's `getFormatData()` returning any non-null object (true as soon as a request exists) as proof of verification. Proved live with a test-patient agent that never responded to a real proof request (stuck at RFC 0037's `request-received`), yet the endpoint reported it verified. This is the exact endpoint `verifyActorRoleProof()` trusts for credential-backed `Permission.actorRole` grants (Days 11–12's whole point), so it mattered. Fixed: now checks the real proof record state (must be `"done"`), and tightened `cache-utils.ts`'s `VERIFIED_STATES` from `["done","presentation-received","request-received","presentation-sent"]` down to `["done"]` only. Re-verified live post-fix. See CLAUDE.md Known Constraints for full detail.
- **Second bug found the same way: `connectTestPatientTo()` (`benchmark/test-patient-helper.ts`) could grab the wrong connection on a long-lived agent that already had another completed connection from an earlier test run** — it scanned the agent's whole connection list by state alone, no way to tell "the one I just made" apart from any other already-completed one. Reproduced live (adversarial test leaves a stale connection on doctor-agent, then e2e run picks it by mistake, credential issuance fails as "undeliverable"). Fixed: scope the poll to `?outOfBandId=<this invitation's id>`, a filter `common-routes.ts` already supported but this helper never used. Re-verified against the same still-polluted agent — all 10 e2e steps passed.
- **Third bug found the same way: `AuditService.verify()` only checked 4 of the 9 fields `record()` actually signs** (`eventId`/`actorDid`/`targetDid`/`resourceId`, missing `action`/`eventType`/`resourceType`/`metadata`/`timestamp` — all of which ARE inside the signed JWT). Meant tampering an audit row's `action`, `metadata` (e.g. rewriting `allowedFields` to claim broader access), `eventType`, `resourceType`, or `timestamp` directly in the DB went undetected. Confirmed live, then fixed to check all 8 comparable fields (metadata via JSON.stringify; timestamp confirmed to round-trip exactly through SQLite first). Re-verified — all 5 tampering vectors now correctly caught.
- **Fourth/fifth bugs, both in `permissions.ts`: (1) garbage `expiresAt` strings made a grant permanently active** (NaN date comparisons are always false, so the expiry check never triggered) — now validated and rejected with 400. **(2) malformed base64 in binary `storeRecord` was silently corrupted rather than rejected** (`Buffer.from(garbage,'base64')` drops invalid chars instead of throwing) — now decode-then-reencode compared against the original before persisting, 400 on mismatch. **(3) re-revoking via the `{patientDID,grantedToDID,recordType}` triple wasn't idempotent** (404 once nothing active remained) unlike the `permissionId` path (always 200) — now consistent, both return 200. All three confirmed live, fixed, re-verified including a 50-way and 10-way concurrency stress test.
- **Real gap found, NOT fixed, flagged for a scoping decision: MPOA's `approveRecovery()` never cryptographically checks the `signature` field** — any non-empty string is accepted as a valid approval signature for any role. Confirmed live: fake string "signatures" for all 3 roles reach the full recovery threshold same as real ones would. Not fixed because a real fix needs actual keypairs per approver + a defined signing scheme + key lookup — architectural decisions, not a small patch. See CLAUDE.md Known Constraints.
- **On-chain audit VC anchoring — evaluated post-Day-20, resolved as intentionally out of scope.** Research confirmed it's mechanically doable (raw Indy `AttribRequest`/`CustomRequest` via `@hyperledger/indy-vdr-shared` can anchor a hash using only an agent's own registered ledger-write DID, no DIDComm connection needed — unlike credential issuance, which is why the DWN/`crypto/sss` never fit that model; they have zero wallet/connection concept, confirmed by tracing every `AuditService.record()` call site). Decision: don't build it. The requirements doc only asks for a "persistent, signed" audit trail, already fully met by the SQLite + signed-JWT trail; on-chain anchoring was an earlier session's aspirational addition, not a real requirement — and it'd be unexercisable anyway given the same blocked ledger-pool connectivity affecting 2 of the 8 benchmark experiments. See CLAUDE.md Known Constraints for full detail.
- **Built the real 3-tier DID hierarchy (Government → Healthcare-Authority → Doctor), retiring "no separate hospital server."** The codebase already half-anticipated this (`AgentType` union and `apps/web`'s `apiService.ts` both already had `'healthcare-authority'`/port 4006 as a stale placeholder) — a 4th agent was always intended. New `agents/healthcare-authority-agent/` registers a `professional_role_credential` schema+credDef and issues it to doctors via `POST /issue-role-credential`; government gained a second schema (`hospital_authorization_credential`) and `POST /issue-hospital-authorization` to issue to the healthcare-authority. Both are the first real callers of the previously-unused `credential_issued` audit event type. Had to add a genuinely new capability, `POST /accept-invitation` (`common-routes.ts`), since agents previously could only *create* invitations, never *accept* one from another agent over HTTP. No DWN changes needed — `verifyActorRoleProof()` was already agent-agnostic. **Scoping boundary:** verification is one hop only (doctor's proof checked against Healthcare-Authority; Healthcare-Authority's own government-issued authorization isn't re-verified per grant). Live end-to-end tested through the full chain — correctly returns 403 given the same ledger-pool block affecting everything else, not a crash or a false accept. Full benchmark/e2e regression re-run with all 4 agents live — no regressions. See CLAUDE.md Known Constraints for full detail.
- **"Operation Fullbring" — Part A (backend) is Done, real, and live-tested; Part B (frontend) is still planning only.** The core problem: **the DWN's real encryption key and the SSS/MPOA key-recovery module had never been connected** — `records.ts`'s `getPlaceholderKEK()` read one static, system-wide key shared by every patient, and `crypto/sss/`'s correct, tested Shamir math had only ever been exercised on throwaway test keys, never the real one. Fixed via two independent recovery mechanisms off one real per-patient key (`dwn/patient-node/src/encryption/mek-store.ts`, new): (1) **self-custody** (`crypto/sss/src/self-custody.ts` + `self-custody-routes.ts`) — patient's own devices only, 3-way split/threshold-2, no institution involved, for ordinary lost-device recovery; (2) **MPOA emergency fallback** — the existing `crypto/sss` module completely unchanged, just bridged (`mpoa-bridge-routes.ts`) to operate on the real key instead of a synthetic one. Incremental (per-write) encrypted backup to a pluggable destination (`dwn/patient-node/src/backup/`) — a real, tested `LocalBackupDestination` plus a real (untested live — needs the user's own Google OAuth credentials) `GoogleDriveBackupDestination`. **Live-tested, the real proof**: populated a device with real data, split the key, killed the process and deleted its entire data directory, booted a genuinely empty second device, recovered the key from only 2 of 3 self-custody shares, restored the data from the surviving backup, and confirmed every record/permission byte-for-byte identical — 8/8 checks passed. Repeated for the MPOA path — 7/7 passed. Full benchmark/e2e regression clean both times. Also: the `healthcare-authority-agent` (built earlier this session for a 3-tier Government→Healthcare-Authority→Doctor chain) was reverted entirely back to the original 2-tier design, confirmed live. See CLAUDE.md's "Operation Fullbring" section for full detail.

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

---

## 11. Current Session State (most recent)

- All 10 modules Done, Operation Fullbring (self-custody + MPOA bridge + backup + restore + per-patient signing key) Done and live-tested, "close the gaps" pass (patient-signed consent/audit, real MPOA signature verification) Done, real Next.js frontend (`apps/web/` — Government/Doctor/Patient pages) Done. `README.md` now contains both the technical documentation and a merged-in plain-English user guide (the separate `USER_GUIDE.md` file was deleted after merging, per explicit user instruction — `CLAUDE.md`/`CONTEXT.md` were deliberately left untouched, not merged).
- **BC Wallet's "invalid" invitation issue turned out to be BC-Wallet-specific, not a project bug.** The user's supervisor provided a generic (unbranded, `com.ariesbifold`) Bifold APK, decompiled and confirmed to explicitly permit plain-HTTP DIDComm (unlike BC Wallet's presumed production HTTPS-only stance) — and it connected successfully on the first real phone test. A real identity credential and medical record were issued and read back live.
- That live phone test surfaced 3 real, now-fixed issues: `issueMedicalCredential()` silently never sent `connectionId` (every real click would 400); the DWN's `server.ts` had no CORS support, breaking the Patient Dashboard's browser-side fetches once it started calling the DWN directly; and records displayed as raw JSON dumps, now rendered as labeled fields with image/PDF-aware attachment rendering.
- **Built this session, live-verified:** PDF/image upload end-to-end on the Doctor Portal (writes a second binary DWN record alongside the JSON metadata one). **Stable Patient Account ID + doctor identity verification** — the deeper fix for why the patient couldn't find their own just-issued record: every DIDComm connection mints a fresh pairwise DID, so `patientDID` used to change per visit. Now a stable `patientAccountId` is minted at identity issuance, embedded as a credential attribute, and revealed to the doctor via a proof-request (reusing/fixing the previously-dead-code `useProofVerification` hook, which had a real bug: it extracted proof data from the wrong endpoint's response and would have silently never fired even on a real successful verification). Verified live across two separate, freshly-established doctor connections landing records under the identical stable `patientDID` — the exact bug, now fixed. `e2e-test`/`benchmark` regression re-run clean.
- All backend services (dwn, gov, doctor, pharmacy, sss) and the web app were left running at the end of that session (unlike the prior session-end, which shut everything down) — `.env`'s `*_AGENT_PUBLIC_ENDPOINT` vars are currently set to `localhost` (for reliable automated testing), not the LAN IP — reset them to the current `ipconfig getifaddr en0` value before resuming phone testing.
- **This session:** confirmed pharmacy-agent's `server.ts` already existed and boots fine (a stale line in CLAUDE.md's older File Map said "NOT BUILT YET" — fixed; the file's own Build Status table already said otherwise). Then wired pharmacy to the DWN's selective-sharing pathway (`agents/shared/dwn-client.ts` gained `queryRecords()` + `DWNRequestError`; pharmacy-agent gained `POST /read-prescription` and `patientAccountId` on its identity proof request) alongside the existing ZKP-proof pathway, and built the first-ever Pharmacy Portal page (`apps/web/src/app/pharmacy/page.tsx`). Deliberately did NOT add a credential-backed `actorRole` for pharmacy's grant — that needs a professional-role-credential issuer, which is exactly the Healthcare-Authority chain already built-then-reverted earlier in this project; redaction here is governed by patient-chosen `allowedFields` only. Live-tested end-to-end via a throwaway script (11/11 checks): pre-grant read returns `200`+empty array (a real discovery — list queries never 403, only single-`recordId` lookups do), unrestricted grant reveals all fields, and a field-restricted re-grant correctly redacts `diagnosis` while keeping `prescription`. `apps/web` type-checks and `next build`s clean. All services shut down again at the end of this pass (ports 4000/4002/4004/4010/5050 confirmed clear).
- **Also this session:** closed the matching gap on the Doctor Portal — it could write records but had no way to read any back. `agents/doctor-agent/src/routes/medical-routes.ts` gained `POST /read-patient-records` (reuses `agents/shared/dwn-client.ts`'s `queryRecords()`, same pathway as pharmacy). `RecordCard` (plus `RECORD_TYPE_LABELS` and its field-humanizing helpers) was extracted out of `patient/page.tsx` into a new shared `apps/web/src/components/RecordCard.tsx`, now imported by both the Patient and Doctor portals instead of being duplicated. Doctor Portal gained an Issue/View-records tab with a record-type filter. Live-tested end-to-end (12/12 checks): pre-grant read empty, a grant restricted to `medical` + `allowedFields:['prescription']` correctly redacts `diagnosis` while keeping `prescription`, and — the check specific to this pass — an explicit `recordType=prescription` filter correctly returns nothing since no grant exists for that type, confirming per-type grants stay isolated. `apps/web` type-checks and `next build`s clean. Services shut down again afterward (ports 4000/4002/4011/5050 confirmed clear).
- **BigchainDB (raised, rejected) → led to a real feature: `backup-provider/`, a new self-run server replacing Google Drive entirely.** BigchainDB was turned down (unmaintained since 2020; immutable ledgers can't support real deletion, which backups need). The user then wanted something more decentralized than Google Drive, which surfaced a real DIF-spec concept — "DWN providers," hosted nodes a patient's data can sync to — but a full real sync protocol was judged disproportionate (explicit parallel drawn to the Healthcare-Authority chain that was built then deliberately reverted earlier in this project). Landed on a right-sized middle ground the user then pushed further on ("if I want it decentralized I might as well go all the way for the backup"): a real multi-tenant server, storage-only, authenticated via the patient's own signing key rather than a shared secret, with real deletion. Planned (Plan mode, 2 research/design subagents + 1 direct user review of the interface/wiring code), then built and live-tested. See CLAUDE.md's new `backup-provider/` entry for full detail, including 3 real bugs found and fixed during live testing (fresh-device bootstrap trust, a `_protocols`-scope MEK-mismatch, and a pre-existing self-custody-routes.ts bug where restoring on a fresh device minted a premature, wrong signing key). `.env`'s `BACKUP_DESTINATION` default changed from unset/`local` to `dwn-provider`. Regression-tested clean against the `local` path via `e2e/full-flow-test.ts`. All backend services shut down again at the end of this pass.
- **Patient Dashboard UI pass, following the backup-provider work — closing the "how does a normal patient actually use this" gap the user pushed on directly.** Four changes to `apps/web/src/app/patient/page.tsx`: (1) the patient's account ID is now blurred by default (click/tap to reveal) instead of shown in plain text at all times; (2) the 3 self-custody recovery shares each now get a copy-to-clipboard button, a plain-English instruction naming who should hold that specific share (phone / printed paper / second device), and an explicit "you won't see these again" warning; (3) the restore flow now validates each pasted share live as you type — showing ✓/✗ and which share it recognized per box, with a running "X of 2 minimum" counter, and the reconstruct button stays disabled until the real threshold is met instead of failing after the fact; (4) a new "Your signing key" section shows the patient's real, live public-key fingerprint (safe to display, proves nothing private is exposed) plus a plain explanation that the private half never leaves the device and is never shown. Required one small new backend route, `GET /dwn/patients/:patientDID/signing-key-status` (`dwn/patient-node/src/routes/self-custody-routes.ts`), reusing the existing `getPublicKey()` from `patient-signing-key.ts` — no new key material, no change to any recovery logic, purely visibility. Confirmed live at the API level (`hasKey: false` before any key exists → `hasKey: true` + a real fingerprint after triggering key creation); the actual browser rendering was not visually verified by the agent (no browser-automation tool available in this environment) — user asked to check it visually themselves, but the session moved on to other things before that confirmation came back. `apps/web` type-checks and `next build`s clean (`/patient` route: 5.05kB, up from 3.83kB).
- **PoC completeness assessment (recorded in CLAUDE.md's new "PoC Completeness Assessment" section, right after the experiments table):** asked directly "can we say the PoC is complete?" — answered broadly yes, with a specific named-exceptions list (on-chain anchoring out of scope, no real doctor-license credential chain, single un-split device KEK, one recovery-approval share-ownership check not enforced, BC Wallet compatibility diagnosed-but-not-conclusively-fixed, no deployment packaging). Also recorded a precise "decentralized vs. patient-controlled" distinction for the thesis: the identity/credential layer (Hyperledger Indy) is genuinely decentralized; the DWN vault, backup provider, and agents are patient-controlled (no one but the patient can unlock their data) but each is architecturally a single server, not a distributed/replicated network — these are two separate, both-true claims that should not be conflated into one blanket "fully decentralized" statement in the thesis write-up.
- **This session: closed 3 of the exceptions named directly above, per explicit user instruction to implement all 3 in one session (planned via Plan mode — 3 parallel Explore research agents + 1 Plan agent, reviewed, then executed in dependency order: MPOA fix → Healthcare-Authority rebuild → on-chain anchoring).**
  1. **MPOA share-to-request binding, fixed.** `RecoveryRequest` gained an optional `issuedShareIds` manifest; new additive `POST /sss/recovery/initiate-with-split` ties a split to its request; reconstruct now rejects shares that aren't part of the approved request's own manifest (403), while staying fully backward compatible with bare `/recovery/initiate` (skips the check) and both existing attack-simulation tests (unaffected — they never reach the new check). Live adversarial-proved: shares from a completely unrelated split are now correctly rejected against an approved, unrelated request — previously silently succeeded.
  2. **Healthcare-Authority 3-tier chain, rebuilt.** Confirmed via `git log` that the original build+revert cycle was never committed (only empty `.gitkeep` scaffolds exist in history) — rebuilt from CLAUDE.md's own description, not restored. New `agents/healthcare-authority-agent/` (port 4006), government's second schema/credDef + `/issue-hospital-authorization`, `common-routes.ts`'s restored `POST /accept-invitation` (the underlying `BaseAgent.acceptInvitation()` method had survived the original revert as dead code — just needed the HTTP route back) and new `--healthcare-authority` proof-request branch. Live-tested end-to-end (12/12 checks): both hops of the chain (government→healthcare-authority, healthcare-authority→doctor) connect and issue credentials via the same message-fallback pattern used everywhere else in this project.
  3. **On-chain anchoring, built.** `BaseAgent.anchorHash()` + government-only `POST /anchor-hash` genuinely attempt a raw Indy `AttribRequest` write for the 5 patient-signed event types, using a real exported `signRequest` utility function found during implementation instead of the originally-planned `as any` cast on a private method — zero suppressors needed. **A real regression was caught and fixed during this task's own verification, before it was called done:** the first version `await`ed the anchor attempt before responding, which turned `revokeAccess`'s latency from ~5ms to ~5s in the benchmark — fixed to fire-and-forget (`.then().catch()`, not `await`). Live-tested: correctly reports `anchorStatus: 'blocked'` with the real ledger-pool-timeout error, same honest-degradation pattern as the rest of the project.
  - Full `benchmark` + `e2e-test` regression re-run after **each** of the 3 tasks individually (not just once at the end) — zero regressions at any point, all results byte-identical to the pre-session baseline where nothing changed. All backend services shut down at the end of the session. See CLAUDE.md's Known Constraints for the complete build/fix history of all 3.
