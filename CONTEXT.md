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

| # | Module | Status | Location |
|---|--------|--------|----------|
| 1 | SSI Identity Layer (DID creation, key pairs, Indy registration) | Exists | `demo/credo/` |
| 2 | Verifiable Credential System (issue, store, verify) | Exists | `demo/credo/` |
| 3 | Digital Wallet (credential storage, Bifold mobile) | Exists | Bifold + Credo-TS/Askar |
| 4 | Selective Sharing — ZKP attribute-level + DWN Protocol field filtering | Exists (AnonCreds ZKP); DWN Protocol layer not built | `demo/credo/` + `dwn/patient-node/` |
| 5 | DWN Implementation (Records + Permissions + Protocols interfaces, LevelDB) | **Not built** | `dwn/patient-node/` |
| 6 | Encryption Layer (AES-256-GCM + key wrapping) — built into DWN | Written, not wired | `dwn/patient-node/src/encryption/` |
| 7 | MPOA + SSS Key Recovery (5 shares, 3 threshold) | **Not built** | `crypto/sss/src/` |
| 8 | Consent Management — DWN Permissions + Consent Receipt VC on Indy | **Not built** (folded into Module 5) | `dwn/patient-node/src/interfaces/permissions.ts` |
| 9 | Audit Trail (persistent SQLite, signed, every DWN event) | **Done** | `audit/src/` |
| 10 | Security Evaluation (8 experiments, metrics table) | **Not built** | `benchmark/` |

---

## 3. The 8 Required Experiments

| Experiment | Metric |
|-----------|--------|
| VC issuance time | ms |
| VC verification time | ms |
| Blockchain transaction latency | seconds |
| DWN storage overhead | KB/MB ratio (encrypted vs plaintext) |
| Selective sharing overhead | ms (full record vs Protocol-filtered) |
| SSS key split time | ms |
| SSS key recovery time | ms |
| Access revocation time | seconds |

Results output: `benchmark/results/` as JSON + Markdown table.

---

## 4. Key Decisions (All Locked)

| Decision | Choice | Why |
|----------|--------|-----|
| Off-chain storage | Full DWN node (LevelDB embedded) | No external DB server — patient's data lives on patient's machine. Decentralization claim is airtight. |
| DWN type | Full: Records + Permissions + Protocols interfaces | Matches DIF DWN spec intent. More academically defensible than a simplified prototype. |
| MongoDB | **Removed entirely** | Eliminated from all layers — DWN uses LevelDB, audit uses SQLite |
| Audit storage | SQLite via Prisma (file-based) | No server required. Prisma still works with `provider = "sqlite"`. |
| Consent | DWN Permissions (enforcement) + Consent Receipt VC on Indy (proof) | Permissions handle access control inside DWN; VC gives cryptographic on-chain proof of consent |
| SSI layer | Hyperledger Indy + Credo-TS 0.5.x | Already working. No rework needed. |
| Encryption | AES-256-GCM at rest, per-record key wrapped by patient's public key | Hybrid encryption: fast symmetric encrypt + asymmetric key protection |
| SSS threshold | 5 total shares, any 3 reconstruct MEK | (5,3) Shamir — thesis requirement |
| Share holders | Patient device, Hospital, Trusted family, Backup server, Recovery agent | Per requirements document |
| MPOA | Patient + Hospital + Guardian must approve before key release | Threshold = 3 approvals |
| Smart contracts | Out of scope | Indy has no VM. Consent and audit are handled by VCs and signed logs. |
| SSS library | `shamir-secret-sharing` npm (pure JS, GF(2^8)) | No native deps, well-maintained |

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
│  Full DWN Patient Node :5000                    │
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
│  Protocols Interface                            │
│    defineProtocol()   → LevelDB                 │
│    (MedicalRecord, Prescription, InsuranceClaim)│
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
  encryptedData: string,     // AES-256-GCM ciphertext (base64)
  encryptedKey: string,      // AES key wrapped with patient public key (base64)
  iv: string,                // GCM initialization vector (base64)
  tag: string,               // GCM auth tag (base64)
  hash: string,              // SHA-256 of plaintext for integrity verification
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
  consentVCId: string        // Consent Receipt VC ID on Indy
}

