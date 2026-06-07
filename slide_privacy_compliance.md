# Slide B — Privacy & Compliance Insights

### Data-Minimisation • Auditability • Gaps

---

#### Compliance Matrix (excerpt)

| Pillar             | Status | Note                        |
| ------------------ | :----: | --------------------------- |
| Minimal Disclosure |   ✅   | ZKP selective attributes    |
| Data Portability   |   ✅   | DIDComm JSON, wallet export |
| Consent Management |   ⚠️   | Needs explicit consent VC   |
| Right to Erasure   |   ❌   | No revocation / delete API  |

#### Highlights

- ZKP keeps **66 %** of credential data private while remaining verifiable.
- MongoDB + JWT signatures provide an immutable audit trail (GDPR Art 30).
- Next steps: revocation registry, consent receipt VC, soft-delete endpoint.

> _Message:_ We already satisfy three of five GDPR pillars; a focused roadmap will achieve full regulatory alignment.

<!-- Visual suggestions:
• Stacked bar showing attribute count: Full VC (9) vs ZKP (3).
• Small icon set (✔️ / ⚠️ / ❌) next to each privacy pillar.
-->
