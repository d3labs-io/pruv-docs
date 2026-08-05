#!/usr/bin/env python3
"""Render flow.png for each bridge example package."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

KAIA = "#f6e2c8"
KAIA_E = "#c2762a"
PRUV = "#cfe0f5"
PRUV_E = "#2b5f9e"
VAULT = "#dbeedb"
VAULT_E = "#3d7a3d"
PHASE = "#3c3c46"
OPT = "#f2e2f2"
OPT_E = "#8a4a8a"

BOX_W = 7.4
BOX_H = 0.52
GAP = 0.26
PHASE_H = 0.42


def draw(ax, y, kind, title, sub=None, fill=PRUV, edge=PRUV_E, x=1.0, w=BOX_W):
    if kind == "phase":
        ax.add_patch(FancyBboxPatch((x, y - PHASE_H), w, PHASE_H,
                                    boxstyle="round,pad=0.02,rounding_size=0.06",
                                    fc=PHASE, ec=PHASE, zorder=2))
        ax.text(x + w / 2, y - PHASE_H / 2, title, ha="center", va="center",
                fontsize=10.5, color="white", fontweight="bold", zorder=3)
        return y - PHASE_H
    h = BOX_H if sub is None else BOX_H + 0.22
    ax.add_patch(FancyBboxPatch((x, y - h), w, h,
                                boxstyle="round,pad=0.02,rounding_size=0.08",
                                fc=fill, ec=edge, lw=1.1, zorder=2))
    if sub is None:
        ax.text(x + 0.16, y - h / 2, title, ha="left", va="center",
                fontsize=9.6, color="#1c1c22", zorder=3)
    else:
        ax.text(x + 0.16, y - h / 2 + 0.15, title, ha="left", va="center",
                fontsize=9.6, color="#1c1c22", fontweight="bold", zorder=3)
        ax.text(x + 0.16, y - h / 2 - 0.16, sub, ha="left", va="center",
                fontsize=8.3, color="#4a4a55", zorder=3)
    return y - h


def arrow(ax, y_from, y_to, x=None, label=None, style="-", color="#55555f"):
    x = x if x is not None else 1.0 + BOX_W / 2
    ax.add_patch(FancyArrowPatch((x, y_from), (x, y_to),
                                 arrowstyle="-|>", mutation_scale=13,
                                 lw=1.2, color=color, linestyle=style, zorder=1))
    if label:
        ax.text(x + 0.14, (y_from + y_to) / 2, label, ha="left", va="center",
                fontsize=8.0, color=color, style="italic", zorder=3)


def content_height(rows):
    """Sum of row heights + inter-row gaps."""
    total = 0.0
    for row in rows:
        if row[0] == "gap":
            total += row[1]
            continue
        if row[0] == "phase":
            total += PHASE_H + GAP
            continue
        opts = row[-1] if isinstance(row[-1], dict) else {}
        total += (BOX_H if opts.get("sub") is None else BOX_H + 0.22) + GAP
    return total


TOP_MARGIN = 0.42 + 0.30 + 0.46   # title + subtitle + spacing before first row
BOT_MARGIN = 0.30 + 0.18 + 0.34   # legend row + bottom padding


def render(path, title, subtitle, rows, legend):
    height = TOP_MARGIN + content_height(rows) + BOT_MARGIN
    fig, ax = plt.subplots(figsize=(9.4, height), dpi=150)
    ax.set_xlim(0, 9.4)
    ax.set_ylim(0, height)
    ax.axis("off")
    fig.patch.set_facecolor("white")

    y = height - 0.42
    ax.text(4.7, y, title, ha="center", va="center", fontsize=14, fontweight="bold",
            color="#1c1c22")
    y -= 0.30
    ax.text(4.7, y, subtitle, ha="center", va="center", fontsize=9.2, color="#5a5a66")
    y -= 0.42

    prev_bottom = None
    for row in rows:
        kind = row[0]
        if kind == "gap":
            y -= row[1]
            prev_bottom = None
            continue
        if prev_bottom is not None:
            arrow(ax, prev_bottom, y, label=row[-1].get("arrow") if isinstance(row[-1], dict) else None)
        opts = row[-1] if isinstance(row[-1], dict) else {}
        bottom = draw(ax, y, kind, row[1],
                      sub=opts.get("sub"),
                      fill=opts.get("fill", PRUV),
                      edge=opts.get("edge", PRUV_E))
        prev_bottom = bottom
        y = bottom - GAP

    # legend
    y_leg = 0.30
    x_leg = 1.0
    for label, fill, edge in legend:
        ax.add_patch(FancyBboxPatch((x_leg, y_leg), 0.26, 0.18,
                                    boxstyle="round,pad=0.01,rounding_size=0.04",
                                    fc=fill, ec=edge, lw=1.0))
        ax.text(x_leg + 0.34, y_leg + 0.09, label, ha="left", va="center",
                fontsize=8.2, color="#3a3a44")
        x_leg += 0.42 + 0.075 * len(label) * 1.5

    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", path)


BASE = "/Users/thomas/Desktop/D3Labs/pruv-docs/examples/bridge-rwa-pruv-kaia-example"

# ─────────────────────────── scripts-usdt ───────────────────────────
render(
    f"{BASE}/scripts-usdt/flow.png",
    "scripts-usdt — single-hop USDT bridge",
    "src/main.ts   |   Kaia Kairos (1001) <-> Pruv Testnet (7336)   |   direction from --source-chain / --destination-chain",
    [
        ("box", "Resolve token: warpRoute.wrappedToken()",
         {"sub": "falls back to warp route address for synthetic HypERC20", "fill": KAIA, "edge": KAIA_E}),
        ("box", "Step 1  quoteTransferRemote(dstDomain, recipient32, amount)",
         {"sub": "returns [{token, amount}] : native gas + token entries", "fill": KAIA, "edge": KAIA_E,
          "arrow": "quote BEFORE approve"}),
        ("box", "Step 1b  approve each ERC20 fee token -> warp route",
         {"sub": "Pruv-side routes charge 0.1 USDC (HypERC20CollateralWithFee)", "fill": OPT, "edge": OPT_E}),
        ("box", "Step 2  approve transfer token = amount + token-denominated fee",
         {"sub": "ensureAllowance() skips if allowance already sufficient", "fill": KAIA, "edge": KAIA_E}),
        ("box", "Step 3  transferRemote(dstDomain, recipient32, amount) {value: gas}",
         {"sub": "wait for receipt -> Success / Reverted", "fill": KAIA, "edge": KAIA_E}),
        ("box", "Step 4  poll destination for the ReceivedTransferRemote event",
         {"sub": "getLogs every 5s, 10 min timeout, retries transient RPC errors", "fill": PRUV, "edge": PRUV_E,
          "arrow": "Hyperlane relayer delivers"}),
        ("box", "Append run details to output.md",
         {"sub": "tx hashes, quote breakdown, relay status", "fill": VAULT, "edge": VAULT_E}),
    ],
    [("source chain", KAIA, KAIA_E), ("destination chain", PRUV, PRUV_E),
     ("conditional", OPT, OPT_E), ("local artifact", VAULT, VAULT_E)],
)

# ─────────────────────────── scripts-mint ───────────────────────────
render(
    f"{BASE}/scripts-mint/flow.png",
    "scripts-mint — USDT -> RWA mint -> Kaia",
    "src/main.ts   |   3 phases, no CLI direction: always Kaia -> Pruv -> mint -> Kaia",
    [
        ("phase", "PHASE 1   Bridge USDT  Kaia -> Pruv   (USDT warp route)", {}),
        ("box", "1.1  quoteTransferRemote -> native gas + USDT entry",
         {"sub": "quote echoes the transfer amount; script folds it into the approval", "fill": KAIA, "edge": KAIA_E}),
        ("box", "1.2  approve USDT -> USDT warp route (amount + fee)",
         {"fill": KAIA, "edge": KAIA_E}),
        ("box", "1.3  transferRemote(7336, recipient32, usdtAmount)",
         {"fill": KAIA, "edge": KAIA_E}),
        ("box", "1.4  wait for ReceivedTransferRemote on Pruv",
         {"sub": "abort flow on timeout", "fill": PRUV, "edge": PRUV_E, "arrow": "relayer"}),
        ("gap", 0.30),
        ("phase", "PHASE 2   Mint RWA via vault deposit on Pruv", {}),
        ("box", "2.1  whitelist.balanceOf(sender, 1) must be > 0",
         {"sub": "ERC1155 gate; abort if not whitelisted", "fill": PRUV, "edge": PRUV_E}),
        ("box", "2.2-2.4  vault.asset() / rwaFee().feeOnRaw() / previewDeposit()",
         {"sub": "resolve deposit asset, entry fee and expected shares", "fill": VAULT, "edge": VAULT_E}),
        ("box", "2.5  approve USDT -> vault",
         {"fill": VAULT, "edge": VAULT_E}),
        ("box", "2.6  vault.deposit(assets, receiver) -> KAI shares",
         {"sub": "vault contract IS the KAI token (1 USDT = 100 KAI)", "fill": VAULT, "edge": VAULT_E}),
        ("gap", 0.30),
        ("phase", "PHASE 3   Bridge RWA  Pruv -> Kaia   (RWA warp route)", {}),
        ("box", "3.1  approve KAI -> RWA warp route",
         {"sub": "amount = vault.balanceOf(sender)", "fill": PRUV, "edge": PRUV_E}),
        ("box", "3.2  quoteTransferRemote -> approve 0.1 USDC fee token",
         {"sub": "Pruv-side route charges a separate ERC20 fee", "fill": OPT, "edge": OPT_E}),
        ("box", "3.3  transferRemote(1001, recipient32, shares)",
         {"fill": PRUV, "edge": PRUV_E}),
        ("box", "3.4  wait for ReceivedTransferRemote on Kaia -> append output.md",
         {"fill": KAIA, "edge": KAIA_E, "arrow": "relayer"}),
    ],
    [("Kaia", KAIA, KAIA_E), ("Pruv", PRUV, PRUV_E), ("vault", VAULT, VAULT_E),
     ("fee / conditional", OPT, OPT_E)],
)

# ────────────────────────── scripts-redeem ──────────────────────────
render(
    f"{BASE}/scripts-redeem/flow.png",
    "scripts-redeem — RWA -> USDT redeem -> Kaia",
    "src/main.ts   |   3 phases, no CLI direction: always Kaia -> Pruv -> redeem -> Kaia",
    [
        ("phase", "PHASE 1   Bridge RWA  Kaia -> Pruv   (RWA warp route)", {}),
        ("box", "1.1  approve KAI -> RWA warp route",
         {"sub": "on Kaia the warp route IS the synthetic KAI token", "fill": KAIA, "edge": KAIA_E}),
        ("box", "1.2  quoteTransferRemote -> native gas only",
         {"sub": "Kaia-side route quotes no ERC20 fee", "fill": KAIA, "edge": KAIA_E}),
        ("box", "1.3  transferRemote(7336, recipient32, rwaAmount)",
         {"fill": KAIA, "edge": KAIA_E}),
        ("box", "1.4  wait for ReceivedTransferRemote on Pruv",
         {"sub": "abort flow on timeout", "fill": PRUV, "edge": PRUV_E, "arrow": "relayer"}),
        ("gap", 0.30),
        ("phase", "PHASE 2   Redeem RWA -> USDT via vault on Pruv", {}),
        ("box", "2.1  vault.asset() + vault.previewRedeem(shares)",
         {"sub": "expected USDT out (100 KAI = 1 USDT)", "fill": VAULT, "edge": VAULT_E}),
        ("box", "2.2  vault.redeem(shares, receiver, owner)",
         {"sub": "no approval needed - owner burns own shares", "fill": VAULT, "edge": VAULT_E}),
        ("gap", 0.30),
        ("phase", "PHASE 3   Bridge USDT  Pruv -> Kaia   (USDT warp route)", {}),
        ("box", "3.1  quoteTransferRemote -> approve 0.1 USDC fee token",
         {"sub": "separate ERC20 fee on the Pruv-side route", "fill": OPT, "edge": OPT_E}),
        ("box", "3.2  approve USDT -> USDT warp route (amount + fee)",
         {"fill": PRUV, "edge": PRUV_E}),
        ("box", "3.3  transferRemote(1001, recipient32, redeemedAssets)",
         {"fill": PRUV, "edge": PRUV_E}),
        ("box", "3.4  wait for ReceivedTransferRemote on Kaia -> append output.md",
         {"fill": KAIA, "edge": KAIA_E, "arrow": "relayer"}),
    ],
    [("Kaia", KAIA, KAIA_E), ("Pruv", PRUV, PRUV_E), ("vault", VAULT, VAULT_E),
     ("fee / conditional", OPT, OPT_E)],
)

# ─────────────────────────── scripts-rwa ────────────────────────────
render(
    f"{BASE}/scripts-rwa/flow.png",
    "scripts-rwa — single-hop RWA (KAI) bridge, optional vault steps",
    "src/main.ts   |   direction from --source-chain / --destination-chain   |   --mint (pruv->kaia)   --redeem (kaia->pruv)",
    [
        ("box", "Step 0  --mint only:  vault deposit on Pruv before bridging",
         {"sub": "whitelist -> convertToAssets(shares) + feeOnRaw -> approve USDT -> vault.deposit()",
          "fill": OPT, "edge": OPT_E}),
        ("box", "Step 1  quoteTransferRemote(dstDomain, recipient32, amount)",
         {"sub": "quotes[0]=native gas, quotes[1]=transfer token, quotes[2]=fee token",
          "fill": KAIA, "edge": KAIA_E}),
        ("box", "Pre-flight: native / transfer-token / fee-token balances",
         {"sub": "exits with a clear message instead of reverting on-chain", "fill": KAIA, "edge": KAIA_E}),
        ("box", "Step 2  approve transfer token -> warp route",
         {"fill": KAIA, "edge": KAIA_E}),
        ("box", "Step 3  approve fee token -> warp route  (if quoted)",
         {"sub": "0.1 USDC on Pruv-side routes; skipped on Kaia-side", "fill": OPT, "edge": OPT_E}),
        ("box", "Step 4  transferRemote(dstDomain, recipient32, amount) {value: gas}",
         {"fill": KAIA, "edge": KAIA_E}),
        ("box", "Step 5  poll destination for ReceivedTransferRemote",
         {"sub": "getLogs every 5s, 10 min timeout", "fill": PRUV, "edge": PRUV_E, "arrow": "relayer"}),
        ("box", "Step 6  --redeem only:  vault.redeem() on Pruv after delivery",
         {"sub": "whitelist -> previewRedeem -> redeem shares -> USDT", "fill": OPT, "edge": OPT_E}),
        ("box", "Append run details to output.md",
         {"fill": VAULT, "edge": VAULT_E}),
    ],
    [("source chain", KAIA, KAIA_E), ("destination chain", PRUV, PRUV_E),
     ("flag-gated", OPT, OPT_E), ("local artifact", VAULT, VAULT_E)],
)
