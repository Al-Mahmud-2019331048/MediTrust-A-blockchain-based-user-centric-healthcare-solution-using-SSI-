# MediTrust — Decentralised Patient-Centric Healthcare SSI System

MediTrust is a thesis implementation of a healthcare identity and records system where the patient, not a hospital, owns their data. Identity runs on Self-Sovereign Identity (Hyperledger Indy + Credo-TS), medical records live encrypted in the patient's own Decentralised Web Node (DWN), and the patient can recover everything if they lose their device.

---

## What It Does

MediTrust follows the SSI trust triangle: an issuer gives the patient a credential, the patient holds it in their wallet, and a verifier checks it.

- The **government** issues the patient a digital identity credential.
- A **doctor** verifies that identity with a zero-knowledge proof, then issues a medical record or prescription.
- The record is written, encrypted, into the **patient's own DWN**. Nobody can read it unless the patient grants access.
- A **pharmacy** verifies the patient and their prescription.
- The patient can share specific fields with specific parties, revoke access at any time, and recover their encryption key if their device is lost.
- Every action is written to a signed audit log, and key events are anchored on the Indy ledger.

There is no MongoDB or central database. Data is either on the ledger (Indy), in embedded files (LevelDB for the DWN, SQLite for the audit log), or in memory.

Smart contracts are not part of the design. Indy has no virtual machine, so consent and audit are handled with signed credentials and a signed log.

---

## Architecture

```
Patient (Bifold wallet on a phone, or an automated test wallet)
        │  DIDComm (QR code invitation)
        ▼
Government Agent           :4000  Issues patient identity credentials and hospital authorisations
Healthcare Authority Agent :4006  Issues professional-role credentials to doctors
Doctor Agent               :4002  Verifies patient identity (ZKP), issues medical records/prescriptions
Pharmacy Agent             :4004  Verifies patient identity and prescriptions
        │
        │  The doctor writes the record into the patient's DWN
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  Patient DWN  :5050                                                │
│                                                                    │
│  Records        store and read records                             │
│  Permissions    grant / revoke access to a record type             │
│  Protocols      field-level redaction, W3C Verifiable Presentations│
│  Encryption     AES-256-GCM with a key unique to each patient      │
│  Signing key    each patient signs their own consent and actions   │
│  Recovery       self-custody (5 shares, any 3) and MPOA bridge     │
│  Backup         every write is pushed, encrypted, to a backup      │
│  Storage        LevelDB                                            │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ audit event on every operation
                               ▼
Audit Service        SQLite via Prisma, every event signed and verifiable
SSS / MPOA Service   :4008  Shamir key splitting + patient/hospital/guardian approvals
Backup Provider      :4010  Stores encrypted backups, authenticated by the patient's key
Hyperledger Indy     BCovrin TestNet — DIDs, schemas, credential definitions, hash anchors
Web App              :3001  Government, Doctor, Pharmacy and Patient portals
```

The trust chain is three levels: Government → Healthcare Authority → Doctor.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js **20.14.0** (newer versions break DIDComm delivery, see below) |
| Language | TypeScript 5, run with `tsx` |
| SSI framework | Credo-TS 0.5.x (AnonCreds, Askar wallet, Indy VDR) |
| Ledger | Hyperledger Indy, BCovrin TestNet |
| Selective disclosure | AnonCreds zero-knowledge proofs + DWN field-level redaction |
| Record storage | LevelDB (embedded) |
| Audit storage | SQLite via Prisma |
| Encryption | AES-256-GCM, one key per patient |
| Signing | ECDSA P-256 per patient; Ed25519 for MPOA approvals |
| Key recovery | Shamir Secret Sharing — 5 shares, any 3 rebuild the key |
| Health data format | Records also carry an HL7 FHIR R4 representation (`DocumentReference`, `MedicationRequest`) |
| Mobile wallet | Bifold (Android build with an updated ledger genesis file) |
| Frontend | Next.js 15 + React 18 |

---

## The 10 Modules

