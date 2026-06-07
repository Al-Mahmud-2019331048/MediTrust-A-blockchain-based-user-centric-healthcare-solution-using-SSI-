# Slide A — Quantitative Performance Highlights

### Latency • Bandwidth • Scalability

---

#### Key Metrics _(n = 10 runs)_

- **Credential issuance:** 480 ms
- **Credential presentation:** 360 ms _(fastest)_
- **Credential verification:** 520 ms _(ledger read overhead)_
- **ZKP disclosure payload:** 5.6 KB vs full VC 15.2 KB (**−63 %**)
- **ZKP disclosure latency:** 225 ms (only +35 ms over full VC)

#### Scalability Snapshot

| Concurrent Users | Avg Latency (ms) | p95 Latency (ms) | Throughput (req·s⁻¹) | Error Rate |
| ---------------: | ---------------: | ---------------: | -------------------: | ---------: |
|                1 |              520 |              610 |                  1.9 |        0 % |
|               50 |              910 |            1 180 |                 39.2 |        4 % |
|              100 |            1 340 |            1 680 |                 61.8 |        7 % |

> _Take-away:_ The system remains interactive (< 1 s) up to ~50 simultaneous credential workflows and gains substantial bandwidth savings through selective disclosure.

<!-- Visual suggestions:
1. Bar chart with four bars (Issuance, Presentation, Verification, ZKP latency).
2. Dual-axis line chart: X = concurrent users {1, 10, 50, 100}; left Y = latency, right Y = throughput.
Reuse code snippets from Fig 6-1 and Fig 6-5 to generate the graphics.
-->
