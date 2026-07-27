# MediTrust — Implementation Context

> **Purpose:** Paste this at the start of any new session. Lighter-weight companion to CLAUDE.md — decisions, status, and current session state. For full code-map/file-map detail and the complete Known Constraints list, see CLAUDE.md.
> **Housekeeping note (2026-07-22):** this file was aggressively trimmed alongside CLAUDE.md to control size. Old narrative detail was compressed to essential facts; full history is in git commits if ever needed.

---

## 1. What This Project Is

A thesis continuation implementing a **decentralized, patient-centric healthcare SSI system**: full DWN node (LevelDB), patient-controlled encrypted records, SSI-based consent via DWN Permissions + Verifiable Consent Receipt VCs on Indy, Shamir Secret Sharing key recovery, and a full signed audit trail. No MongoDB anywhere.

---

## 2. The 10 Required Modules — All Done

See CLAUDE.md's modules table for the current per-module status line. Summary: all 10 built, all proven live at some point. Selective Sharing (Module 4) has two independent, both-proven mechanisms — ZKP/AnonCreds and DWN Protocol field-redaction — which matters because of the Bifold limitation below.

---

## 3. The 8 Required Experiments

See CLAUDE.md's Experiments table (updated 2026-07-22). Short version: 6 of 8 fully real and consistent; the 2 ledger-dependent ones now succeed for real (root cause of the old "blocked" status was fixed this session) but are still occasionally subject to BCovrin's public-pool flakiness under load — a real network-quality issue, not a code defect.

---

## 4. Key Decisions (All Locked)

See CLAUDE.md's Key Decisions table — kept there as the single source of truth to avoid duplication drift.

---

## 5. Architecture Overview

```
Patient (Bifold Wallet)
        │ DIDComm / OOB invitation
        ▼
Government :4000 → Healthcare-Authority :4006 → Doctor :4002    Pharmacy :4004
        │
        ▼
Full DWN Patient Node :5050 (Records + Permissions + Protocols, LevelDB, AES-256-GCM)
        │ audit event on every operation
        ▼
Audit Service (SQLite via Prisma, signed JWT, opt-in on-chain anchoring)

SSS/MPOA Service :4008          Backup Provider :4010
Hyperledger Indy (BCovrin)  ← DIDs, VCs, Consent Receipts, on-chain anchoring
```

---

## 6. DWN Data Schemas

See CLAUDE.md's "DWN Record Schema" section — identical, kept there only.

---

## 7-8. File Map / Build Order

See CLAUDE.md's File Map and Build Status sections. All 20 originally-scoped build days are done; substantial post-Day-20 work is also done (Operation Fullbring, Healthcare-Authority rebuild, on-chain anchoring, real Next.js frontend, self-run backup provider, and this session's genesis fix + 3 bug fixes).

---

## 9. Known Constraints

See CLAUDE.md's "Known Constraints" section — the full, current list lives there to avoid two copies drifting apart. Highlights relevant to *this* session are in §11 below.

---

## 10. Resolved Open Decisions

All previously-open decisions are resolved — see CLAUDE.md's Key Decisions table. Nothing currently open.

---

## 11. Current Session State (most recent — 2026-07-22)

**Major discovery and fix: the "ledger connectivity blocked" limitation documented across nearly this project's entire history was misdiagnosed.** It wasn't a network/firewall block — `agents/shared/network/network-config.ts`'s bundled genesis file only ever contained BCovrin's *original* 4 validator transactions, which have since been decommissioned and replaced with a new validator set at a different IP. Fetched and swapped in the current, full genesis file. Confirmed immediately: government, doctor, and healthcare-authority agents all registered real schema + credential definitions on Indy for the first time ever in this project. See CLAUDE.md's "Ledger Connectivity" section for full detail, including the residual (honest, environment-caused) flakiness that remains on BCovrin's small public test pool.

**Separate, newly-discovered, NOT-fixable-here limitation: Bifold's own bundled genesis (baked into the supervisor-provided APK) has the identical staleness.** Decompiled the APK and confirmed it via `apktool`. This blocks real AnonCreds credential acceptance on the physical phone, permanently, without a from-source Bifold rebuild (not attempted — flagged as a much bigger task, user chose not to pursue it this session). Checked Bifold's Developer Options for a ledger override — none exists in this build.

