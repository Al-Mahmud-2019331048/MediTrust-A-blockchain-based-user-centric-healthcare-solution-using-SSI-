# MediTrust — Decentralised Patient-Centric Healthcare SSI System

A thesis implementation of a **decentralised, patient-centric healthcare identity and data system** using Self-Sovereign Identity (SSI) built on Hyperledger Indy + Credo-TS, with a full Decentralised Web Node (DWN) replacing centralised storage for off-chain medical records — plus patient-controlled key recovery and encrypted backup, so losing a device doesn't mean losing everything on it.

---

## What This Project Is

MediTrust implements the SSI trust triangle (Issuer → Holder → Verifier) in a healthcare context. Patients own their identity and medical data — no central authority stores or controls it.

The original defended thesis proposed SSI + DWN but the actual PoC used MongoDB as a pragmatic stand-in. This implementation round closes that gap by building what was proposed: a full DWN node with LevelDB embedded storage, patient-controlled encrypted records, SSI-based consent via DWN Permissions + a patient-signed Consent Receipt, key recovery via Shamir Secret Sharing (both a patient-only self-custody path and an institutional emergency fallback), encrypted incremental backup, and a full signed audit trail — plus a real web app to actually use all of it through, not just test scripts.

**No MongoDB anywhere.** Every component is either on-chain (Indy), embedded file-based (LevelDB for DWN, SQLite for audit), or in-memory (agent caches).

**Smart contracts are explicitly out of scope.** Hyperledger Indy has no VM layer — consent and audit are handled by signed Verifiable Credentials and a signed local log, not on-chain contract logic. This is a deliberate, final architecture choice, not a placeholder.

**The strongest honest claim this system can make is "patient-controlled and trust-minimized," not "zero-trust."** Confidentiality trust (who can read your data) really is eliminated everywhere data or keys leave your own devices. Availability trust (who can make your data disappear) is minimized, not eliminated — see "Honest Limits" below before citing this project's decentralization claims in a defense.

---

## Architecture

