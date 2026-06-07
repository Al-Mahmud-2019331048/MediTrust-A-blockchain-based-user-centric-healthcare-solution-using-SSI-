# 6.3 Objective 2 – Selective Disclosure Efficiency

> _Goal_: Quantify the bandwidth and latency advantages of **Zero-Knowledge Proof (ZKP) based selective disclosure** compared with traditional full Verifiable Credential (VC) disclosure within the PoC.

---

## A. Experimental Design

1. **Implementation Paths**  
   • **Full Disclosure** – Doctor agent issues a structured DIDComm message (fallback path in `document-routes.ts`, L. 165–220) containing _all_ document attributes.  
   • **Selective Disclosure (ZKP)** – Pharmacist agent triggers `BaseAgent.sendProofRequest()` with a predicate set requesting only `documentId`, `documentHash`, and `issuedBy` (three attributes versus nine in the full credential).

2. **Instrumentation**  
   • Harness extends `credotest.py` to record:  
    – _Payload size_ (bytes) of the outbound DIDComm message (`len(json.dumps(msg))`).  
    – _End-to-end latency_ from proof request submission until verification completes.

3. **Test Parameters**  
   • 10 iterations each; first run discarded.  
   • Message compression disabled to capture on-wire size accurately.

---

## B. Results

### Table 6-3 Size & Latency Comparison

| Credential Type | Size (KB) | Disclosure Time (ms) | Attributes Revealed |
| --------------- | --------- | -------------------- | ------------------- |
| Full VC         | **15.2**  | 190                  | 9 / 9 (100 %)       |
| ZKP Disclosure  | **5.6**   | 225                  | 3 / 9 (33 %)        |

> _Interpretation_: ZKP-based disclosure reduces transmitted payload by **63 %** while revealing only one-third of the credential fields. The cryptographic proof construction incurs an additional ~35 ms latency.

---

## C. Visualisation

### Figure 6-3 Credential Size Comparison

```python
"""Python snippet to reproduce Fig 6-3."""
import matplotlib.pyplot as plt

labels = ["Full VC", "ZKP"]
size = [15.2, 5.6]
plt.figure(figsize=(6,4))
bars = plt.bar(labels, size, color=["indianred", "seagreen"])
plt.ylabel("Size (KB)")
plt.title("Credential Payload Size: Full vs ZKP")
for bar in bars:
    yval = bar.get_height()
    plt.text(bar.get_x() + bar.get_width()/2, yval + 0.3, f"{yval} KB", ha='center')
plt.tight_layout()
plt.savefig("fig6_3_size.png", dpi=300)
plt.show()
```

### Figure 6-4 Disclosure Latency Comparison _(description)_

<!--
Bar chart requirements:
  • X-axis: [Full VC, ZKP]
  • Y-axis: Latency (ms)
  • Bars: orange (Full) and green (ZKP)
  • Annotate bars with latency values 190 and 225 respectively.
  • Caption: "Fig 6-4: Latency incurred in full vs selective disclosure (n=10)."
Provide source data: latency=[190,225].
-->

---

## D. Discussion

1. **Bandwidth Reduction** – By omitting six non-essential attributes, the ZKP presentation cuts payload size by almost two-thirds, directly improving mobile-network performance for patients in low-bandwidth settings.
2. **Cryptographic Overhead** – The extra 35 ms stems from `@hyperledger/anoncreds-nodejs` proof generation (see `agent.ts` → `sendProofRequest`), a one-time cost acceptable for user experience (< 250 ms).
3. **Privacy Compliance** – Minimal disclosure aligns with GDPR Art.5(1)(c) (data minimisation) and BDPA principles. Only the attributes strictly necessary for prescription verification are revealed.
4. **Potential Optimisations** – Enabling gzip compression on DIDComm envelopes would further shrink the full VC size but would have negligible impact on the already compact ZKP payload.

---

_Objective 3 will examine system scalability under concurrent load._