| # | Module | Status |
|---|--------|--------|
| 1 | SSI identity layer — DIDs, key pairs, Indy registration | Done |
| 2 | Verifiable credentials — issue, hold, verify | Done |
| 3 | Digital wallet — Bifold on the phone, Askar for the agents | Done |
| 4 | Selective sharing — ZKP attribute disclosure, DWN field filtering, W3C VP | Done, tested on a real phone |
| 5 | DWN — Records, Permissions, Protocols on LevelDB | Done |
| 6 | Encryption — AES-256-GCM with per-patient keys | Done |
| 7 | Key recovery — self-custody and MPOA multi-party approval | Done, both paths tested by destroying and restoring a device |
| 8 | Consent — DWN permissions plus a patient-signed consent receipt | Done |
| 9 | Audit trail — signed, persistent, tamper-evident, ledger-anchored | Done |
| 10 | Security evaluation — 8 experiments and 5 attack simulations | Done |

---

## Repository Structure

```
.
├── agents/
│   ├── shared/                      BaseAgent, routes, network config, FHIR mapper, DWN client
│   ├── government-agent/            port 4000
│   ├── healthcare-authority-agent/  port 4006
│   ├── doctor-agent/                port 4002
│   └── pharmacy-agent/              port 4004
│
├── dwn/patient-node/                Patient DWN, port 5050
│   └── src/  interfaces/ encryption/ backup/ storage/ routes/ utils/
│
├── audit/                           Audit service + Prisma schema
├── backup-provider/                 Encrypted backup store, port 4010
├── crypto/
│   ├── encryption/                  AES, hashing, signing helpers
│   └── sss/                         Shamir splitting, self-custody, MPOA, port 4008
│
├── apps/web/                        Next.js frontend (own package.json)
├── benchmark/                       Experiments, attack simulations, figures, results
├── e2e/                             End-to-end flow test
├── scripts/                         start-all.sh, stop-all.sh, genesis check
│
├── demo/credo/, interface/          Original PoC, kept for reference
```

---

## Running It Locally

### 1. Install

```bash
nvm use 20.14.0
npm install
cd apps/web && npm install && cd ..
```

### 2. Configure

Create `.env` in the repo root. Never commit it, and don't touch `demo/credo/.env`.

```bash
# Secrets you generate yourself
DWN_MASTER_KEK=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
DOCUMENT_SIGNING_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
AUDIT_SIGNING_SECRET=<same command>
VP_SIGNING_SECRET=<same command>
PROTOCOL_ADMIN_SECRET=<same command>

# One DID per agent, registered as ENDORSER at https://test.bcovrin.vonx.io/register
GOVERNMENT_DID=...            GOVERNMENT_SEED=...
HEALTHCARE_AUTHORITY_DID=...  HEALTHCARE_AUTHORITY_SEED=...
DOCTOR_DID=...                DOCTOR_SEED=...
PHARMACY_DID=...              PHARMACY_SEED=...

GOVERNMENT_AGENT_BASE_URL=http://localhost:4000

# Public DIDComm endpoints — use your LAN IP so a phone can connect
ISSUER_AGENT_PUBLIC_ENDPOINT=http://<LAN-IP>:4001
DOCTOR_AGENT_PUBLIC_ENDPOINT=http://<LAN-IP>:4003
PHARMACIST_AGENT_PUBLIC_ENDPOINT=http://<LAN-IP>:4005
HEALTHCARE_AUTHORITY_AGENT_PUBLIC_ENDPOINT=http://<LAN-IP>:4007
```

Create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_GOVERNMENT_URL=http://<LAN-IP>:4000
NEXT_PUBLIC_DOCTOR_URL=http://<LAN-IP>:4002
NEXT_PUBLIC_PHARMACIST_URL=http://<LAN-IP>:4004
NEXT_PUBLIC_HEALTHCARE_AUTHORITY_URL=http://<LAN-IP>:4006
NEXT_PUBLIC_DWN_URL=http://<LAN-IP>:5050
```

Get your LAN IP with `ipconfig getifaddr en0`. Use `localhost` if you're only testing on the laptop.

### 3. Start everything

```bash
npm run dev:all     # starts every service, refreshes the LAN IP and credential-definition IDs
npm run stop:all    # stops everything
```

Logs go to `/tmp/meditrust-logs/<service>.log`. Each agent is ready when it prints `routes mounted. Ready.`

Each agent registers its credential definitions on the ledger at startup. Check the log for `registered:`. If it says `registration failed`, the ledger rejected that write, which usually happens when several agents write at the same moment. Restart that agent on its own (`npm run gov:dev`, `ha:dev`, `doctor:dev`, `pharmacy:dev`). Restart government first and doctor before pharmacy, because doctor and pharmacy read government's and doctor's IDs from `.env`.

Then open `http://<LAN-IP>:3001`.