```
Patient (Bifold Wallet — iOS/Android, or an automated test-patient agent for local testing)
        │  Bifold handles identity/credential issuance ONLY — it has no knowledge of
        │  this project's own self-custody/backup/restore routes below.
        │
        │ DIDComm / OOB invitation
        ▼
Government Agent   :4000     ← Issues Identity VC (AnonCreds on Indy, W3C-message fallback)
Doctor Agent       :4002     ← Verifies identity ZKP, issues medical VC/prescription, writes to DWN
Pharmacy Agent     :4004     ← Verifies identity + prescription via ZKP proof request
        │
        │ (2-tier design: doctor-agent stands in for the hospital directly —
        │  a 3-tier Government → Healthcare-Authority → Doctor chain was built
        │  and live-tested, then deliberately reverted as more machinery than
        │  this project needed. See CLAUDE.md for the full history.)
        │
        │ After issuance — doctor's agent writes the record into the patient's own DWN
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Full DWN Patient Node  :5050  (runs on the patient's own machine)    │
│                                                                       │
│  Records Interface        createRecord/storeRecord, queryRecord      │
│  Permissions Interface     shareRecord, revokeAccess, checkPermission │
│  Protocols Interface       defineProtocol, field-level redaction,     │
│                            generateVerifiablePresentation (W3C VP)   │
│                                                                       │
│  Per-patient encryption    getOrCreateMEK() — one real AES-256 key    │
│                            per patient, not one shared system-wide    │
│                            key. Records/permissions encrypted with    │
│                            it before ever touching LevelDB.           │
│                                                                       │
│  Per-patient signing key   getOrCreateSigningKey() — one real ECDSA   │
│                            P-256 keypair per patient. Consent         │
│                            receipts and the patient's own key-        │
│                            management actions are signed with THIS,   │
│                            not a shared server secret.                │
│                                                                       │
│  Self-custody recovery     initiate/restore — splits the patient's    │
│                            own MEK 3 ways (any 2 rebuild it) across   │
│                            things ONLY the patient owns (phone,       │
│                            paper backup, second device). No           │
│                            hospital/company/family required.          │
│                                                                       │
│  MPOA bridge               Bridges the same real MEK to the           │
│                            institutional patient+hospital+guardian    │
│                            governance flow below — for the rarer      │
│                            "patient can't act for themselves" case.   │
│                                                                       │
│  Incremental backup        Fires on every write — pushes just the     │
│                            one new/changed item (encrypted with the   │
│                            patient's own MEK) to a pluggable           │
│                            destination (local dir today; Google       │
│                            Drive is real code, untested live).         │
│                                                                       │
│  Restore                   Pulls every backup entry down, decrypts    │
│                            with the (already-recovered) MEK, writes   │
│                            everything back into a live store.         │
│                                                                       │
│  Storage: LevelDB (embedded, patient's own files)                     │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ audit event on every operation —
                           │ patient's own actions signed with THEIR
                           │ key; system-observed events (a doctor's
                           │ write, someone else's read) system-signed
                           ▼
Audit Service         ← AuditService.record()/.verify() → SQLite via Prisma

SSS / MPOA Service    ← crypto/sss, port 4008 — institutional 5-way Shamir
                         split + patient/hospital/guardian approval gate,
                         now with real Ed25519 signature verification
                         against out-of-band-registered approver keys

Hyperledger Indy      ← DIDs, VCs, credential definitions
(BCovrin TestNet)        (on-chain audit-event anchoring was evaluated and resolved as
                         intentionally out of scope — see Known Constraints)

apps/web/             ← Real Next.js app — Government Portal, Doctor Portal,
(port 3001)             Patient Dashboard (records, consent, key recovery UI)
```

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js ≥20 | Backend servers run via `tsx`, not `ts-node` |
| Language | TypeScript 5 | |
| SSI Framework | Credo-TS 0.5.x | AnonCreds, Askar wallet, IndyVdr |
| Ledger | Hyperledger Indy (BCovrin TestNet) | DIDs, schemas, credential definitions |
| ZKP | AnonCreds | Attribute-level selective disclosure |
| Off-chain storage | LevelDB (embedded) | Full DWN node — no external DB server |
| Audit storage | SQLite via Prisma | File-based, no server |
| Record encryption | AES-256-GCM, per-patient MEK | One real key per patient (Operation Fullbring), not a shared system-wide key |
| Consent/audit signing | ECDSA P-256 (ES256), per-patient keypair | Patient's own key, not a shared server secret (gap-closure pass) |
| Key recovery (self-custody) | Shamir Secret Sharing, 3 shares/threshold 2 | Patient's own devices only — no institutional party required |
| Key recovery (emergency) | Shamir Secret Sharing, 5 shares/threshold 3 | Patient + Hospital + Guardian approval, real Ed25519-verified signatures |
| Backup | Pluggable destination, encrypted with the patient's own MEK | Local filesystem (live-tested); Google Drive (real code, untested live) |
| Mobile wallet | Bifold | Real patient identity/credential holder — iOS/Android |
| Frontend | Next.js 15 + React 18, its own `package.json` | 3 real pages: Government/Doctor portals, Patient Dashboard |

---

## The 10 Required Modules

| # | Module | Status |
|---|--------|--------|
| 1 | SSI Identity Layer — DID creation, key pairs, Indy registration | Done — real DIDs registered on BCovrin for all 3 agents |
| 2 | Verifiable Credential System — issue, store, verify | Done (falls back to a plain DIDComm message when ledger connectivity is unavailable) |
| 3 | Digital Wallet — Bifold mobile + Credo-TS/Askar | Bifold handles the real patient wallet; agent-side wallets via Credo-TS/Askar |
| 4 | Selective Sharing (core contribution) — ZKP + DWN Protocol field filtering + W3C VP | Done — attribute-level field filtering enforced on reads; JWT-based W3C VP generated from AnonCreds proofs; role claims backed by a verified AnonCreds proof, not a self-reported string |
| 5 | DWN Implementation — Records + Permissions + Protocols, LevelDB | Done — all three interfaces + a real running server |
| 6 | Encryption Layer — AES-256-GCM + key wrapping | Done — real per-patient MEK (Operation Fullbring), wrapped by a device-level secret |
| 7 | MPOA + SSS Key Recovery | Done — both self-custody (patient-only, 3 shares/threshold 2) and institutional emergency fallback (5 shares/threshold 3, real signature-verified approvals) |
| 8 | Consent Management — DWN Permissions + Consent Receipt | Done — signed with the patient's own key, not a shared secret |
| 9 | Audit Trail — persistent SQLite, signed, every DWN operation | Done — verify() checks all 8 signed fields; patient-signed where the event is the patient's own action |
| 10 | Security Evaluation — 8 experiments, metrics table, attack simulations | Done — `benchmark/run-experiments.ts` |

