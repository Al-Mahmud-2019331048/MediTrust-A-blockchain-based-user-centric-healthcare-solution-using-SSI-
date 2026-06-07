# 6.5 Objective 4 – Privacy & Regulatory Compliance Assessment

> _Goal_: Analyse how the PoC realises privacy-preserving principles and aligns with relevant regulations such as the European **GDPR** and the Bangladesh **Digital Personal Data Protection Act (BDPA)**.

---

## A. Evaluation Framework

The assessment adopts the five–pillar model used in Bonik _et al._ (2023): _Minimal Disclosure_, _Data Portability_, _Consent Management_, _Auditability_, and _Right to Erasure_. For each pillar we map code artefacts to legal clauses and assign a compliance rating.

### Compliance Rating Legend

| Symbol | Meaning               |
| ------ | --------------------- |
| ✅     | Fully Implemented     |
| ⚠️     | Partially Implemented |
| ❌     | Not Implemented       |

---

## B. Compliance Matrix

| Privacy Pillar     | Implemented | Code Reference(s)                                                                      | GDPR Article(s) / BDPA Clause | Commentary                                                                   |
| ------------------ | ----------- | -------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| Minimal Disclosure | ✅          | `agent.ts` → `sendProofRequest` (selective attributes); Section 6.3                    | Art.5(1)(c)                   | Only required fields (`documentId`, `hash`, `issuedBy`) revealed via ZKP.    |
| Data Portability   | ✅          | DIDComm JSON payloads; `/medical-document/*` endpoints                                 | Art.20                        | Credentials can be exported/imported between wallets without format loss.    |
| Consent Management | ⚠️          | Proof / credential state stored in Mongo (`prisma.schema`); no explicit consent schema | Art.7(1); BDPA §11            | Implicit consent through DID exchange; explicit consent logging recommended. |
| Auditability       | ✅          | Mongo `Document` model (timestamps); JWT‐signed metadata in `document-storage.ts`      | Art.30                        | Immutable timestamps and signatures allow post-hoc audit trails.             |
| Right to Erasure   | ❌          | No deletion endpoint; documents immutable in Mongo                                     | Art.17                        | Requires data‐erasure workflow and ledger revocation support.                |
| Purpose Limitation | ✅          | Separate credential definitions per role (`server.ts` L. 700–1020)                     | Art.5(1)(b)                   | Credentials scoped to healthcare use; no cross-context reuse.                |
| Pseudonymisation   | ✅          | Peer DIDs replace direct identifiers in messages                                       | Recital 29                    | Reduces linkage risk; real PID only inside encrypted credentials.            |

---

## C. Gap Analysis

1. **Consent Granularity** – The system records credential exchange state but lacks a dedicated consent ledger. A lightweight consent schema (e.g., Verifiable Consent Receipt VC) could be issued alongside every medical credential.
2. **Right to Erasure** – Current design stores binary documents permanently. Implementing _credential revocation_ via AnonCreds revocation registries and a _soft-delete_ flag in Mongo would satisfy Art.17 without violating ledger immutability.
3. **Data Retention Policy** – No automated purge mechanism exists. Add a scheduled task that archives or deletes records older than the legally mandated retention period.

---

## D. Recommendations

- **Consent VC Integration** – Extend `DocumentService.storeDocument` to optionally issue a consent receipt credential referencing the stored document ID.
- **Revocation Registry** – Activate Credo-TS revocation support; store `revRegId` and expose `/revoke-credential` endpoint.
- **Delete API & Anonymisation** – Provide `/document/:id/delete` route that overwrites file content with zeros, retains hash for integrity, and flags the record as _erased_.

---

## E. Conclusion

The PoC satisfies three of the five primary privacy pillars outright and partially meets a fourth. Addressing consent granularity and erasure workflows will elevate the system to full GDPR/BDPA compliance, fortifying trust for patient-centric deployment.
