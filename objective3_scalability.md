# 6.4 Objective 3 – System Scalability & Throughput

> _Goal_: Evaluate how the SSI PoC performs as the number of simultaneous credential‐issuance sessions increases, identifying bottlenecks and breaking points.

---

## A. Load-Testing Methodology

1. **Tooling**  
   • **Locust 2.24** orchestrated HTTP traffic toward the _issuer_ and _doctor_ agents.  
   • Each virtual user (VU) executes the full workflow: _create connection → issue credential → poll confirmation_.

2. **Scenario Configuration**  
   | Parameter | Value |
   | -------------------- | --------------------------------------- |
   | Spawn rates | 1, 10, 50, 100 VUs |
   | Test duration | 120 s (per level) |
   | Think-time | 1 s between steps |
   | Database pool size | 30 (default MongoDB driver) |
   | Max HTTP keep-alive | 100 |

3. **Metrics Captured**  
   • **Avg latency** and **95-th percentile** per request type.  
   • **Throughput** (requests · s⁻¹).  
   • **Error rate** (non-2xx responses).  
   • **System resources** via `pidstat –rud` (issuer agent process).

---

## B. Results

### Table 6-4 Scalability Metrics (Credential Issuance)

| Concurrent Users | Avg Latency (ms) | p95 Latency (ms) | Throughput (req · s⁻¹) | Error Rate (%) |
| ---------------- | ---------------- | ---------------- | ---------------------- | -------------- |
| 1                | 520              | 610              | 1.9                    | 0.0            |
| 10               | 680              | 820              | 12.7                   | 0.9            |
| 50               | 910              | 1 180            | 39.2                   | 4.2            |
| 100              | 1 340            | 1 680            | 61.8                   | 7.5            |

> _Interpretation_: Latency grows sub-linearly up to 50 concurrent users but degrades sharply beyond 100, signalling resource contention.

### Figure 6-5 Latency & Throughput under Load

```python
"""Python snippet to generate Fig 6-5."""
import matplotlib.pyplot as plt
import numpy as np

users = np.array([1, 10, 50, 100])
lat_avg = np.array([520, 680, 910, 1340])
throughput = np.array([1.9, 12.7, 39.2, 61.8])

fig, ax1 = plt.subplots(figsize=(7,4))
color = 'tab:blue'
ax1.set_xlabel('Concurrent Users')
ax1.set_ylabel('Avg Latency (ms)', color=color)
ax1.plot(users, lat_avg, marker='o', color=color)
ax1.tick_params(axis='y', labelcolor=color)

ax2 = ax1.twinx()
color = 'tab:green'
ax2.set_ylabel('Throughput (req·s⁻¹)', color=color)
ax2.plot(users, throughput, marker='s', linestyle='--', color=color)
ax2.tick_params(axis='y', labelcolor=color)

plt.title('System Scalability – Credential Issuance')
fig.tight_layout()
plt.savefig('fig6_5_scalability.png', dpi=300)
plt.show()
```

---

## C. Resource Utilisation Trends

| Metric (Issuer Agent) | 1 VU | 50 VU | 100 VU |
| --------------------- | ---- | ----- | ------ |
| CPU % (mean)          | 7    | 68    | 92     |
| RSS Memory (MiB)      | 220  | 610   | 880    |
| Disk I/O (KB s⁻¹)     | 35   | 210   | 390    |
| Network Out (KB s⁻¹)  | 20   | 310   | 560    |

_Observation_: CPU utilisation approaches saturation at ≈ 90 % during the 100-user test, corroborating latency spikes. Memory growth remains linear due to per-connection in-memory objects in `agent.ts`.

---

## D. Bottleneck Analysis

1. **Node Event Loop** – Single-threaded Express server becomes the primary bottleneck; enabling Clustering (`node --experimental-cluster`) would distribute VUs across cores.
2. **Database Connections** – Default pool size (30) produces queueing at 100 VUs. Increasing the pool or switching to a non-blocking driver (e.g., `mongoose + connectionPoolSize=100`) reduces p95 latency by ~9 % in pilot tests.
3. **Ledger Network Latency** – Indy-VDR calls add fixed RTT penalties; running a local ledger node would shave ≈ 70 ms off every issuance verification.

---

## E. Recommendations

- **Horizontal Scaling** – Deploy each agent role in its own container and replicate issuer instances behind an L7 load balancer.
- **Connection Pool Tuning** – Align MongoDB pool to anticipated peak concurrency (≥ 100).
- **Asynchronous Job Queue** – Offload credential issuance to a background worker; respond immediately with job ID to keep UI snappy.

---

_Objective 4 will investigate Privacy & Regulatory Compliance._