### 4. Test

```bash
npx tsc --noEmit && (cd apps/web && npx tsc --noEmit)   # type-check
npm run e2e-test    # full 10-step flow against the running services
npm run benchmark   # 8 experiments + 5 attack simulations → benchmark/results/
```

---

## Key Recovery and Backup

Every patient has their own encryption key, created the first time they're used. There are two ways to get it back:

- **Self-custody.** The patient splits their key into 5 shares and keeps them in different places (phone, paper, second device, cloud, safe). Any 3 rebuild it. The server never stores the shares. Each share is labelled with the account ID, so a share from one account can't be used on another.
- **MPOA (emergency).** For when the patient can't act for themselves. Three parties must approve: the patient, a hospital, and a guardian. Each approval is a real Ed25519 signature checked against a registered key.

Every write is also backed up, encrypted, to the backup provider. Once the key is recovered, the patient's records and permissions are restored from that backup, including their ledger anchor references.

Both paths have been tested by deleting a DWN's entire data directory, starting a blank one, recovering the key from 3 shares, and confirming the restored records were byte-for-byte identical.

---

## Experiments — Latest Results (2026-10-29)

| Experiment | Result |
|-----------|--------|
| VC issuance time | 4.6 s |
| VC verification time | 15.7 s |
| Blockchain transaction latency | 1.98 s |
| DWN storage overhead | 1.35× (encrypted vs. plaintext) |
| Selective sharing overhead | no measurable cost |
| SSS recovery time | 0.23 ms |
| Key recovery success rate | 100% |
| Access revocation time | ~7 ms |

All 5 attack simulations pass: reading without a grant, recovering with only 2 shares, MPOA before all approvals, an expired MPOA request, and a tampered audit entry.

Ledger-dependent timings vary with the BCovrin test network's load. Full results are in `benchmark/results/`.

One finding worth knowing: in AnonCreds, a selective-disclosure proof is **larger** than a full reveal (about 19 KB vs. 5.5 KB). Every hidden attribute needs its own zero-knowledge proof value, so hiding costs more than showing. The privacy gain is real; the size saving you'd see with schemes like BBS+ doesn't apply here.

---

## Known Limits

- The government agent doesn't connect to a real national ID database. The officer enters the patient's details in the Government Portal. In a real deployment, that's where the national ID check would happen.
- Keys are kept in software wallets (Askar), not hardware security modules.
- `DWN_MASTER_KEK`, which protects each patient's key on the device, is a single secret.
- The DWN, backup provider and agents each run as a single server. They're patient-controlled, but not distributed the way the Indy ledger is.
- MPOA checks for duplicate approvals per role, not per DID.
- Registered MPOA approver keys prove a signature, not a real-world identity.
- BC Wallet rejects this project's invitations; the updated Bifold build works.
- BCovrin is a public test network and sometimes rejects writes under load. Retrying works.
- The system runs over plain HTTP on the local network.
- FHIR output is structurally valid R4, but uses text rather than coded terminology (SNOMED, LOINC). It isn't a full FHIR API.

---

## Troubleshooting (Technical)

| Problem | Fix |
|---|---|
| `MessageSendingError: Message is undeliverable` | Wrong Node version. Run `nvm use 20.14.0` and restart. |
| `UnauthorizedClientRequest ... forbidden` in an agent log | The ledger rejected a burst of writes. Restart that agent on its own. |
| `Pool timeout` | The bundled genesis may be stale. `scripts/check-genesis.js` checks it against `https://test.bcovrin.vonx.io/genesis`. |
| Doctor or pharmacy identity check fails | `ISSUER_CRED_DEF_ID` / `DOCTOR_MEDICAL_CRED_DEF_ID` in `.env` are out of date. Restart via `npm run dev:all`, or copy the new IDs from the logs and restart the consuming agent. |
| Phone can't connect | Phone and laptop must be on the same network, and the LAN IP in both `.env` files must be current. |

---
---

# Using MediTrust — A Plain-English Guide

This part is for using the app. No technical background needed.

## What is this?

