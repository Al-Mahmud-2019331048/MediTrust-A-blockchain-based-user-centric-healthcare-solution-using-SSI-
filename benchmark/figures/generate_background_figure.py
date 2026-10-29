#!/usr/bin/env python3
"""Draws the Background-section figure: how a Decentralised Web Node works in
MediTrust.

This is a SCHEMATIC, not a data plot — unlike generate_figures.py it reads no
benchmark results. Every arrow corresponds to a real code path in this repo:

  1/2  agents/shared/network/network-config.ts  (Indy pool, DID/credDef resolution)
  3    agents/shared/common-routes.ts           (AnonCreds proof request/verify)
  4    dwn/patient-node/src/routes/record-routes.ts        (POST /dwn/storeRecord)
  5    audit/src/services/anchor-client.ts + records.ts    (attemptAnchor / markRecordAnchored)
  6    dwn/patient-node/src/routes/permission-routes.ts    (POST /dwn/shareRecord)
  7    dwn/patient-node/src/interfaces/protocols.ts        (applyFieldFilter on queryRecord)

Run from the repo root:

    benchmark/figures/venv/bin/python benchmark/figures/generate_background_figure.py

Outputs both .pdf (vector, for \\includegraphics) and .png into
benchmark/figures/out/ as fig-dwn-in-meditrust.*
"""
import os

import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
os.makedirs(OUT_DIR, exist_ok=True)

# Palette — kept consistent with the evaluation figures' blue (#1f4e9c), with a
# purple ledger echoing the reference diagram's resolver.
PATIENT_EDGE = "#1f4e9c"
PATIENT_FILL = "#e8f0fb"
PROVIDER_EDGE = "#4a4a4a"
PROVIDER_FILL = "#f0f0f0"
LEDGER_EDGE = "#6b3fa0"
LEDGER_FILL = "#f0e8fa"
ARROW = "#333333"
LABEL_SIZE = 6.6
TITLE_SIZE = 8.4
SUB_SIZE = 6.5


def box(ax, cx, cy, w, h, title, sub, edge, fill, dashed=False, title_size=TITLE_SIZE):
    ax.add_patch(
        FancyBboxPatch(
            (cx - w / 2, cy - h / 2),
            w,
            h,
            boxstyle="round,pad=0,rounding_size=1.2",
            linewidth=1.3,
            edgecolor=edge,
            facecolor=fill,
            linestyle="--" if dashed else "-",
            zorder=3,
        )
    )
    ax.text(
        cx,
        cy + (h / 2) - 2.6,
        title,
        ha="center",
        va="center",
        fontsize=title_size,
        fontweight="bold",
        color=edge,
        zorder=4,
    )
    ax.text(
        cx,
        cy - 1.2,
        sub,
        ha="center",
        va="center",
        fontsize=SUB_SIZE,
        color="#222222",
        linespacing=1.45,
        zorder=4,
    )


def arrow(ax, xy_from, xy_to, rad=0.0, dashed=False, double=False):
    ax.add_patch(
        FancyArrowPatch(
            xy_from,
            xy_to,
            connectionstyle=f"arc3,rad={rad}",
            arrowstyle="<|-|>" if double else "-|>",
            mutation_scale=11,
            linewidth=1.1,
            color=ARROW,
            linestyle="--" if dashed else "-",
            shrinkA=0,
            shrinkB=0,
            zorder=2,
        )
    )


def label(ax, x, y, text, rotation=0.0, size=LABEL_SIZE):
    ax.text(
        x,
        y,
        text,
        ha="center",
        va="center",
        fontsize=size,
        rotation=rotation,
        rotation_mode="anchor",
        color="#111111",
        linespacing=1.4,
        bbox=dict(boxstyle="round,pad=0.28", facecolor="white", edgecolor="none", alpha=0.94),
        zorder=5,
    )


