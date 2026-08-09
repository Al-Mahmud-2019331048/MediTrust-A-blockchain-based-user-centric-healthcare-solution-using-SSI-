# CLAUDE.md — MediTrust Project Guide

> Read this file at the start of every session. Update it whenever a decision is made, a module is completed, or a constraint is discovered.
> Implementation pace: one module at a time. Do NOT implement anything the user has not explicitly approved for that session.
> **Housekeeping note (2026-07-22):** this file was aggressively trimmed to control size — old entries were condensed to their essential facts (what was wrong / what was decided / what's still true), dropping the blow-by-blow narrative of how each was found. If you need the full story behind an old entry, check git history/commit messages, not this file.

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
- **Encryption:** AES-256-GCM at rest + per-record key wrapping.
- **Consent:** DWN Permissions interface (enforces access) + Verifiable Consent Receipt VC on Indy (cryptographic proof)
- **Audit:** Signed, structured, persistent audit log (SQLite via Prisma)
- **Key recovery:** Shamir Secret Sharing (5 shares, any 3 recover) + MPOA multi-party approval
- **No MongoDB anywhere**

The legacy PoC (`demo/credo/` + `interface/`) is kept as reference. All new work goes into the top-level folders.

---

## The 10 Required PoC Modules — All Done

| # | Module | Status |
| - | ------ | ------ |
| 1 | SSI Identity Layer | Done (`demo/credo/`) |
| 2 | Verifiable Credential System | Done (`demo/credo/`) |
| 3 | Digital Wallet | Done (Bifold + Credo-TS/Askar) |
| 4 | Selective Sharing (core contribution) | Done — ZKP attribute-level disclosure (AnonCreds) + DWN Protocol field filtering + W3C VP generation, all independently proven live. **ZKP pathway now proven on real physical hardware too (2026-07-27)** — previously always blocked by Bifold's stale genesis, see "Bifold Wallet Genesis Fix" below |
| 5 | DWN Implementation | Done — Records + Permissions + Protocols, LevelDB, real on-chain hash anchoring built |
| 6 | Encryption Layer | Done — real per-patient MEK (Operation Fullbring), AES-256-GCM |
| 7 | MPOA + SSS Key Recovery | Done — self-custody + institutional paths, both live-tested against the real key |
| 8 | Consent Management | Done — DWN Permissions + patient-signed Consent Receipt VC |
| 9 | Audit Trail | Done — SQLite + signed JWT, tamper-detection proven live, on-chain anchoring built (see Known Constraints) |
| 10 | Security Evaluation | Done — `benchmark/run-experiments.ts`; see Experiments table below for current (2026-07-22) status |

---

## The 8 Required Experiments — Status as of 2026-07-22

| Experiment | Metric | Status |
| ---------- | ------ | ------ |
| VC issuance time | ms | Real number, but frequently reports `degraded` (falls back to W3C message) whenever that boot's AnonCreds schema registration didn't land — see "Ledger connectivity" below |
| VC verification time | ms | Same dependency as above — only measurable when a real AnonCreds credential exists |
| Blockchain transaction latency | seconds | **Real writes now succeed** (root cause fixed 2026-07-22 — see below), but individual attempts are still intermittently rejected by BCovrin's pool under bursty/concurrent load; re-running usually gets a real number |
| DWN storage overhead | KB/MB | Real, consistent — ~1.35 ratio |
| Selective sharing overhead | ms | Real, consistent — filtered vs. full read within ~1-2ms of each other |
| SSS recovery time | ms | Real, consistent |
| Key recovery success rate | % | Real, 100% |
| Access revocation time | seconds | Real, consistent — ~5-8ms |

Bonus: SSS split time (ms) — real.
Attack simulations: all 5 pass consistently.

Results in `benchmark/results/`.

---

## Ledger Connectivity — Root Cause Found and Fixed (2026-07-22)

**For most of this project's history, "blockchain transaction latency" and "VC verification time" were documented as blocked by an environment-level network restriction (raw TCP to BCovrin's validator ports supposedly firewalled). That diagnosis was wrong.**

**Real root cause:** `agents/shared/network/network-config.ts`'s bundled `BCOVRIN_GENESIS` constant only ever contained the network's **original 4 validator transactions** (`Node1`-`Node4` at `138.197.138.255`). BCovrin has since decommissioned those 4 nodes and promoted a new set (`BCovrin01`-`BCovrin04` at `130.107.207.129`) — recorded in *later* genesis transactions our bundled copy never included. So every ledger operation was trying to reach dead servers and timing out — indistinguishable from a real network block, but actually just a stale config file.

**Fix:** replaced the bundled genesis with the full, current file fetched live from `https://test.bcovrin.vonx.io/genesis`. Confirmed immediately: government, doctor, and healthcare-authority agents all registered **real schema + credential definitions on Indy** on their very next boot — the first time this has ever happened in this project. Raw TCP to all 8 ports on the new validator IP succeeded, including over a mobile hotspot connection.