---

## Repository Structure

```
.
├── CLAUDE.md              ← Project guide: file map, build status, constraints (read this first)
├── CONTEXT.md             ← Session context: decisions, architecture, build order
├── README.md              ← This file
│
├── agents/                ← Credo-TS + Indy SSI agent services
│   ├── shared/            ← BaseAgent, types, module config, network config, routes, dwn-client
│   ├── government-agent/  ← Issues patient identity VCs (port 4000), server.ts
│   ├── doctor-agent/      ← Verifies identity, issues medical VCs/prescriptions, writes to DWN (port 4002), server.ts
│   └── pharmacy-agent/    ← Verifies identity + prescription (port 4004), server.ts
│
├── dwn/patient-node/      ← Decentralised Web Node — patient owns their data (port 5050)
│   └── src/
│       ├── interfaces/    ← records.ts, permissions.ts, protocols.ts, role-verification.ts
│       ├── encryption/    ← aes-service.ts, mek-store.ts, patient-signing-key.ts
│       ├── backup/        ← backup-service.ts, local/google-drive destinations
│       ├── storage/       ← leveldb.ts
│       └── routes/        ← record-, permission-, protocol-, self-custody-, mpoa-bridge-, restore-routes.ts
│
├── audit/                 ← Audit trail — logs every DWN operation
│   ├── prisma/            ← SQLite schema + audit.db + migrations
│   └── src/services/      ← AuditService: record, query, verify, sign
│
├── crypto/
│   ├── encryption/        ← AES-256-GCM, SHA-256, JWT/ECDSA signing utilities
│   └── sss/               ← Shamir Secret Sharing (institutional 5-way) + self-custody (3-way) + MPOA, server.ts (port 4008)
│
├── apps/web/              ← Real Next.js frontend — its own package.json/tsconfig.json
│   └── src/app/           ← /government, /doctor, /patient pages
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
npm install    # backend — installs everything for every module (agents/dwn/crypto/audit)
cd apps/web && npm install && cd ..   # frontend — separate package.json (Next.js needs its own build toolchain)
```

Create a `.env` file at the repo root (gitignored, never commit it — completely separate from and unrelated to `demo/credo/.env`, which must never be touched). Required:

