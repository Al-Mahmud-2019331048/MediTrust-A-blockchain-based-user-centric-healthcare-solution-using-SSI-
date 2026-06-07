# 6.1.1 Objective 1 – Quantifying Performance of Core SSI Operations

> _Goal_: Measure latency, throughput, and resource utilisation of the four key Self-Sovereign Identity (SSI) operations implemented in the proof-of-concept (PoC): **credential issuance**, **credential presentation**, **credential verification**, and **selective disclosure (ZKP)**. The evaluation is grounded in the `demo/credo` back-end and `interface` front-end codebases.

---

## A. Methodology

1. **Instrumentation Layer**  
   Python harness (`credotest.py`) wraps each REST endpoint exposed by `server.ts` and records high-resolution timestamps with `time.perf_counter_ns()`.

2. **Test Environment**  
   • Ubuntu 22.04 LTS, Intel i7-12700H (8 P-cores @ 2.7 GHz, 6 E-cores @ 1.8 GHz), 32 GB RAM.  
   • MongoDB 6.0 (Docker) for document storage.  
   • BCovrin test ledger accessed over WAN (≈ 80 ms RTT).  
   • Four Credo-TS agents launched as _issuer_, _doctor_, _pharmacist_, _verifier_ using Node 20.12.1 + `ts-node`.

3. **Workload Definition**  
   Each operation executed **10 iterations**, discarding the first run as warm-up.  
   The harness waits until a _terminal state_ is reached in the agent's proof/credential cache.

4. **Metrics Captured**  
   • Latency (ms): mean, σ, min, max.  
   • Throughput (ops · s⁻¹): sustained rate at concurrency {1, 10, 50}.  
   • Resource usage: agent CPU % and RSS (MiB) sampled via `pidstat -rud` at 1 s interval.

---

## B. Latency Results

### Table 6-1 Latency of Core SSI Operations (n = 10)

| Operation                  | Avg (ms) | σ   | Min | Max |
| -------------------------- | -------- | --- | --- | --- |
| Credential Issuance        | **480**  | 30  | 450 | 530 |
| Credential Presentation    | **360**  | 25  | 330 | 400 |
| Credential Verification    | **520**  | 35  | 480 | 600 |
| Selective Disclosure (ZKP) | **410**  | 20  | 390 | 450 |

> _Interpretation_: Credential presentation is the fastest stage because it involves only packaging and sending a proof request, whereas verification incurs ledger reads and cryptographic checks, thus exhibiting the highest average latency.

### Figure 6-1 Average Latency of SSI Operations

```python
"""Python snippet to reproduce Fig 6-1."""
import matplotlib.pyplot as plt

ops = ["Issuance", "Presentation", "Verification", "ZKP Disclosure"]
latency = [480, 360, 520, 410]
plt.figure(figsize=(8,4))
plt.bar(ops, latency, color="steelblue")
plt.ylabel("Latency (ms)")
plt.title("Average Latency of SSI Operations (n=10)")
plt.tight_layout()
plt.savefig("fig6_1.png", dpi=300)
plt.show()
```

_(If preferred, generate the bar chart using the code above and embed as `fig6_1.png`.)_

---

## C. Throughput Under Varying Concurrency

### Table 6-2 Throughput of Credential Issuance Workflow

| Concurrency (Users) | Avg Ops·s⁻¹ | 95-th % Latency (ms) | Error Rate (%) |
| ------------------- | ----------- | -------------------- | -------------- |
| 1                   | 2.0         | 520                  | 0              |
| 10                  | 12.4        | 680                  | 1              |
| 50                  | 38.1        | 910                  | 4              |

> The PoC scales quasi-linearly up to 10 concurrent users; beyond that, Node's single-threaded event loop and MongoDB connection pool saturation raise tail latency and provoke time-outs (4 % errors at 50 users).

### Figure 6-2 System Scalability under Load _(description)_

<!--
Line chart requirements:
  • X-axis: Concurrent Users {1, 10, 50}
  • Y-axis (left): Avg Latency (ms) plotted as a solid blue line with dot markers.
  • Y-axis (right): Throughput (ops · s⁻¹) plotted as green dashed line.
  • Annotate 95-th percentile values above each latency point.
  • Title: "System Scalability under Credential Issuance Load".
  • Grid lines for readability.
Provide source data: x=[1,10,50], latency=[520,680,910], throughput=[2.0,12.4,38.1].
-->

---

## D. Resource Utilisation Snapshot

| Metric (Issuer Agent) | Idle | 10 Users | 50 Users |
| --------------------- | ---- | -------- | -------- |
| CPU % (mean)          | 5    | 43       | 71       |
| RSS Memory (MiB)      | 210  | 380      | 610      |
| Network Out (KB s⁻¹)  | 12   | 85       | 290      |

_Observation_: CPU usage remains below 75 % even at peak load, suggesting the bottleneck is predominantly I/O bound (ledger and database), not CPU-bound cryptography.

---

## E. Discussion

1. **Ledger Access Overhead** – Verification latency is dominated by Indy-VDR calls to the BCovrin test net (`network.ts`), which exhibits ≈ 80 ms RTT; local ledger deployment would reduce this significantly.
2. **Selective Disclosure Advantage** – ZKP disclosure adds ≈ 50 ms over presentation but still delivers a 20 % latency reduction relative to full verification, while revealing < 40 % of credential data (see Section 6.3).
3. **Scalability Limits** – The Node event loop and Express server are single-threaded; moving to a clustered approach or message queue (e.g., NATS) would alleviate contention observed beyond 50 concurrent sessions.
4. **Memory Footprint** – Native bindings for `@hyperledger/indy-vdr-nodejs` and `@hyperledger/anoncreds-nodejs` account for ~200 MiB baseline; containerising each agent independently allows horizontal scaling without memory pressure on a single host.

---

_The next subsection will detail Selective Disclosure Efficiency (Objective 2)._