MediTrust is a demo healthcare system where you own your medical records. Your identity and documents are protected by encryption that only you control. If you lose your phone or computer, you can get your data back with your own backup pieces or, in an emergency, with approval from people you trust.

## Before you start

Someone needs to start the system on a computer (see "Running It Locally" above). You'll need:

- The web app address, for example `http://192.168.x.x:3001`
- The **Bifold** wallet app on your phone, on the same network as the computer

The home page shows four portals: **Government**, **Doctor**, **Pharmacy** and **Patient**.

---

## Part 1 — Get your identity (Government Portal)

1. Open the **Government Portal**.
2. Scan the QR code with Bifold.
3. Fill in your details: full name, age, email, national ID, and optionally medical condition, blood type and emergency contact.
4. Click **Issue identity credential**.
5. Accept the credential offers in Bifold. There are two: your core identity, and a separate health profile.

You'll get a **Patient Account ID**. Save it. It's how you open your dashboard later, and it's also printed on your recovery shares.

---

## Part 2 — Get a medical record (Doctor Portal)

1. Open the **Doctor Portal** and scan the QR code with Bifold.
2. The doctor clicks **Verify patient identity**. Bifold asks you to share a proof. Accept it.
   - The doctor only sees your name, national ID, account ID, and that you're over 18. Your medical condition and blood type stay private.
3. Your Patient Account ID fills in automatically and shows **Identity verified**.
4. The doctor chooses **Medical record** or **Prescription**, fills in the details, optionally attaches a PDF or image, and clicks **Issue record**.
5. The record arrives in Bifold and is saved, encrypted, in your personal data vault.

If the proof fails, the doctor can use **Enter manually instead**. The record is then marked **Unverified (manual ID)**.

---

## Part 3 — Your Patient Dashboard

Open the **Patient Dashboard**, enter your Patient Account ID, and click **Open**.

### Your records

Everything in your vault is listed here and decrypted only for you. Click **Refresh** to check for new ones.

### Notifications

Shows who has written to or read your records, and when access was granted or revoked.

### Consent management

To let someone else (a pharmacist, an insurer) see a record type:

1. Enter their ID in **Grantee DID**.
2. Choose the record type and enter a **Purpose**.
3. Click **Grant access**.

To take it back, enter the same details and click **Revoke access**. It takes effect immediately.

### Key recovery & backup (do this once, early)

Your data is locked with a key that lives on your device. If the device is lost, so is the key, unless you've made recovery shares.

1. Under **Set up**, click **Generate 5 recovery shares**.
2. Save each share somewhere different: your phone, a printed paper backup, a second device, your own cloud backup, a safe deposit box.

Any **3 of the 5** will restore your key. Keep them genuinely separate. No hospital or server keeps a copy.

### If you lose your device

1. Open the Patient Dashboard on the new device with your Patient Account ID.
2. Under **Restore (lost device)**, paste in any 3 of your shares.
3. Click **Reconstruct key & restore data** once and wait.
4. Go to **Your records** and click **Refresh**. Everything comes back as it was.

If you paste a share that belongs to a different account, the dashboard tells you before you restore.

---

## Part 4 — The emergency path

If you can't act for yourself (for example, you're unconscious), your key can be recovered with approval from three parties: you (or your registered key), a hospital, and a guardian. All three must approve. No single party, not even a hospital, can do it alone. This flow runs through the recovery service directly and doesn't have its own page yet.

---

## Part 5 — Pharmacy Portal

1. Open the **Pharmacy Portal** and scan the QR code with Bifold.
2. Click **Verify patient identity** and accept the proof in Bifold.
3. Check the prescription in one of two ways:
   - **Wallet proof (ZKP)**: Bifold proves the prescription credential.
   - **DWN vault read**: click **Read from DWN** to read the prescription from the patient's vault. This needs the patient to have granted the pharmacy access.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| The QR code won't connect | Make sure your phone is on the same Wi-Fi or hotspot as the computer. |
| The doctor's identity check keeps waiting | Open Bifold and accept the proof request. If you declined it, the doctor can send a new one. |
| The dashboard shows no records | Check you entered the right Patient Account ID. It's shown when your identity is issued and printed on your recovery shares. |
| "This share belongs to a different account" | That share is for another Patient Account ID. Use shares from your own account. |
| I only have 1 or 2 shares | You need 3 to restore. If you still have access, generate a new set and store them properly. |