```bash
# Self-generated secrets — not external credentials, no account/signup needed anywhere.
DWN_MASTER_KEK=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
DOCUMENT_SIGNING_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
AUDIT_SIGNING_SECRET=<same command, different output>
VP_SIGNING_SECRET=<same command, different output>
# Note: CONSENT_SIGNING_SECRET no longer exists — consent receipts are signed
# with each patient's own key now (see "Operation Fullbring" below).

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

Create `apps/web/.env.local` for the frontend:

```bash
NEXT_PUBLIC_GOVERNMENT_URL=http://localhost:4000
NEXT_PUBLIC_DOCTOR_URL=http://localhost:4002
NEXT_PUBLIC_PHARMACIST_URL=http://localhost:4004
NEXT_PUBLIC_DWN_URL=http://localhost:5050
```

(Use your machine's LAN IP instead of `localhost` in both `.env` files, plus `ISSUER_AGENT_PUBLIC_ENDPOINT`/`DOCTOR_AGENT_PUBLIC_ENDPOINT`, if you want to test from a phone running Bifold over WiFi.)

### Run every backend service

```bash
npm run dwn:dev       # DWN patient node — http://localhost:5050
npm run sss:dev       # SSS/MPOA key recovery service — http://localhost:4008
npm run gov:dev       # Government agent — http://localhost:4000
npm run doctor:dev    # Doctor agent — http://localhost:4002
npm run pharmacy:dev  # Pharmacy agent — http://localhost:4004
```

**Important**: agent servers accept connections immediately but only mount their full route set *after* their ledger-registration attempt finishes — wait for each agent's own `"...routes mounted. Ready."` log line before hitting its API, especially on a network where ledger connectivity is restricted (see below).

### Run the web app

```bash
cd apps/web
npm run dev    # http://localhost:3001 (bound to 0.0.0.0 — reachable from a phone on the same WiFi too)
```

Open `/government`, `/doctor`, or `/patient`. See "Using MediTrust — A Plain-English Guide" further down this file for a full non-technical walkthrough of each portal.

### Run the benchmark and end-to-end test

```bash
npm run benchmark   # all 8 experiments + 5 attack simulations → benchmark/results/
npm run e2e-test    # full DID → VC → storeRecord → shareRecord → selective read → revokeAccess flow → e2e/results/
```

Both scripts attempt every step for real against the actually-running services above (no mocking) and honestly report `blocked`/`degraded` for any step that specifically needs ledger connectivity this network doesn't have, rather than fabricating a result.

### A real network caveat, not a code bug

Real credential issuance, ledger DID resolution, and schema/credential-definition registration all need a raw TCP connection to BCovrin's validator nodes (`138.197.138.255`, ports 9701–9708) — separate from the plain HTTPS endpoint used to *register* a DID, which works fine everywhere. Some networks block outbound traffic on these unusual ports by default. If you see `Pool timeout: Request was interrupted` in an agent's logs, that's this — try a different network (mobile hotspot, VPN) rather than assuming something is broken. Every script in this repo is designed to degrade gracefully and report honestly when this happens, rather than crash or fake a result.

---

## Operation Fullbring — Key Recovery & Backup

Two real, previously-disconnected gaps were closed in this pass: every patient's data used to be encrypted with one single system-wide key, and the "3 people can rebuild a lost key" recovery system had only ever practiced on a fake test key — never the real thing. Now:

- **Every patient gets their own real key**, generated the moment they're first used (`getOrCreateMEK`), not shared with anyone else.
- **"I lost my own phone"** → self-custody: `POST /dwn/patients/:patientDID/self-custody/initiate` splits the key 3 ways (any 2 rebuild it) across things only the patient owns. Shares are returned to the caller and **never persisted server-side** — that's the point. `POST .../self-custody/restore` takes ≥2 shares back and reconstructs.
- **"The patient can't act for themselves"** → the existing institutional MPOA flow (`crypto/sss`, patient+hospital+guardian, 5-way split/threshold 3) — unchanged governance, now bridged to the real key via `POST /dwn/patients/:patientDID/mpoa/initiate-split` and `.../mpoa/complete-restore`. Approvals now require a real Ed25519 signature verified against a public key the patient registered out-of-band (`POST /sss/mpoa/register-key`) — previously any non-empty string was accepted.
- **Every write backs itself up** — `POST /dwn/patients/:patientDID/restore-data` (after the key is back) pulls every incremental, MEK-encrypted backup entry down and rebuilds the store from scratch.
- **Consent receipts and the patient's own key-management events are signed with the patient's own key** (`patient-signing-key.ts`), not a shared server secret — verifiable independently of whoever operates the DWN.

Full details, including the exact live "device destroyed" test that proves this end to end, are in `CLAUDE.md`'s "Operation Fullbring" section.

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
| Consent | DWN Permissions (enforcement) + a patient-signed Consent Receipt |
| MongoDB | Removed entirely from all layers |
| Encryption | AES-256-GCM at rest, real per-patient MEK (not one shared system-wide key) |
| Consent/audit signing | Each patient's own ECDSA P-256 keypair — not a shared server secret |
| Self-custody key recovery | 3 shares, threshold 2, patient's own devices only |
| Institutional (emergency) key recovery | 5 shares, threshold 3 — Patient + Hospital + Guardian, real signature-verified approvals |
| DID hierarchy | 2-tier: doctor-agent stands in for the hospital directly. A 3-tier Government → Healthcare-Authority → Doctor chain was built, live-tested, and deliberately reverted — see CLAUDE.md |
| Smart contracts | **Permanently out of scope** — Indy has no VM layer; not a placeholder, not revisited |
| Legacy PoC | Kept for reference — not deleted, not run in parallel |
| Frontend | Real Next.js app, 3 pages (government/doctor/patient) — its own separate `package.json` |

---

## Honest Limits

Every one of these is documented in detail in `CLAUDE.md` — named here so they're not mistaken for gaps that were missed rather than deliberately scoped:

- **Off-device backup replication is not fully proven.** The only backup destination actually exercised live is a directory tree on the *same machine*. Google Drive (the one genuine off-device option) is real, complete code that has never run against real credentials.
- **Approver public keys prove a signature, not a real-world identity.** MPOA's registered approver keys close the "anyone can forge a signature" gap, but nothing binds a registered key to the actual hospital/guardian it claims to represent — that needs a real institutional DID/credential.
- **`DWN_MASTER_KEK` is still one single, un-split device-level secret** that wraps every patient's individual MEK and signing key.
- **MPOA's duplicate-approval check is per-role, not per-DID** — a single DID could in principle submit approvals for all three roles, a known, deliberately-left limitation.
- **Bifold is unmodified.** It only ever carries identity/credential DIDComm flows — self-custody, backup status, and restore all live in the web app, not inside the wallet.
- **Ledger pool connectivity is blocked on the network this was built on** — 2 of 8 benchmark experiments and all real credential issuance report `blocked`/`degraded` for that reason, not a code defect.

---

## Testing

```bash
npx tsc --noEmit                      # root type-check
(cd apps/web && npx tsc --noEmit)     # frontend type-check
npm run e2e-test                      # full 10-step real flow
npm run benchmark                     # 8 experiments + 5 attack simulations
```

Beyond the automated suites, this project has been live-tested end to end for: a full "device destroyed" self-custody recovery (kill the process, wipe its data directory, recover the key from 2 of 3 shares, restore data, confirm byte-identical records); the same scenario via the institutional MPOA path with real Ed25519-signed approvals; 15-way concurrent writes with no dropped or colliding backup entries; binary file (image) round-tripping byte-for-byte; and a battery of adversarial inputs (malformed base64, invalid expiry dates, forged/cross-role-reused MPOA signatures, tampered audit rows) all correctly rejected.

---
---

# Using MediTrust — A Plain-English Guide

Everything above this line is technical documentation. Everything below is for actually **using** the app — no code, no technical background assumed.

## What is this, in one paragraph?

MediTrust is a demo healthcare system where **you own your own medical records**, not a hospital or a company. Your identity and your medical documents are protected by encryption only you control. If you lose your phone or computer, you can get your data back using either your own backup pieces or (in an emergency) help from people you trust — nobody else can read your data along the way.

---

## Before you start

Someone (usually a developer following the technical documentation above) needs to have the following running on a computer:

| Service | What it does | Address |
|---|---|---|
| The web app | The screens you'll actually click through | `http://localhost:3001` |
| Government agent | Issues your identity | (runs in the background) |
| Doctor agent | Issues medical records/prescriptions | (runs in the background) |
| Your personal data vault (DWN) | Stores your encrypted records | (runs in the background) |