// Protocol (LevelDB key: `protocol:{name}`)
{
  name: string,              // "MedicalRecord" | "Prescription" | "InsuranceClaim"
  actorRole: string,         // "doctor" | "pharmacist" | "insurer"
  allowedFields: string[]    // fields this role may read
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
- `audit/src/services/audit-service.ts` — **in-memory, loses data on restart** (Day 1–2 swaps to SQLite)
- `audit/prisma/schema.prisma` — Done: sqlite provider, AuditLog only, MongoDB types removed
- `apps/web/src/` — apiService, 2 hooks, proof-parser, 3 components

---

## 8. Build Order (20 Days, One Module Per Session)

| Day | Module | Files to Create/Modify |
|-----|--------|------------------------|
| ~~1–2~~ | ~~Audit → SQLite~~ | **Done** — Prisma + SQLite wired, `audit.db` live, types clean |
| 3–4 | SSS + MPOA | `crypto/sss/src/key-splitter.ts`, `key-reconstructor.ts`, `mpoa-controller.ts`, `routes/sss-routes.ts` |
| 5–6 | DWN Storage + Encryption | `dwn/patient-node/src/storage/leveldb.ts`, `dwn/patient-node/src/encryption/aes-service.ts` |
| 7–8 | DWN Records Interface | `dwn/patient-node/src/interfaces/records.ts`, `routes/record-routes.ts` |
| 9–10 | DWN Permissions Interface | `dwn/patient-node/src/interfaces/permissions.ts`, `routes/permission-routes.ts` (+ Consent VC issuance) |
| 11–12 | DWN Protocols Interface | `dwn/patient-node/src/interfaces/protocols.ts`, `routes/protocol-routes.ts` |
| 13 | DWN server.ts + package.json | `dwn/patient-node/server.ts`, `package.json`, `tsconfig.json` |
| 14–15 | Agent server.ts | `agents/government-agent/server.ts`, `agents/doctor-agent/server.ts`, `agents/pharmacy-agent/server.ts` |
| 16–17 | Wire agents → DWN | `agents/doctor-agent/src/routes/medical-routes.ts` — after VC issuance, call DWN createRecord |
| 18 | Benchmark | `benchmark/run-experiments.ts` — all 8 experiments |
| 19 | End-to-end test | Full flow: DID → VC → DWN store → permission grant → selective read → revoke → audit |
| 20 | Documentation | README, CLAUDE.md, CONTEXT.md final update |

---

## 9. Known Constraints (Carry Forward)

- Root `package.json` now has `dotenv` and `jsonwebtoken` as `dependencies` — needed by `crypto/encryption/src/signing-utils.ts` which is imported by all modules; keep them here so TypeScript can resolve them monorepo-wide
- `demo/credo/.env` has live MongoDB credentials committed to git — **NEVER touch that file**
- Doctor and pharmacist agents in demo/credo share the same DID/seed — each new agent in `agents/` must have its own DID
- `agents/shared/db-singleton.ts` has been deleted — do not recreate; agents do not touch any database
- `tsconfig.json` `@prisma/client` path alias removed — audit has its own Prisma instance in `audit/`
- `signing-utils.ts` throws on startup if `DOCUMENT_SIGNING_SECRET`, `AUDIT_SIGNING_SECRET`, `CONSENT_SIGNING_SECRET` are not set in `.env`
- `apps/web/` needs `npm i -D @types/node` for `process.env` TypeScript support
- `shamir-secret-sharing` npm package not yet installed
- `level` npm package needed for LevelDB in DWN node
- Prisma SQLite: no `@db.ObjectId` annotations, `Bytes` fields become `String`, run `prisma generate` after schema change
- `agents/shared/db-singleton.ts` is now unused — do not import it in new agents
- No server.ts entry points exist for any new agent — they cannot run yet
- No package.json exists in `dwn/`, `crypto/sss/`, `benchmark/`, `agents/*/`
- `consent/` directory is removed — do not create it

---

## 10. Resolved Open Decisions

| Was Open | Resolution |
|----------|------------|
| SSS share count and threshold | 5 shares, any 3 reconstruct |
| Who holds shares | Patient, Hospital, Trusted family, Backup server, Recovery agent |
| DWN storage backend | LevelDB (embedded) — MongoDB removed |
| DWN implementation type | Full: Records + Permissions + Protocols interfaces |
| Consent mechanism | DWN Permissions (enforcement) + Consent Receipt VC on Indy (proof) |
| Audit storage | SQLite via Prisma — MongoDB removed |
| `consent/` service | Removed — folded into DWN Permissions interface |
| `interface/` migration | Not a priority — legacy interface/ stays, apps/web/ gets new pages as needed |