**Honest residual limitation:** BCovrin is a small public test network, and individual write attempts still occasionally fail with real (not connectivity-related) ledger errors — e.g. a `UnauthorizedClientRequest ... forbidden` rejection seen on one attempt, likely a write-frequency policy, and general pool flakiness under bursty multi-agent load (confirmed: isolated calls succeed reliably; calls made close together with other pool activity in flight sometimes don't). This is now accurately understood as "an unreliable public test network," not "blocked connectivity" — retrying usually works.

**Separate limitation found the same day: Bifold's own bundled genesis was equally stale — FIXED 2026-07-27, see "Bifold Wallet Genesis Fix" section below.** Decompiled the supervisor-provided Bifold APK (`base.apk`, via `apktool`) and confirmed its compiled JS bundle (`assets/index.android.bundle`) contained the identical old 4-transaction genesis (`138.197.138.255`), with **zero** reference to the current validator set — this is why the phone could never resolve/verify a credential definition against the real, live ledger. Two fix attempts were made; the one that worked was binary-patching `base.apk`'s genesis directly rather than rebuilding from source. Full story, including a real Credo-TS version-compatibility bug found along the way, in the dedicated section below.

**Workaround used for live phone testing before the fix (historical, no longer needed as of 2026-07-27):** the project has two independent selective-sharing mechanisms (see Module 4) — the ZKP/AnonCreds one (was blocked by Bifold's stale genesis) and the **DWN Protocol-based field-redaction one** (`shareRecord`/`queryRecord`), which never touches AnonCreds or the ledger at all. The Doctor Portal's identity-verification step already had a manual-entry fallback for exactly this "ZKP proof failed" scenario (deliberately hidden until the proof genuinely fails, so it can't be misused to skip real verification). Live-proved end-to-end on the physical phone: doctor connects via DIDComm (real) → ZKP proof request times out as expected → manual Patient Account ID entry → doctor issues a real record to the patient's DWN → patient grants the doctor's DID access restricted to specific fields via the Consent Manager → doctor reads it back and sees only the allowed fields. This workaround remains in the code (still useful if a proof genuinely fails for any other reason) but is no longer the only path — the real ZKP pathway now works end-to-end on real hardware too.

---

## 3 Real Bugs Found and Fixed During This Same Live Phone-Testing Session (2026-07-22)

1. **`apps/web/src/hooks/usePolling.ts` — stale closure bug.** The polling `useEffect` only depended on `[enabled]`, not on the `checkFn`/`onSuccess` closures themselves (which are fresh every render and capture whatever `oobId` was current at that render). Once `enabled` settled to `true`, the effect never re-ran, so the `setInterval` kept calling the **first** render's stale closure forever — meaning if the invitation ID it was tracking changed after the interval started, polling silently kept checking the wrong (abandoned) one. **Fixed:** added latest-value refs for `checkFn`/`onSuccess`/`onTimeout` so the interval always calls current logic, regardless of how many times the enclosing component re-rendered.
2. **`apps/web/src/components/ConnectionSetup.tsx` — Strict Mode double-invoke race.** Next.js dev mode's React 18 Strict Mode double-invokes mount effects, so `generateQR()` ran twice per page load, creating two separate DIDComm invitations. Whichever network response resolved last silently overwrote the displayed QR code and the polling target — meaning if a user scanned the QR that was displayed *first* but the *second* invitation's response arrived later, the connection would complete against the first invitation while the frontend polled forever for the second, orphaned one. Reproduced exactly this way live (a real connection completed server-side, but the Doctor Portal stayed stuck on the QR screen). **Fixed:** standard React "ignore stale effect" pattern — a `stale` flag set by the effect's cleanup function, checked before ever applying an invitation's result to state, so only the invocation that survives to the end of its async work (i.e., isn't superseded by Strict Mode's remount) ever updates the UI.
3. **`agents/doctor-agent/src/routes/medical-routes.ts` — `identityVerified` leaking into AnonCreds credential attributes.** Both `/issue-medical-credential` and `/issue-prescription` built the real-AnonCreds-path `attributes` array directly from the same `documentData` object used for the DWN write — but `documentData` includes `identityVerified` (added for DWN-record provenance, distinguishing a cryptographically-verified doctor read from a manually-typed one), which is **not** one of the registered `medical_document_credential` schema's attribute names. Credo-TS correctly rejected every real issuance attempt with a schema-mismatch 500 error (`difference is: identityVerified`), confirmed live. **Fixed:** the AnonCreds `attributes` array is now built from `documentData` with `identityVerified` explicitly excluded; the DWN write still receives the full object unchanged.

All three fixes are live, hot-reloaded, and confirmed working in the same session (real connections completing and being detected correctly afterward; real AnonCreds credential offers no longer 500ing).

---

## Selective-Disclosure Benchmark (2026-07-25) — Real Numbers, and Why They Don't Match a Supervisor-Given Target

**Ask:** test the system against a supervisor-provided paragraph claiming selective-disclosure proofs reduce payload by 63%, cost 35ms extra latency, and stay sub-second up to ~50 concurrent workflows.

**Built:** `benchmark/selective-disclosure-experiments.ts` (new) — payload/latency comparison (selective 3-attr+predicate vs. full 8-attr reveal, both with and without the predicate isolated) and a concurrency ramp, wired into `run-experiments.ts`.

**Real, reproduced result: the opposite of the target.** Selective disclosure is **~215% *larger*** than a full reveal (19,520 vs. ~6,200 bytes), reproduced identically across 3 independent runs, **with and without the age predicate** (ruling out the predicate as the cause). Root cause: AnonCreds/CL-signatures require a real zero-knowledge "proof of knowledge" value for every *hidden* attribute — revealing more attributes means fewer hidden ones, means a smaller proof. Hiding costs more than showing, in this specific scheme. The 63%/35ms target almost certainly describes a BBS+/JWT-VC-style scheme, where omitting fields really is cheap — a real, structural difference from Indy/AnonCreds, not a bug or a measurement error. Latency direction was consistently "selective is faster," not slower, across all samples (magnitude too noisy to pin a single number). Concurrency: only got to 2-3 truly concurrent workflows (~7-11s average, not sub-second) before deliberately backing off — see native crash below.

**4 real infrastructure bugs found and fixed while building this** (independent of the benchmark's own result, these blocked *any* proof-based experiment from ever working before today):
1. Government-agent never mounted `/proof-status`/`/proof-data` (only doctor/pharmacy did) — added `registerVerifierRoutes`.
2. Credo-TS's `AutoAcceptProof.ContentApproved` (this project's configured mode) never auto-responds to a bare verifier-initiated proof request — confirmed by reading the library's own source (`V2ProofProtocol.shouldAutoRespondToRequest` requires a matching prior proposal, which this project never sends). A real human wallet works around this by manually tapping "Accept"; the automated test-patient agent had no equivalent. Added `BaseAgent.acceptProofRequest()` (additive, opt-in, doesn't change any existing agent's behavior) and wired it into `benchmark/test-patient-helper.ts`'s `createTestPatientAgent()`.
3. **`agent-base.ts`'s `getProofRecords()`/`getIssuedCredentialRecords()` filtered on query keys (`proofIds`, `credentialIds`) that don't exist anywhere in Credo-TS** — silently matched zero records instead of erroring. This meant `/proof-data` returned fake `{isVerified:false}` on **every agent that mounts it** (doctor, pharmacy too), for this project's entire history. Fixed by switching to the library's real `getById()`.
4. A connectionId mismatch in the new benchmark code itself: each side of a DIDComm connection keeps its own separate local connection record/ID for the same relationship — `connectTestPatientTo()`'s returned ID is the *verifier's*, never the holder's own. Fixed the credential-done-wait logic to track "one more done record than before" instead of filtering by connectionId.

**Real native-library crash, found twice, not caused by this project's code:** government-agent's AnonCreds/Askar native bindings crashed (`Napi::Error`, no catchable JS exception) under concurrent/bursty credential-issuance load — once at connection #46 of 50, once at connection #2. Confirmed not a code bug (typecheck clean, logic correct); a genuine native-library stability limit under load. The concurrency experiment's `maxLevel` default was reduced from 50 to 3 as a result — real, if modest, data instead of none.

**One meta-finding, also useful:** if the target paragraph was meant to describe *this* system, it can't be — the mechanism it implies (cheap field omission) doesn't exist in AnonCreds. Worth surfacing to whoever gave that target: either it's a related-work comparison (fine, write up the contrast), or the comparison scheme needs reconsidering for a thesis built on Indy/AnonCreds specifically.

---

## Full-Codebase Security Audit (2026-07-25) — 8 Real Bugs Found and Fixed, Several Still Open

Two rounds of parallel deep-audit passes across the whole codebase (agents/, dwn/patient-node/, crypto/, audit/, backup-provider/, apps/web/, benchmark/e2e/, and the wallet fork's own patches), each pass explicitly told what was already fixed so it wouldn't re-report old ground. All 8 fixes below were independently confirmed live (not just typechecked) against real running services before being marked done.

**Round 1 — 5 fixed:**
1. **`agents/shared/common-routes.ts` — auth bypass.** Every proof-request branch (`--issuer`, `--doctor`, `--healthcare-authority`) used `restriction:` (singular); the real Credo-TS/AnonCreds field is `restrictions:` (plural) — confirmed against the library's own type definitions. Since the request objects are loosely typed (`Record<string, any>`), TypeScript never caught it. This silently dropped every credDef restriction on these proof requests, meaning anyone could self-issue a matching credential and have it accepted as a real government/hospital-issued one. `pharmacy-routes.ts` (built separately) had it right the whole time, which is how the mismatch became visible. Fixed: renamed all 7 occurrences.
2. **DWN key-recovery routes — unauthenticated data-destruction.** `self-custody-routes.ts`/`mpoa-bridge-routes.ts` accepted caller-supplied recovery shares/keys with zero verification and persisted them unconditionally — anyone who knew/guessed a patientDID could permanently overwrite that patient's real encryption key with garbage. Fixed with a new `verifyMEKAgainstBackup()` (`dwn/patient-node/src/backup/backup-service.ts`) that attempts to decrypt real backed-up data with the candidate key (AES-GCM's auth tag fails closed on a wrong key). **First attempt at this fix was itself wrong** — it treated "backup destination unreachable" the same as "verified," which silently broke the actual vulnerability check whenever backup-provider was down; caught this only by testing the *legitimate* recovery path, not just the attack path. Redesigned to a 3-state result (`verified` / `no-data` / `unreachable`) — `unreachable` now fails closed (503), matching the security-critical nature of key recovery (unlike routine writes, where a backup destination being down is deliberately non-fatal elsewhere in this codebase).
3. **`crypto/sss/src/routes/sss-routes.ts` — share-provenance bypass.** The share-manifest check was only enforced for requests created via `/recovery/initiate-with-split`; the bare `/recovery/initiate` (still live, unauthenticated) had no manifest to check against, so once approved, any 3+ syntactically-valid shares would reconstruct. Fixed: manifest is now required unconditionally.
4. **`crypto/sss/src/mpoa-controller.ts` — approved requests never expired.** `getRecoveryStatus()` only checked expiry while `status === 'pending'`; an approved-but-stale request stayed usable forever. Fixed: also checked while `'approved'`.
5. **`dwn/patient-node/src/routes/record-routes.ts` — consent-graph leak.** `queryRecord`'s `accessPolicy` field (every DID with active access) was computed and returned for *every* read, including non-self/grant-based ones — a doctor with a legitimate grant could see every *other* party with access too. Fixed: only computed for self-reads (`grant === null`).

**Round 2 — 3 more fixed:**
6. **`dwn/patient-node` — unvalidated `patientDID` used as backup storage scope.** `patientDID` (a UUID, not a DID string — see DWN semantics below) flowed unvalidated into backup-destination scope keys (a folder name / URL path segment / query filter, depending on destination). A caller-supplied `patientDID = "_protocols"` (the literal reserved bucket name for shared protocol metadata) would poison that shared bucket and break restore for **every other patient**; `"."`/`".."` caused path traversal in the local destination. Fixed with a shared UUID validator (`dwn/patient-node/src/utils/validation.ts`) applied at every entry point (`storeRecord`, `shareRecord`, self-custody, MPOA-bridge, restore routes) plus defense-in-depth inside `backup-service.ts` itself.
7. **`crypto/sss` — share-data integrity gap.** The manifest check (fix #3 above) only verified a submitted share's *ID* was recognized, not that its *data* matched what was actually issued — since share IDs are plaintext in API responses, a real ID paired with fabricated bytes passed silently, producing a wrong "successful" reconstruction. Fixed: `attachIssuedShares()` now records a `sha256(shareData)` fingerprint per shareId, checked at reconstruct time. Also added output-length validation (32 bytes) to both reconstruction paths (`key-reconstructor.ts`, `self-custody.ts`), symmetric with the existing input-length check on split.
8. **`agents/doctor-agent/src/routes/medical-routes.ts` — `identityVerified` was entirely self-asserted.** Both credential-issuance routes took `identityVerified`/`patientDID` straight from the request body with nothing checking them — anyone hitting the API directly (bypassing the Doctor Portal's real verification step) could claim `identityVerified: true` for any patient. Fixed with `verifyIdentityProof()`: the server now independently confirms a real, `done`-state proof record exists for the connection and extracts `patientAccountId` from its actual revealed attributes (via a new shared `agents/shared/proof-parser.ts`, a server-side port of the frontend's existing extraction logic) — the client's claim is ignored entirely. Required threading a `proofRecordId` through the frontend (`useProofVerification` hook → `doctor/page.tsx` → `apiService.ts`) so the legitimate flow keeps working.

Also fixed as a byproduct: `agents/shared/dwn-client.ts` had its own separate, stale copy of the `accessPolicy` type (still `required` after fix #5 made it optional) — found by the regression-check pass, fixed to match.

**Live-verified, not just typechecked:** all 8 fixes were tested end-to-end against real running services — #2/#6 with real garbage-vs-legitimate recovery attempts and backup-provider up/down; #3/#4 with real Ed25519-signed MPOA approvals; #8 with a real government→doctor DIDComm proof flow, confirming both that a real proof correctly produces `identityVerified: true` under the *actual* verified patient ID (not a deliberately-planted bogus one) and that a faked claim with no real proof is stored as `false`.

**Found but NOT yet fixed, status as of the 2026-08-09 re-audit** (full current findings list is in the "Full-Codebase Re-Audit (2026-08-09)" section below — this list is kept only as a pointer, don't duplicate detail here):
- Wrong fallback credDef — **fixed** (now falls back to `restrictions: []`, not the agent's own credDef). But `[]` means "no restriction," not "fail closed" — this created a new, worse issue (fail-open proof verification), see 2026-08-09 section below.
- Recovery-route DoS amplification — **partially fixed**: `verifyMEKAgainstBackup()` now calls `listEntries(patientDID, 1)`, a real scan bound, closing the DWN-side trigger. Hitting `backup-provider`'s entry-listing endpoint directly (no `limit` param) is still open.
- `government/page.tsx` localStorage cross-patient leak — **fixed** (now warns and skips auto-save if a different patient ID is already saved).
- `apiService.ts` `response.ok` checks and `getProofData` forcing `isVerified=true` — **both fixed**.
- `doctor/page.tsx` filter-chip refetch and `patient/page.tsx` `ShareCard.copy` try/catch — **both fixed**.
- `benchmark/run-experiments.ts` methodology issues (accessPolicy cost distortion, non-monotonic `maxSubSecondLevel`, wallet-cleanup disk leak, stale-connection bug in `e2e/full-flow-test.ts`, cosmetic `maxLevel` param) — not re-checked in the 2026-08-09 pass, assume still open.

---

## Full-Codebase Re-Audit (2026-08-09) — All 4 HIGH Findings Fixed

Five parallel read-only audit passes (agents/identity layer, dwn/patient-node, crypto+backup-provider, frontend+benchmark+scripts, audit-trail module) plus one user-caught issue (ZKP over-disclosure). Two new untracked files existed at scan time and had never been audited before: `dwn/patient-node/src/routes/notification-routes.ts` (patient activity-feed endpoint, built on top of `AuditService.getByActor`/`getByTarget`) and `dwn/patient-node/src/utils/nonce-guard.ts` (in-memory one-time-nonce replay guard, wired into `storeRecord`/`shareRecord`).

**HIGH — all 4 fixed same day:**
1. **Unauthenticated patient-activity endpoint — FIXED.** `dwn/patient-node/src/routes/notification-routes.ts` only validated `patientDID` was a syntactically valid UUID, no `requesterDID` check at all — anyone knowing a patient's UUID (including a fully-revoked provider) could pull their entire consent/access history forever. A strictly worse reopening of the "consent-graph leak" class the 2026-07-25 audit closed on `accessPolicy` (fix #5), via a code path that fix never touched. **Fix:** now requires `?requesterDID=` matching `patientDID` (403 otherwise), same self-only pattern as everywhere else in the DWN. `dwnService.ts`'s `getNotifications()` updated to pass it.
2. **ZKP proof requests over-disclose — FIXED (the one you caught).** `agents/pharmacy-agent/src/routes/pharmacy-routes.ts` (`/verify-patient-identity`) and `agents/shared/common-routes.ts` (`--doctor` branch) bundled `nationalId, name, medicalCondition, bloodType, patientAccountId` into one revealed AnonCreds attribute group — a "names" array reveals everything in it jointly, not selectively; only the separate age-≥18 predicate was genuinely zero-knowledge. Every doctor/pharmacy identity check leaked medical condition and blood type with no legitimate need for either, undercutting Module 4's core selective-disclosure claim. **Fix:** dropped `medicalCondition`/`bloodType` from both proof requests. Kept `nationalId`/`name`/`patientAccountId` — confirmed both are actually consumed downstream for frontend auto-fill (`doctor/page.tsx`, `pharmacy/page.tsx`), so removing them would have broken real functionality; only the two genuinely-unnecessary clinical fields were cut.
3. **Fail-open proof verification on unset credDef env var — FIXED.** `agents/shared/common-routes.ts` (`--doctor`, `--pharmacist`) and `pharmacy-routes.ts` (`/verify-patient-identity`, `/verify-prescription`) fell back to `restrictions: []` when `ISSUER_CRED_DEF_ID`/`DOCTOR_MEDICAL_CRED_DEF_ID` was unset — meaning "any issuer accepted," not fail-closed. Given this env var has gone stale live before (see Known Constraints), a self-issued fake credential could have passed identity/prescription verification undetected. **Fix:** all four routes now return `503` immediately if the expected credDef env var is unset, instead of silently sending an unrestricted proof request. `--healthcare-authority`/`--issuer` branches untouched (their own-credDef fallback there is intentional).
4. **Audit tamper-detection bypassable with DB write access — FIXED.** `audit/src/services/audit-service.ts`'s `verify()` trusted whatever public key was stored in `signerPublicKey` on the same row as the signature, with no independent binding to the claimed actor — someone with DB write access could forge a row, sign it with their own throwaway keypair, and `verify()` would pass it. This was a deliberate design tradeoff (verify() avoided any DWN/LevelDB dependency so it stays callable from `crypto/sss`/`benchmark`), presented to the user as a choice between "add a network check" vs. "document as accepted risk" — **user chose the network check.** **Fix:** `verify()` is now `async`; for patient-signed events it additionally calls the DWN's existing `/signing-key-status` endpoint (fingerprint-only, no private key ever crosses the wire) and confirms the row's `signerPublicKey` fingerprint matches the patient's real on-file key. Fails closed (not verified) if the DWN is unreachable, matching this codebase's existing fail-closed pattern for security-critical checks (`verifyMEKAgainstBackup`). All 3 real callers (`benchmark/run-experiments.ts` ×2, `e2e/full-flow-test.ts` ×1) updated to `await`; the e2e one also fixed from `.every(() => AuditService.verify(e))` (silently always-truthy once verify() returned a Promise) to a proper `Promise.all` + `.every(Boolean)`.

All 4 fixes typecheck clean (`tsc --noEmit`). Not yet re-verified live end-to-end against running services — worth doing before relying on these for the next benchmark/e2e run, especially #4 (new DWN network dependency in `verify()`) and #3 (identity verification will now visibly fail-hard if a credDef env var goes stale, instead of the old silent-unsatisfiable or new silent-accept-anyone behavior — expected, but will change what a stale-env-var session looks like).

**MEDIUM:**
5. `e2e/full-flow-test.ts` is currently broken — its `shareRecord` call was never updated for the new required `nonce` field (`permission-routes.ts` now 400s without one). One-line fix: add `nonce: crypto.randomUUID()`.
6. Backup-provider direct DoS surface, narrowed but still open — `backup-provider/src/routes/backup-routes.ts:65-74`, `provider-service.ts:135-138`. `GET /backup/patients/:patientDID/entries` on port 4010 has no auth/rate-limiting and does an unbounded scan when `limit` is omitted.
7. Nonce "replay guard" is weaker than its own comments claim — `dwn/patient-node/src/utils/nonce-guard.ts`. Only rejects an exact repeat of a nonce string, doesn't bind the nonce to the request body; stops accidental double-submits, not an adversary who tweaks the body and mints a fresh nonce.
8. Unbounded audit-table scan behind the new notifications endpoint — `notification-routes.ts:56-59` + `audit-service.ts:150-164`, no `take` limit on `getByActor`/`getByTarget`. Compounds finding #1.

**LOW / informational:**
9. Nonce consumed before the write can fail → legitimate retries get a permanent false-positive `409` (`record-routes.ts:42`, `permission-routes.ts:44`).
10. `nonce-guard.ts:18` — no length bound on the nonce string.
11. `audit-service.ts:85` — unguarded `JSON.parse(row.metadata)`; one corrupted row throws and kills the whole query result set.
12. `crypto/encryption/src/signing-utils.ts:27,42` — 10-year JWT expiry baked into every audit signature; a durable record will eventually "fail verification" purely from age, indistinguishable from real tampering.
13. `audit-service.ts:204` — metadata comparison via `JSON.stringify` equality is key-order-sensitive (not currently exploitable, just fragile).
14. `dwn/patient-node/src/utils/rate-limit.ts:1-11` — stale doc comment, no longer accurate now that the `limit=1` plumbing exists.
15. `dwn/patient-node/src/backup/local-destination.ts:28-38` — `fs.readdir` reads the full directory before slicing to `limit` (local-only path, minor).
16. `agents/shared/types/index.ts:34-43` — dead unused `PredicateProps` type still has the old singular `restriction` typo; not referenced anywhere, worth deleting.
17. `agents/shared/agent-base.ts:106-115` — dead/unreachable branch in connection auto-accept logic; harmless (library already auto-accepts), just misleading to read.

**Confirmed NOT regressed** (re-checked, still holding): the `restriction`/`restrictions` auth-bypass fix (Round 1 #1), `identityVerified` server-side verification (Round 2 #8), `patientDID` UUID validation at every entry point (now including the new `notification-routes.ts`), `accessPolicy` self-reads-only in `record-routes.ts` itself (though bypassed via finding #1's separate endpoint), MPOA share-fingerprint + 32-byte output checks, MPOA approved-request expiry, the 2026-07-22 `usePolling`/`ConnectionSetup` fixes, and the `HandshakeProtocol.Connections`-only agent config.

---

## Bifold Wallet Genesis Fix — Root Cause Confirmed, Real Fix Shipped (2026-07-27)

**Two approaches tried; the second one is what actually worked.**

**Approach 1 — rebuild Bifold from current upstream source.** Forked `openwallet-foundation/bifold-wallet` fresh, ran the repo's own `yarn ledgers` script to refresh the genesis, built a full multi-ABI debug APK. The refreshed genesis was confirmed byte-for-byte identical to both the live BCovrin testnet and this project's own `BCOVRIN_GENESIS`. But "current upstream source" is not the same app as the original `base.apk` — real gaps surfaced:
- Needed Node ≥20.19.2/Yarn 4.9.2 (this project runs 20.14.0) and a full `yarn build` of the internal `@bifold/*` workspace packages before Metro could even bundle — pure tooling gaps, fixed along the way, not genesis-related.
- **Real incompatibility #1:** the fresh build's Credo-TS (0.6.3) emits a DID document using the current W3C `@context` URI (`https://www.w3.org/ns/did/v1`); this project's agents run Credo-TS 0.5.13, whose legacy Connections-protocol validator hard-rejects anything but the old `https://w3id.org/did/v1` URI — confirmed live via `ProblemReportError`.
- **Real incompatibility #2:** switching the invitation to also offer `DidExchange` (to route around #1) let the handshake complete, but this project's older Credo-TS then failed to correlate the wallet's final `didexchange/1.1/complete` message back to its connection record after a DID-rotation step (`CredoError: Connection is missing in message context`) — a separate, genuine bug in this Credo-TS version's DID-rotation handling.
- Neither is genesis-related — both are the direct cost of testing against a newer app than the one actually in use.

**Approach 2 — binary-patch the real `base.apk` directly (this is the one that worked).** Decompiled the original `base.apk` with `apktool`, located the exact stale genesis string embedded in `assets/index.android.bundle` (JS-string-escaped, `Node1`-`Node4` only, zero reference to the current validator set — confirming the 2026-07-22 diagnosis exactly), replaced it byte-for-byte with the live, verified-correct 14-transaction genesis, repackaged with `apktool b`, zipaligned, and signed with the standard debug keystore. Result: package name, version strings, compileSdk/targetSdk, ABI set, and size class (279.15MB vs. the original's 279.05MB — the ~100KB delta being exactly the larger genesis) all identical to the original. Genuinely "the same app, one file corrected," not a rebuild — this sidesteps both Credo-TS incompatibilities above entirely, since the app's own bundled library version never changed.

**Live-proved, fully verified, end-to-end, on the physical phone (2026-07-27):**
1. Real DIDComm connection to Government Identity Issuer — `state: completed`.
2. Real AnonCreds `patient_credential` issued and accepted (real schema/credDef resolution from the live ledger — no pool timeout, no degraded fallback).
3. Real DIDComm connection to Doctor Agent — `state: completed`.
4. **Real AnonCreds zero-knowledge proof exchange** for identity verification — `anoncreds/proof-request@v1.0` → `anoncreds/proof@v1.0` → `verified: true`. First time in this project's history the ZKP/AnonCreds pathway (Module 4's primary mechanism) has completed on real physical hardware — previously always blocked by the stale genesis; only the DWN-Protocol field-redaction pathway had been proven on-device before today.
5. Real `medical_document_credential` issued by the doctor and accepted by the wallet, with `identityVerified: true` genuinely server-derived from the proof above (not client-claimed).
6. Real DWN write, correctly AES-256-GCM encrypted and later correctly decrypted back to sensible plaintext on self-read.
7. Independently re-verified afterward, not just trusted: queried the audit database directly and ran all 5 real audit events for this test through `AuditService.verify()` — all 5 passed; a deliberately-tampered copy of one of them correctly failed verification, confirming `verify()` genuinely checks signatures rather than rubber-stamping.

**Live code change from this session, now the active configuration:** `agents/shared/agent-base.ts`'s `createInvitation()` offers `HandshakeProtocol.Connections` only (not `DidExchange`) — this matches what the original app's DID-document format is actually compatible with (see incompatibility #2 above for why `DidExchange` was tried and reverted the same day). If a current-upstream Bifold build is ever tested again, that incompatibility will resurface.

**Two things found along the way, not yet acted on:**
- BCovrin appears to enforce a short per-DID write cooldown: a second schema write from the same DID moments after a first succeeding one is rejected with `UnauthorizedClientRequest ... forbidden`, reproduced live twice, specifically hitting Government's own two-schema boot sequence (`patient_credential` + `hospital_authorization_credential` back-to-back). Not a connectivity issue — raw TCP to all 8 validator ports confirmed open both times. Isolated/spaced-out retries succeed. Refines the existing "likely a write-frequency policy" note under Known Constraints with concrete evidence.
- The government agent process died silently once mid-session (no crash trace in its log, port simply stopped listening, ~40 minutes after boot). Root cause not identified; a restart resolved it immediately and it didn't recur. Worth investigating if it happens again.

**Debugging gotcha worth remembering:** `audit-service.ts`'s console output (`Audit: [eventType] actor=X resource=Y`) prints `resourceId`, not `targetDid`. For record-write events, that means the printed `resource=` value is the **record ID**, not the patient's account ID — easy to misread as the patientDID (happened once this session, gave the user a wrong ID to switch to before catching it via the audit DB's `targetDid` column). The real patientDID is always `targetDid`, not `resourceId`.

---

## PoC Completeness Assessment (updated 2026-07-25)

**All 10 required modules are built and proven live at some point.** The honest, current list of open items:

- **Bifold's stale bundled genesis — FIXED 2026-07-27.** Binary-patched the real `base.apk`'s embedded genesis directly (not a from-source rebuild — that path hit real Credo-TS version-compatibility issues, see "Bifold Wallet Genesis Fix" section above for the full story). Live-proved end-to-end on the physical phone: real ZKP identity proof, real credential issuance, real DWN storage, all independently re-verified afterward. The DWN-based selective-sharing workaround is no longer needed for this but remains in the code.
- **The device-level secret protecting every patient's individual key is still one single, un-split secret** (`DWN_MASTER_KEK`) — known, named, not yet fixed.
- **BC Wallet (the production Aries app) separately rejects our invitations** — root-caused to either plain-HTTP endpoints or a missing DidExchange handshake option; the genesis-patched Bifold APK works (see above). Not re-tested against BC Wallet itself.
- **No deployment packaging** (`infra/docker-compose.yml`) — never built, not required for a PoC.
- **BCovrin's public test pool is occasionally flaky under load** (see "Ledger Connectivity" above) — real, honest, environment-caused, not a code defect; retries usually succeed.

**Decentralization claim, still accurate:** the identity/credential layer (Hyperledger Indy) is genuinely decentralized (real multi-node consensus, now confirmed actually reachable). The DWN vault, backup provider, and agents are **patient-controlled** (nobody but the patient can unlock their data) but each is architecturally a single server — state these as two separate, both-true claims in the thesis, not one blanket statement.

---

## Key Decisions (Locked)

| Decision | Choice |
| -------- | ------ |
| Off-chain storage | Full DWN node (LevelDB embedded) — NOT MongoDB, NOT @web5/api |
| DWN type | Full: Records + Permissions + Protocols interfaces |
| Audit storage | SQLite via Prisma — NOT MongoDB |
| Consent | DWN Permissions (enforcement) + Consent Receipt VC on Indy (proof) |
| MongoDB | Removed entirely |
| SSI layer | Hyperledger Indy + Credo-TS |
| Encryption | AES-256-GCM at rest, real per-patient MEK (Operation Fullbring) |
| SSS threshold | 5 shares total, any 3 reconstruct the MEK |
| SSS share holders | Patient device, hospital, trusted family, backup server, recovery agent |
| MPOA approvals | Patient + Hospital + Guardian (threshold = 3), signature-verified |
| Smart contracts | Permanently out of scope — Indy has no VM. Do not revisit. |
| Legacy PoC | Keep for reference, don't delete or run in parallel |
| SSS library | `shamir-secret-sharing` npm package |
| DWN URL | `PATIENT_DWN_URL=http://localhost:5050` (port 5050, not 5000, to avoid macOS AirPlay conflict) |
| DID hierarchy | 3-tier (real, built): Government → Healthcare-Authority (:4006) → Doctor. Built, reverted, then rebuilt again per explicit user instruction — see below. |
| Protocol role binding | `Permission.actorRole` only trusted with a verified `roleProofRecordId` (AnonCreds proof) — no self-reported role strings |
| VP format | JWT-based W3C Verifiable Presentation, matching this repo's JWT-only signing convention |
| Backup destination | Self-run `backup-provider/` (patient-signing-key authenticated), replacing Google Drive — real deletion, tamper-evident |
| Bifold genesis fix method | Binary-patch the real `base.apk` directly (decompile via `apktool`, edit the embedded genesis string, repackage + sign) — NOT a from-source rebuild, after that path hit real Credo-TS 0.5.13-vs-0.6.3 incompatibilities (2026-07-27) |
| Agent handshake protocol | `HandshakeProtocol.Connections` only (not `DidExchange`) in `agent-base.ts`'s `createInvitation()` — matches the real device wallet's DID-document format; `DidExchange` hits a DID-rotation bug in this project's Credo-TS version (2026-07-27) |

---

## File Map — Organised by Role

### FRONTEND
```
apps/web/                          ← Real Next.js app (own package.json/next.config.js), 5 portal pages:
  src/app/{government,doctor,pharmacy,patient}/page.tsx, home page grid
  src/components/ConnectionSetup.tsx  ← QR + DIDComm connection polling (Strict-Mode-safe, fixed 2026-07-22)
  src/components/RecordCard.tsx       ← shared record renderer (Patient + Doctor portals)
  src/hooks/usePolling.ts             ← generic polling (stale-closure-safe, fixed 2026-07-22)
  src/hooks/useProofVerification.ts   ← proof request → poll → result, supports custom requestFn; now exposes proofRecordId (2026-07-25, required for server-side identity verification)
  src/services/apiService.ts, dwnService.ts (accessPolicy now optional, 2026-07-25)
  src/app/government/page.tsx         ← KNOWN BUG (2026-07-25, not fixed): shares one localStorage key across patients

interface/                         ← LEGACY Next.js app (reference only, do not delete)
```

### WALLET
`wallet/` — fresh clone of `openwallet-foundation/bifold-wallet` (current upstream `main`), built 2026-07-27 to test the genesis-fix hypothesis via a real device. Confirmed real Credo-TS 0.6.3 version-compatibility issues against this project's Credo-TS 0.5.13 agents (see "Bifold Wallet Genesis Fix" section) — kept for reference/future use, but **not** the wallet actually used for the live phone test. Needs Node ≥20.19.2/Yarn 4.9.2 and `yarn build` (internal `@bifold/*` packages) + `yarn start` (Metro) to run.

`base.apk` (project root, gitignored) — the real supervisor-provided original app. **This is the one actually used for live testing**, via direct binary patching (decompiled with `apktool`, genesis string replaced in `assets/index.android.bundle`, repackaged, signed with the debug keystore) rather than a source rebuild. See "Bifold Wallet Genesis Fix" section for the full process and why this approach (not the `wallet/` rebuild) is the one that worked.

### BACKEND — SSI / Identity / Agents
```
agents/shared/                     ← Shared code used by all agents
  agent-base.ts, network-config.ts (genesis fixed 2026-07-22), module-config.ts,
  common-routes.ts (restriction→restrictions auth-bypass fix 2026-07-25), verifier-routes.ts,
  debug-routes.ts, dwn-client.ts, types/, proof-parser.ts (new 2026-07-25, server-side proof extraction)

agents/government-agent/           ← port 4000, patient identity + hospital-authorization credentials
agents/doctor-agent/                ← port 4002, medical/prescription credentials, DWN writes/reads
agents/healthcare-authority-agent/  ← port 4006, professional-role credentials (real 3-tier chain)
agents/pharmacy-agent/              ← port 4004, verifier-only, DWN prescription reads

demo/credo/                        ← LEGACY working agent system (reference only)
  demo/credo/.env has live MongoDB credentials — NEVER touch this file
```

### BACKEND — Storage / Data
```
dwn/patient-node/                  ← port 5050, patient's DWN — Records + Permissions + Protocols + encryption
  src/interfaces/{records,permissions,protocols,role-verification}.ts
  src/routes/{record,permission,protocol,self-custody,mpoa-bridge,restore}-routes.ts (recovery-verification + patientDID-validation fixes 2026-07-25)
  src/encryption/{aes-service,mek-store,patient-signing-key}.ts
  src/backup/  ← pluggable backup destinations (local, google-drive, dwn-provider); backup-service.ts's verifyMEKAgainstBackup() new 2026-07-25
  src/storage/leveldb.ts
  src/utils/validation.ts          ← new 2026-07-25, isValidPatientDID() UUID check

audit/                             ← Audit trail, SQLite via Prisma
  src/services/audit-service.ts, anchor-client.ts
  prisma/schema.prisma

backup-provider/                   ← port 4010, self-run multi-tenant backup destination
```

### BACKEND — Security / Crypto
```
crypto/
  encryption/src/  ← hash-utils, signing-utils, verify-utils
  sss/src/         ← key-splitter, key-reconstructor (32-byte output check added 2026-07-25), mpoa-controller
                      (approved-request expiry fix 2026-07-25), self-custody, server.ts (port 4008),
                      routes/sss-routes.ts (share-data-fingerprint check added 2026-07-25)
```

### INFRASTRUCTURE / TOOLING
```
infra/                              ← NOT BUILT (docker-compose.yml, last thing to build)
benchmark/                          ← run-experiments.ts, test-patient-helper.ts, results/
e2e/                                ← full-flow-test.ts, results/
```

---

## DWN Record Schema

```typescript
// Record (LevelDB key: `record:{recordId}`)
{
  recordId, patientDID, recordType,        // "medical" | "prescription" | "lab_report"
  protocol, contentType, fileName, fileSize,
  encryptedData, encryptedKey, iv, tag,    // AES-256-GCM
  hash,                                     // real SHA-256 of plaintext
  integrityVCId,                            // on-chain anchoring built (see Audit Trail module)
  createdAt, updatedAt
}
// GET /dwn/queryRecord adds a computed `accessPolicy` (DID-keyed, not role-keyed) — self-reads only (2026-07-25), omitted for non-self reads

// Permission (LevelDB key: `permission:{permissionId}`)
{
  permissionId, patientDID, grantedToDID, recordType, allowedFields,
  purpose, grantedAt, expiresAt, revokedAt,
  consentVCId,                              // real, patient-signed JWT
  actorRole?, roleProofRecordId?            // only trusted together
}

// Protocol (LevelDB key: `protocol:{name}`)
{ name, actorRole, allowedFields, createdAt, updatedAt }
```

---

## Build Status — Summary

All 20 originally-scoped build days are **Done**. Post-Day-20 work also done: Operation Fullbring (self-custody + MPOA bridge + backup/restore + per-patient signing key), the "close the gaps" pass (patient-signed consent/audit, real MPOA signature verification, MPOA share-to-request binding), the Healthcare-Authority 3-tier rebuild, on-chain anchoring, the real Next.js frontend (5 portals), the self-run `backup-provider/`, the genesis root-cause fix plus 3 real bugs (2026-07-22), 2026-07-25's selective-disclosure benchmark (real numbers, 4 infra bugs fixed, 1 native crash found) and full-codebase security audit (8 real bugs found and fixed, several more found and still open), and — 2026-07-27 — **Bifold's stale genesis fixed for real** via direct binary-patching of `base.apk`, with a full live end-to-end proof on the physical phone (real ZKP proof, real credential issuance, real DWN storage, independently re-verified) — see "Bifold Wallet Genesis Fix" section above for the full story, including a real Credo-TS version-compatibility bug found and worked around along the way.

Per-file status is tracked in git history/commit messages rather than duplicated here — see `git log` for the detailed build sequence if needed.

---

## Operation Fullbring — Self-Custody Key & Data Recovery (Done)

**Problem it solved:** every patient's records used to be locked with one single, system-wide key (`DWN_MASTER_KEK`), and the SSS/MPOA recovery module had never been tested against a real key.

**Fix:** every patient now gets their own real MEK (`dwn/patient-node/src/encryption/mek-store.ts`), recoverable two ways:
- **Self-custody** (`crypto/sss/src/self-custody.ts`) — 3-way split, threshold 2, patient's own devices only, no institution involved.
- **MPOA emergency fallback** — the existing, unchanged institutional `crypto/sss` module, now bridged to the real key.

Records/permissions are incrementally backed up (per-write, not full-snapshot) to a pluggable destination — real, tested `LocalBackupDestination`, a self-run `backup-provider/` (patient-signing-key authenticated, replacing Google Drive, real deletion), and untested-live `GoogleDriveBackupDestination` code.

**Live-tested, the real proof:** a full "device destroyed" scenario — populate a device, split the key, delete the entire data directory, boot a genuinely empty second device, recover the key from 2 of 3 shares, restore all data from backup, confirm byte-for-byte identical — passed for both self-custody and MPOA paths.

**Decentralization framing:** identity/credential layer is genuinely decentralized (real Indy consensus); the DWN vault/backup provider/agents are patient-controlled but architecturally single-server — two separate, both-true claims, not one blanket statement.

**Healthcare-Authority chain:** built once, reverted as unnecessary complexity, then explicitly rebuilt again per direct user instruction (confirmed via `git log` the original build/revert was never committed). Currently live: Government → Healthcare-Authority (:4006) → Doctor, 3-tier, real DIDs, real credential issuance.

---

## Operation Fallback — Standby Plan to Revert On-Chain Anchoring (prepared, NOT executed)

If the user says "do fallback" in a future session, on-chain anchoring can be cleanly removed. Scoped to anchoring ONLY — does not touch the Healthcare-Authority chain or the MPOA share-binding fix.

**Delete entirely:** `audit/src/services/anchor-client.ts`, `agents/government-agent/src/routes/anchor-routes.ts`.
**Revert (remove only the anchoring additions):** `audit/prisma/schema.prisma` (drop 4 anchor columns via a new forward migration, don't hand-delete migration folders), `audit/src/services/audit-service.ts` (remove anchor fields/`markAnchored()`), `agents/shared/agent-base.ts` (remove `anchorHash()` + 3 imports), `agents/government-agent/server.ts` (remove anchor route registration), `package.json` (remove `@hyperledger/indy-vdr-shared`, run `npm install`), `.env` (remove `GOVERNMENT_AGENT_BASE_URL`).
**5 call sites to unwind** (each: remove an import + a fire-and-forget `attemptAnchor(...)` block, leave the underlying `AuditService.record()` call untouched): `permission-routes.ts` (×2), `self-custody-routes.ts` (×2), `sss/src/routes/sss-routes.ts` (×1), `mpoa-bridge-routes.ts` (×1), `restore-routes.ts` (×1).
**Verify after:** `tsc --noEmit` clean, `npm run gov:dev` boots with `/anchor-hash` now 404ing, `npm run benchmark`/`npm run e2e-test` match the pre-anchoring baseline.

---

## Code Quality Rules (Non-Negotiable)

- Never use deprecated APIs/`any`/`@ts-ignore` to silence a warning without exhausting non-deprecated alternatives first.
- Never introduce a workaround for a problem that has a clean root-cause fix.
- Check a library is actively maintained before adopting it.

---

## Known Constraints

**Environment / never touch:**
- `demo/credo/.env` has live MongoDB credentials — never touch that file.
- Each agent has its own real, distinct DID/seed (the legacy PoC's shared-seed bug does not exist here).
- `agents/shared/db-singleton.ts` deleted — agents don't touch any database, don't recreate it.
- `consent/`, `dwn/provider-node/`, `bridge/`, `docs/`, `edge/` all deleted — empty scaffolds, not part of the architecture.
- `audit/package.json` intentionally doesn't exist — deps consolidated into root `package.json`.

**Ports / networking:**
- DWN default port is **5050**, not 5000 (macOS AirPlay Receiver conflict). Agents: gov 4000, doctor 4002, pharmacy 4004, HA 4006, SSS 4008, backup-provider 4010, web app 3001.
- `*_AGENT_PUBLIC_ENDPOINT` vars in `.env` (and `apps/web/.env.local`'s `NEXT_PUBLIC_*_URL`) must be set to the current LAN IP (`ipconfig getifaddr en0`) for a physical phone to connect — regenerate whenever the network changes. Agents must be **restarted** after changing these (dotenv loads once at boot; editing `.env` afterward has no effect on an already-running process).
- Each agent registers a **fresh, randomized credDef on every boot** — cross-agent env vars referencing another agent's credDef (`ISSUER_CRED_DEF_ID`, `DOCTOR_MEDICAL_CRED_DEF_ID`) must be updated and that *consuming* agent restarted after every boot of the *producing* agent. Exception: `PROFESSIONAL_ROLE_CRED_DEF_ID` should be left **unset** — healthcare-authority-agent already passes its own live-registered ID as a fallback (`config.credentialDefinitionId`), and the env var (being read first) would override it with a stale value from a previous boot if set. **Reconfirmed live 2026-07-25**: a stale `ISSUER_CRED_DEF_ID` (left over from an earlier government-agent restart the same session) silently broke doctor-agent's identity-proof requests. The original "falls back to own credDef" bug this caused is now fixed, but the fix has its own problem — falling back to `restrictions: []` (unset env var) means "no restriction," not fail-closed, so a stale env var now means an *unrestricted* proof request instead of an *unsatisfiable* one (see "Full-Codebase Re-Audit (2026-08-09)" finding #3); check this env var first whenever identity verification mysteriously fails.
- An agent's HTTP routes only mount after its ledger-timeout retries finish — wait for the `"...routes mounted. Ready."` log line before treating "not reachable" as meaningful.

**Ledger / genesis:**
- See "Ledger Connectivity — Root Cause Found and Fixed" above for the full story. Bundled genesis in `agents/shared/network/network-config.ts` is now current (refreshed 2026-07-22) — if it goes stale again, re-fetch the full file from `https://test.bcovrin.vonx.io/genesis`, don't hand-edit IPs.
- BCovrin's public pool is occasionally flaky under bursty/concurrent load — a failed write is often just worth retrying, not a sign of a code regression. **Reconfirmed 2026-07-27 with more precision:** a second schema write from the same DID moments after a first succeeding one gets rejected (`UnauthorizedClientRequest ... forbidden`) — looks like a real per-DID write cooldown, not general flakiness. Space out or retry multi-schema boot sequences (Government's own boot does two back-to-back).
- Bifold's own bundled genesis was separately stale — **FIXED 2026-07-27** by binary-patching `base.apk` directly. See "Bifold Wallet Genesis Fix" section above.
- `agents/shared/agent-base.ts`'s `createInvitation()` offers `HandshakeProtocol.Connections` only, not `DidExchange` — deliberate, as of 2026-07-27. Offering `DidExchange` alongside it made a real device wallet also prefer `DidExchange`, which hits a genuine bug in this project's Credo-TS 0.5.13 (fails to correlate the wallet's final `complete` message back to its connection record after a DID-rotation step). Re-add `DidExchange` only if testing against a wallet whose DID-document format this project's older Credo-TS Connections-protocol validator rejects (see "Bifold Wallet Genesis Fix" section) — and expect to hit the DidExchange bug in exchange.
- `audit-service.ts`'s console log line (`Audit: [eventType] actor=X resource=Y`) prints `resourceId`, not `targetDid`/patientDID — for record-write events this is the record ID, not the patient's account ID. Don't confuse the two when reading logs; the real patientDID is the `targetDid` column in the audit DB.

**DWN / Permissions semantics:**
- Patient's own reads always succeed with no grant needed (`requesterDID === patientDID` bypass in `record-routes.ts` only — `PermissionsInterface.checkPermission()` itself has no such exemption).
- Doctor writes to a patient's DWN **without** a permission grant (doctor is the record's author; sovereignty is enforced at the READ layer only). All other reads require an active grant via `shareRecord`, or return 403 (single-record lookups) / silently excluded (list queries).
- `Permission.actorRole` is only trusted alongside a verified `roleProofRecordId`.
- Field redaction on `queryRecord` applies only to non-self JSON-content reads; governed by intersecting `Permission.allowedFields` with the matching `Protocol.allowedFields` (matched by `record.protocol` + `actorRole`).
- A stable `patientAccountId` (not the ephemeral per-connection `theirDid`) is the durable identity used as `patientDID` for DWN writes/reads — minted at identity issuance (a plain `crypto.randomUUID()`, not a W3C DID string), revealed to doctors/pharmacies via a verified proof (server-verified as of 2026-07-25, see Security Audit; **confirmed live via a real ZKP proof, not just manual entry, as of 2026-07-27** — see "Bifold Wallet Genesis Fix").
- **`patientDID` is validated as a UUID at every DWN entry point that touches backup storage** (`storeRecord`, `shareRecord`, self-custody/MPOA-bridge/restore routes) — added 2026-07-25 after an unvalidated `patientDID` was found flowing into backup-destination scope keys (see Security Audit). Any non-UUID value is rejected with 400.
- **`accessPolicy` on `queryRecord` is self-reads-only** (added 2026-07-25) — omitted entirely (not just empty) for non-self/grant-based reads, since it reveals every other party with access. `apps/web/src/services/dwnService.ts` and `agents/shared/dwn-client.ts`'s types both mark it optional accordingly.

**Known, deliberately-unfixed limitations:**
- `DWN_MASTER_KEK` (wrapping every patient's MEK at rest) is still one single, un-split device secret.
- MPOA's duplicate-approval check is per-role, not per-DID — a single DID could approve as patient+hospital+guardian. Confirmed, explicitly left as-is per user decision.
- Off-device backup replication beyond the same-machine `LocalBackupDestination`/self-run `backup-provider/` hasn't been tested against real Google OAuth credentials.
- Real Bifold/BC Wallet compatibility: BC Wallet rejects our invitations outright (root-caused, not fixed — either plain-HTTP or missing DidExchange handshake); the genesis-patched Bifold APK now connects and completes full flows for real (**fixed 2026-07-27**, see "Bifold Wallet Genesis Fix" above) — not re-tested against BC Wallet itself.
- **DWN-side recovery DoS trigger fixed; direct backup-provider trigger still open.** `verifyMEKAgainstBackup()` now calls `listEntries(patientDID, 1)`, a real scan bound — but `backup-provider`'s `GET /backup/patients/:patientDID/entries` remains unauthenticated, unrated-limited, and unbounded when called directly with no `limit` param (port 4010).
- **Still-open bugs from the 2026-08-09 re-audit** — see "Full-Codebase Re-Audit (2026-08-09)" section above for the full current list (4 HIGH: unauthenticated notification endpoint, ZKP over-disclosure in identity proofs, fail-open proof verification on unset credDef, audit tamper-detection bypassable with DB write access; plus MEDIUM/LOW items). The 2026-07-25 audit's government-portal localStorage leak and `apiService.ts` gaps are now confirmed fixed.

**A number of real bugs have been found and fixed via deliberate adversarial/live testing across this project's history** (corrupted-LevelDB-entry handling, MPOA role validation, revoke-mutex races, audit tampering-detection gaps, base64/date validation gaps, a proof-verification endpoint that reported unverified proofs as verified, a test-helper connection-scoping bug, the 3 bugs under "3 Real Bugs Found and Fixed" from 2026-07-22, and the 8 under "Full-Codebase Security Audit" from 2026-07-25). Each was root-caused and fixed, not worked around; see `git log` for exact commits if the specific historical detail is ever needed.

---

## Source of Truth Files

- `CONTEXT.md` — session context, decisions, open questions
- `CLAUDE.md` — this file (code map, build status, constraints, build order)
- `README.md` — project overview, architecture, setup, plus "Using MediTrust — A Plain-English Guide"

---

## How to Update This File

After each working session:
1. Mark the completed module as Done in the relevant table
2. Add any new constraints discovered — keep entries terse (fact + brief why), not narrated
3. Note any open decisions that were resolved
4. Periodically re-skim for anything that's become pure historical narrative and can be compressed further