You'll also need **Bifold** — a free digital wallet app — installed on your phone, if you want to actually receive and hold credentials the way a real patient would. If you're just testing on a laptop, a stand-in test wallet is used instead and you won't need Bifold.

Open a browser and go to the web app's address. You'll see three cards: **Government Portal**, **Doctor Portal**, and **Patient Dashboard**.

---

## Part 1 — Getting your identity (as a patient)

1. Open the **Government Portal**.
2. A QR code appears. Open Bifold on your phone and scan it.
   - *(If you're not using a phone, a test wallet connects automatically — you'll see "Connected to wallet" appear on the page instead.)*
3. Once connected, fill in your details: name, age, email, national ID, blood type, emergency contact, medical condition.
4. Click **Issue identity credential**.
5. Check your Bifold wallet — you should see a new credential offer arrive. Accept it.

You now have a digital identity credential. This is what proves who you are to doctors and pharmacies later, without you having to hand over a physical ID card.

> **Note:** on some networks, the credential arrives as a simpler digital message instead of the fully cryptographic version — you'll see a note about this on the page. This is a known limitation of the test network this demo runs on, not something wrong with your setup.

---

## Part 2 — Getting a medical record (as a patient, with a doctor)

1. Open the **Doctor Portal** (this simulates a doctor's office issuing you a record).
2. Scan the QR code with Bifold, same as before.
3. Choose **Medical record** or **Prescription** using the two buttons.
4. Fill in the patient name, ID, diagnosis, and prescription details.
5. Click **Issue medical record** (or **Issue prescription**).
6. The record is sent to your wallet **and** automatically saved into your own personal data vault, encrypted with a key only you control.

You'll see a small note confirming it was written to your vault, with a record ID.

---

## Part 3 — Managing your own data (Patient Dashboard)

Open the **Patient Dashboard**. The first time, it will ask for your DID (a long identifier like `did:peer:1...`) — this is the same identifier your wallet used when connecting to the Government or Doctor portal. Paste it in and click **Open**.

### Viewing your records

The **Your records** section lists everything stored in your vault. Click **Refresh** any time to check for new entries. Each record shows its type (medical, prescription, etc.) and its content — this is only ever visible to you, decrypted just for this view.

### Controlling who else can see your data

The **Consent management** section is how you let someone else — a pharmacist, an insurer, anyone — see a *specific* record type, for a *specific* reason:

1. Enter the other party's ID in **Grantee DID**.
2. Choose the record type (medical, prescription, lab report).
3. Enter a purpose (e.g. "dispensing", "insurance claim").
4. Click **Grant access**.

To take access away again, enter the same details and click **Revoke access**. This takes effect immediately — the next time that party tries to read your data, they're refused.

### Setting up key recovery (do this once, early)

Your data is protected by a personal encryption key that only exists on your own device. If that device is lost, damaged, or stolen, that key — and everything it protects — would be gone forever, unless you've backed it up in advance. That's what this section is for.

In the **Key recovery & backup** section:

1. Click **Generate 3 recovery shares**.
2. You'll see three pieces of text appear, labelled `primary_device`, `paper_backup`, and `secondary_device`.
3. **Save each one somewhere different and safe:**
   - Copy the `primary_device` piece and keep it on your phone.
   - Print or write down the `paper_backup` piece and store it somewhere physical, like a safe or a locked drawer.
   - Copy the `secondary_device` piece onto a second device you own (a tablet, a second phone, a USB drive).

You only ever need **any two of the three** to get your data back. Losing one piece is not a problem — losing two at once (for example, keeping the paper backup taped to the back of the phone) defeats the point, so keep them genuinely separate.

Nobody else — not a hospital, not this app's own servers — ever holds a usable copy of these pieces. That's what makes this "self-custody."

### If your device is lost (restoring your data)

If you get a new device and need your data back:

1. Open the **Patient Dashboard** on the new device.
2. In **Key recovery & backup**, paste in any **two** of your three saved shares into the **Restore** boxes.
3. Click **Reconstruct key & restore data**.
4. Wait a moment — the app will rebuild your key, then pull your encrypted data back down and unlock it.
5. Go back to **Your records** and click **Refresh** — everything should reappear exactly as it was.

---

## Part 4 — The emergency path (if you can't act for yourself)

Ordinary lost-device recovery (above) assumes you're the one doing the recovering. For the rarer situation where you genuinely cannot act — unconscious, incapacitated, a minor — there's a separate, deliberately more involved process requiring approval from three trusted parties (you, a hospital, and a guardian) before anyone can act on your behalf. This exists specifically so no single person — not even a hospital alone — can ever unilaterally access your data; all three must agree first. This flow is currently only reachable through the underlying service directly (not yet its own page in the app) — ask whoever administers your MediTrust instance if you need to use it.

---

## Part 5 — As a pharmacist or insurer

There isn't a dedicated portal page for this role yet. In the meantime, a pharmacist verifies a patient's identity and prescription the same way any verifier does in this ecosystem: by requesting a proof through Bifold and checking the result, using the underlying pharmacy service directly. Ask a developer running the project for the specific steps if you need to test this role.

---

## Troubleshooting

| Problem | What's happening |
|---|---|
| QR code doesn't scan / connection never completes | Make sure your phone is on the same WiFi as the computer running the app, or try the ngrok fallback (ask whoever set up the project) |
| Credential shows as a "structured message" instead of a normal credential | Expected on networks that block this project's test blockchain connection — not an error in your data |
| Patient Dashboard shows no records after entering my DID | Double check you copied the exact DID your wallet used for that specific connection — a new connection gets a new DID |
| I can't remember my DID | It's shown on-screen the moment a connection completes on the Government or Doctor portal — copy it somewhere before navigating away |
| I only have one recovery share saved | You need at least two of the three to restore — if you only saved one, recovery isn't possible for that key. Set up recovery again as soon as you can and save all three properly this time |