def build():
    fig, ax = plt.subplots(figsize=(11, 7.04))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 64)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- nodes -------------------------------------------------------------
    box(ax, 32, 52, 32, 11, "Patient's DWN node",
        "Records  \u00b7  Permissions  \u00b7  Protocols\nAES-256-GCM encrypted store (LevelDB)",
        PATIENT_EDGE, PATIENT_FILL)

    box(ax, 6.5, 52, 12, 9, "Backup\nreplica", "ciphertext only",
        PATIENT_EDGE, "#f5f9ff", dashed=True, title_size=7.4)

    box(ax, 78, 52, 30, 11, "Doctor's agent",
        "DIDComm  \u00b7  AnonCreds verifier\nDWN client",
        PROVIDER_EDGE, PROVIDER_FILL)

    box(ax, 14, 14, 20, 10, "Patient's device",
        "SSI wallet \u2014 DIDs and\nverifiable credentials",
        PATIENT_EDGE, PATIENT_FILL)

    box(ax, 86, 14, 24, 10, "Doctor's portal",
        "clinician-facing\napplication",
        PROVIDER_EDGE, PROVIDER_FILL)

    box(ax, 50, 24, 24, 8, "Hyperledger Indy",
        "DIDs \u00b7 schemas \u00b7 credential\ndefinitions \u00b7 integrity anchors",
        LEDGER_EDGE, LEDGER_FILL, title_size=8.0)

    # blockchain motif under the ledger
    ax.plot([37, 63], [16.2, 16.2], color=LEDGER_EDGE, linewidth=1.0, zorder=2)
    for i in range(5):
        x = 40.0 + i * 4.3
        ax.add_patch(Rectangle((x, 14.5), 3.2, 3.4, linewidth=1.0,
                               edgecolor=LEDGER_EDGE, facecolor="#e2d4f2", zorder=3))

    # --- flows -------------------------------------------------------------
    # 1. wallet resolves issuer DID / credential definition
    arrow(ax, (24.0, 13.5), (38.0, 20.6), double=True)
    label(ax, 33.0, 10.8, "1. Wallet resolves issuer\nDID + credential definition")

    # 2. verifier resolves the same definition
    arrow(ax, (74.0, 13.5), (62.0, 20.6), double=True)
    label(ax, 67.0, 10.8, "2. Verifier resolves\nthe same definition")

    # 3. ZKP identity proof, device -> doctor's agent
    arrow(ax, (22.0, 19.0), (66.0, 46.5))
    label(ax, 32.0, 25.2, "3. Zero-knowledge\nidentity proof", rotation=32.0)

    # 4. doctor writes the encrypted record into the patient's node
    arrow(ax, (63.0, 52.0), (48.0, 52.0))
    label(ax, 55.5, 56.0, "4. Doctor writes a record\ninto the patient's node")

    # 5. record hash anchored on-chain
    arrow(ax, (36.0, 46.5), (44.2, 28.1))
    label(ax, 27.5, 38.0, "5. Record hash\nanchored on-chain")

    # 6. patient grants scoped consent inside their own node
    arrow(ax, (14.0, 19.0), (24.0, 46.5))
    label(ax, 8.5, 32.0, "6. Patient grants\nscoped consent")

    # 7. field-filtered read back to the doctor
    arrow(ax, (46.0, 46.5), (76.0, 19.0))
    label(ax, 66.5, 27.5, "7. Field-filtered\nread", rotation=-42.5)

    # backup replication
    arrow(ax, (12.6, 52.0), (15.9, 52.0), dashed=True, double=True)
    label(ax, 9.5, 60.0, "encrypted, patient-\nauthenticated replica", size=6.2)

    # --- legend ------------------------------------------------------------
    for i, (fill, edge, text) in enumerate([
        (PATIENT_FILL, PATIENT_EDGE, "patient-controlled"),
        (PROVIDER_FILL, PROVIDER_EDGE, "provider-side"),
        (LEDGER_FILL, LEDGER_EDGE, "public ledger"),
    ]):
        x = 2.0 + i * 22.0
        ax.add_patch(Rectangle((x, 2.0), 3.0, 2.2, linewidth=1.0,
                               edgecolor=edge, facecolor=fill, zorder=3))
        ax.text(x + 4.0, 3.1, text, ha="left", va="center", fontsize=6.4, color="#222222")

    return fig


def save(fig, name):
    pdf_path = os.path.join(OUT_DIR, f"{name}.pdf")
    png_path = os.path.join(OUT_DIR, f"{name}.png")
    fig.savefig(pdf_path, bbox_inches="tight")
    fig.savefig(png_path, dpi=300, bbox_inches="tight")
    print(f"wrote {pdf_path}")
    print(f"wrote {png_path}")


if __name__ == "__main__":
    save(build(), "fig-dwn-in-meditrust")