**Workaround, live-proved end-to-end on the physical Galaxy A20 phone:** used the DWN Protocol-based field-redaction selective-sharing pathway (Module 4's *other* mechanism, independent of AnonCreds/ledger entirely) plus the Doctor Portal's existing manual-entry identity fallback. Real flow proved live: Bifold connects via DIDComm (real) → doctor's automated ZKP proof request times out as expected → manual Patient Account ID entry → doctor issues a real prescription record to the patient's DWN → patient grants the doctor's DID access restricted to one field via the Consent Manager → doctor reads it back and correctly sees only the allowed field. This is the actual core "selective sharing" contribution, proven on real hardware, unaffected by Bifold's ledger limitation.

**3 real bugs found and fixed during this same live-testing pass** (all confirmed via reproducing the failure live, then fixing, then reproducing success):
1. `apps/web/src/hooks/usePolling.ts` — stale closure meant the polling interval kept checking an abandoned invitation ID forever after a re-render changed which one mattered. Fixed with latest-value refs.
2. `apps/web/src/components/ConnectionSetup.tsx` — React 18 Strict Mode's dev-mode double-invoke created two invitations per page load; whichever network response resolved last silently won, causing the same class of "polling the wrong invitation" symptom as bug #1, but from a genuine race rather than a stale closure. Fixed with the standard "ignore superseded effect" pattern.
3. `agents/doctor-agent/src/routes/medical-routes.ts` — `identityVerified` (DWN-record-only metadata) was leaking into the actual AnonCreds credential attributes sent to Credo-TS, which correctly rejected every real issuance with a schema-mismatch 500 error. Fixed by excluding it from the credential attributes while keeping it in the DWN write.

All three are live, confirmed working (real connections now detected correctly; real AnonCreds credential offers no longer 500).

**Housekeeping:** both CLAUDE.md and CONTEXT.md were significantly trimmed this session (old narrative/blow-by-blow bug-fix detail condensed to essential facts) to keep them under control as the project's documentation had grown very large. Full historical detail remains available via `git log`/commit messages if ever needed.

---

---

## 12. Session 2026-07-25 — real benchmark numbers, full security audit (8 fixes)

**Selective-disclosure benchmark, run against a supervisor-given target (63% payload reduction, 35ms latency cost, sub-second at ~50 concurrent).** Got real numbers, and they're the *opposite* of the target: AnonCreds selective disclosure is ~215% *larger* than a full reveal (reproduced 3x, with and without the age predicate isolated) — a real structural property of CL-signature schemes (hiding an attribute costs a real ZK proof-of-knowledge value; revealing one is free), not a bug, and not what the target paragraph's numbers describe (that's almost certainly a BBS+/JWT-VC-style scheme, where field omission really is cheap). Concurrency only reached 2-3 workflows safely — government-agent's native AnonCreds/Askar bindings crashed twice under bursty load (a real native-library issue, not this project's code). Building this surfaced and fixed 4 real, previously-unknown infrastructure bugs that had silently blocked *any* proof-based benchmark from ever working before this session (missing routes on government-agent, a Credo-TS auto-accept assumption that was never true, a query-key typo that made `/proof-data` return fake data on every agent project-wide, and a connectionId cross-party mismatch in the new benchmark code itself). Full detail in CLAUDE.md's "Selective-Disclosure Benchmark" section.

**Then: "we need a full top to bottom searching to root out any bugs."** Two rounds of parallel deep-audit passes across the entire codebase, 8 real bugs found and fixed (each independently confirmed live against real running services, not just typechecked):
1. `agents/shared/common-routes.ts` — a `restriction`/`restrictions` field-name typo silently dropped every credDef restriction on proof requests project-wide (real auth bypass — anyone could self-issue a matching credential and pass as government/hospital-verified).
2. DWN key-recovery routes accepted unverified recovery data (unauthenticated data-destruction bug) — fixed with a new backup-verification check. **First fix attempt was itself wrong** (treated "can't verify" the same as "verified," breaking legitimate recovery when backup was down) — caught by testing the legitimate path, not just the attack path, and redesigned to fail closed instead.
3. SSS share-provenance check was bypassable via a second, unauthenticated initiation endpoint.
4. Approved MPOA recovery requests never expired.
5. `queryRecord`'s `accessPolicy` leaked a patient's full consent graph to any single authorized third party.
6. Unvalidated `patientDID` flowed into backup storage scope keys — could poison shared backup state for every patient or escape the intended directory.
7. The share-manifest check from fix #3 only verified share *IDs*, not share *data* — a real ID with fabricated bytes passed silently.
8. `identityVerified` on doctor-issued records was entirely self-asserted by the client — now independently re-derived server-side from a real proof record.

Several more real bugs were found and are **still open** (not fixed this session) — see CLAUDE.md's Security Audit section for the full list: a wrong-fallback-credDef bug (reproduced live while testing fix #8), a resource-exhaustion angle introduced by fix #2/#6's own new verification call, a cross-patient localStorage leak in the government portal frontend, a few smaller `apiService.ts`/frontend gaps, and some benchmark-methodology fallout from fix #5.

**Housekeeping:** all project background services (government, doctor, DWN, SSS, backup-provider) were stopped cleanly at the end of this session — nothing left running. `.env`'s `ISSUER_CRED_DEF_ID` was updated mid-session to match government-agent's current boot (see CLAUDE.md's Known Constraints — this is a recurring env-hygiene step, check it first if identity verification fails next session).

---

## 13. Session 2026-07-26 — short session, deleted the prior Bifold rebuild, planned next session's wallet test

No implementation work this session — confirmed via `lsof`/`ps` that none of the project's background services (all ports 4000/4002/4004/4006/4008/4010/5050/3001) were running; nothing to shut down.

**Deleted the prior Bifold rebuild entirely, at explicit user request.** The `wallet/` fork folder was already gone from disk (removed at some point without doc updates); the one remaining artifact, `~/Desktop/MediTrust-Bifold-release.apk` (188MB, built 2026-07-25), was deleted. All references to it — the "Operation Newload" section, its file-map entry, and related mentions — were stripped from CLAUDE.md and this file, since keeping a detailed write-up of deleted work as if it were current state would be misleading.

**Decided plan for next session, clarified twice this session:** rebuild `wallet/` (Bifold) from scratch as an **exact replica of the original supervisor-provided `base.apk`** — same size class (~279MB, i.e. all 4 Android ABIs, not the arm64-only scoped build used last time), everything the original had "needed or not needed," with the **sole change being the genesis file** (`packages/core/src/configs/ledgers/indy/ledgers.json`, via the repo's own `yarn ledgers` refresh script). No theme/font modernization, no crash-resilience patches this time — those were bundled into the deleted build and are explicitly out of scope now, so that if the on-device credential-offer test passes or fails, it's unambiguous that the genesis file is what did (or didn't) do it.

---

## 14. Session 2026-07-27 — Bifold's genesis fixed for real, full live end-to-end proof on the physical phone

**Two approaches to fixing Bifold's stale genesis; the source rebuild surfaced real problems, the binary patch is what worked.** Full technical detail in CLAUDE.md's new "Bifold Wallet Genesis Fix" section — summary here.

**Attempt 1 — rebuilt `wallet/` from current `openwallet-foundation/bifold-wallet` main**, refreshed genesis via the repo's own `yarn ledgers` (confirmed byte-identical to the live BCovrin testnet and this project's own genesis), built a real multi-ABI debug APK. Got it running on the phone (after fixing pure build-tooling gaps: needed Node 20.19.2/Yarn 4.9.2, had to `yarn build` the internal `@bifold/*` packages, needed Metro running for a debug build). But then hit two **real, version-driven Credo-TS incompatibilities** between this project's agents (0.5.13) and the fresh build (0.6.3): a DID-document `@context` URI mismatch that broke the legacy Connections protocol, and — after switching to DidExchange to route around that — a DID-rotation "complete" message correlation bug that left the connection stuck at `response-sent` forever. Neither is genesis-related; both are the cost of testing against a newer app than the one actually in use. Reverting to Connections-only fixed the second issue but only because we're now testing the *original* app, not the rebuild.

**Attempt 2 — binary-patched the real `base.apk` directly**, decompiling with `apktool`, replacing just the stale genesis string inside the compiled JS bundle with the live verified-correct one, repackaging and signing. Package name, version, ABI set, and size class all identical to the original (279.15MB vs. 279.05MB, the delta being exactly the larger genesis). This is the one that actually worked, and it's genuinely "the same app, one file corrected" — not a rebuild, so none of the Credo-TS version gaps above applied.

**Full live proof on the physical phone, independently re-verified afterward (not just trusted):**
- Real DIDComm connections to both Government and Doctor agents, `state: completed`.
- Real AnonCreds `patient_credential` issued and accepted — real ledger schema resolution, no pool timeout.
- **Real AnonCreds zero-knowledge proof** for doctor's identity verification — the first time this project's core ZKP/selective-disclosure mechanism has completed on real hardware; previously always blocked, only the DWN-Protocol-based field-redaction pathway had ever been proven on-device.
- Real `medical_document_credential` issued, with `identityVerified: true` genuinely server-derived from that proof.
- Real DWN write, correctly AES-256-GCM round-tripped.
- Re-verified independently after the fact: queried the audit database directly, ran all 5 real audit events for the test patient through `AuditService.verify()` — all 5 passed; a deliberately-tampered copy of one correctly failed, confirming the verification is real, not a rubber stamp.

**Also found:** a sharper characterization of BCovrin's flakiness (a real per-DID write cooldown, not just general pool flakiness — a second schema write from the same DID moments after a first succeeding one gets rejected); a government-agent process crash with no log trace (resolved by restart, root cause unknown); and a self-caught mistake reading `audit-service.ts`'s console log format (`resource=` prints `resourceId`, not `targetDid` — gave the user a wrong account ID to switch to before catching it via the audit DB directly).

**Net result:** the original hypothesis from 2026-07-22 — that Bifold's stale genesis, not anything else, was blocking real credential use on the phone — is now proven correct, cleanly, with the confound (source-rebuild version drift) isolated and ruled out separately.
