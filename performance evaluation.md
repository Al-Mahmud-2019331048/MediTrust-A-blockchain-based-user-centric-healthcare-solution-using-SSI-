# Performance Evaluation Workplan for SSI-Based eHealth System

> **Purpose**: Provide a step-by-step roadmap for producing a rigorous, publication-ready _Performance Evaluation_ section (Sections&nbsp;6.1 – 6.5) for the thesis on a patient-centric SSI healthcare system. The plan aligns with the instructional guide in `how to write performance evaluation.md` and incorporates both the back-end (`demo/credo`) and front-end (`interface`) codebases.

---

## 1. Objectives

1. Quantify latency, throughput, and resource usage of key SSI operations (credential issuance, presentation, verification, selective disclosure).
2. Evaluate data-minimisation benefits of ZKP-based selective disclosure versus full disclosure.
3. Analyse scalability under concurrent load.
4. Map technical features to privacy/regulatory requirements (GDPR/BDPA).
5. Present results in tables, charts, and academic commentary following the mandated subsection structure 6.1 – 6.5.

---

## 2. Experimental Assets

| Category                                | Asset                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Hardware                                | Local workstation (Intel i7 ≥12th Gen, 32 GB RAM) & optional VPS for WAN tests  |
| Back-end Agents                         | `demo/credo/server.ts` launched as _issuer_, _doctor_, _pharmacist_, _verifier_ |
| Ledger                                  | BCovrin test network (`network.ts` genesis)                                     |
| Database                                | MongoDB 6.x (Docker)                                                            |
| Front-end                               | Next-JS web app in `interface/`                                                 |
| Benchmark Harness                       | • `credotest.py` (REST & DIDComm timers) \                                      |
| • `ui_bench.py` (Playwright E2E timers) |
| Load-Testing Tool                       | Locust 2.x with custom scenarios                                                |
| Analysis Notebook                       | `analysis.ipynb` (Python, pandas, seaborn/matplotlib)                           |

---

## 3. Work Breakdown Structure

| Phase      | Tasks                                                 | Deliverables |
| ---------- | ----------------------------------------------------- | ------------ |
| P0 — Setup | • Clone repo, install Node 20, Python 3.11, Docker. \ |

              • Configure `.env` for agents & Mongo.  \
              • Verify all four agent roles start without error. | ‑ Working environment  \

- `setup_validation.log` |
  | P1 — Harness Development | **Backend**: \
  • Implement `credotest.py` to call REST endpoints corresponding to operations: \
  1. `/issue-credential` (issuance) \
  2. `/send-proof-request` + proof-status polling (presentation/verification) \
     • Wrap each call with `perf_counter_ns` and dump CSV. \
     **Frontend**: \
     • Implement `ui_bench.py` with Playwright: trigger UI actions & capture `performance.now()` spans, response sizes. | ‑ `credotest.py` \
- `ui_bench.py` \
- `sample_latency.csv` |
  | P2 — Selective Disclosure Benchmark | • Extend `credotest.py` to perform: \
   a. Full disclosure (structured message path). \
   b. ZKP proof (AnonCreds selective attributes). \
  • Record payload byte sizes & timings. | ‑ `disclosure_results.csv` |
  | P3 — Scalability Tests | • Author Locustfile: tasks for issuance & proof verification. \
  • Run at 10, 50, 100 concurrent users. \
  • Capture avg latency, p95, error %. | ‑ `scalability.csv` \
- Locust HTML report |
  | P4 — Data Analysis & Visualisation | • `analysis.ipynb`: read CSVs, compute mean, std-dev, min, max. \
  • Generate figures: \
   Fig 6.1 – Latency bar chart \
   Fig 6.2/6.3 – Disclosure size & latency \
   Fig 6.4 – Scalability line chart | ‑ `fig6_1.png`, `fig6_2.png`, … \
- `tables.md` with markdown tables |
  | P5 — Draft Writing | • Compose subsections 6.1–6.5 in `performance_evaluation_draft.md` integrating tables & figures. \
  • Add analytical narrative (explain causes, compare to literature). | ‑ Draft document |
  | P6 — Review & Finalise | • Peer review for clarity & academic tone. \
  • Convert to LaTeX or PDF if required. \
  • Commit final `performance evaluation.md` section into thesis. | ‑ Final section \
- Review notes |

---

## 4. Detailed Task Notes

### 4.1 Credential Operation Mapping

| Operation               | Endpoint / Function                                   | Timer Start → End     |
| ----------------------- | ----------------------------------------------------- | --------------------- |
| Credential Issuance     | POST `/issue-credential` → 200 OK                     | Req send → HTTP 200   |
| Credential Presentation | POST `/send-proof-request` → proof cache `done` state | Req send → cache hit  |
| Credential Verification | Poll `/proof-status/:id` until `isVerified=true`      | First poll → verified |
| Revocation (N/A)        | No implementation; label as `—` in table              | —                     |

### 4.2 Statistical Treatment

- Run each measurement **10 times**.
- Compute mean (μ), standard deviation (σ), min, max.
- Detect outliers (>2σ) – exclude or discuss.

### 4.3 Graph Specifications

- Follow colour scheme: _blue = full disclosure_, _green = ZKP_, _orange = E2E_, _grey = Agent-only_.
- Figure numbers & captions exactly as per guide.

### 4.4 Compliance Mapping Checklist

| Feature                         | Source Code Pointer                                  | Regulation Clause |
| ------------------------------- | ---------------------------------------------------- | ----------------- |
| Minimal Disclosure (ZKP)        | `agent.ts` → `sendProofRequest` selective attributes | GDPR Art.5(1c)    |
| Data Portability (VC export)    | DIDComm JSON payloads                                | GDPR Art.20       |
| Consent Logging (partial)       | Proof & credential records in Mongo + agent wallets  | GDPR Art.7(1)     |
| Lawful Processing Documentation | JWT-signed metadata in `document-storage.ts`         | BDPA §15          |

---

## 5. Timeline (7-Day Example)

| Day | Milestone                                    |
| --- | -------------------------------------------- |
| 1   | Environment prepared; agents & Mongo running |
| 2   | Harness scripts completed (P1)               |
| 3   | Selective disclosure scripts done (P2)       |
| 4   | Scalability tests executed (P3)              |
| 5   | Data analysis & figures (P4)                 |
| 6   | Draft written (P5)                           |
| 7   | Review & final integration (P6)              |

---

## 6. Risk & Mitigation

| Risk                             | Mitigation Strategy                                     |
| -------------------------------- | ------------------------------------------------------- |
| Indy ledger downtime             | Cache genesis locally; switch to local ledger if needed |
| Native binding install failures  | Provide Dockerfile with pre-built binaries              |
| High variance in network latency | Run tests off-peak; take ≥10 samples                    |
| Browser automation flakiness     | Retry logic in Playwright; disable animations           |

---

## 7. Acceptance Criteria

- All CSV datasets generated and committed.
- Figures 6.1–6.4 embedded with captions.
- Tables follow templates in the guide.
- Narrative explains _why_ results occur and references related work.

---

> **Next Action**: commence _Phase P0 — Setup_ and log any environment issues encountered.
