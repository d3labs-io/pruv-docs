#!/usr/bin/env bash
#
# Run every bridge example flow end-to-end against the testnets and print a
# PASS/FAIL summary.
#
#   ./tools/run-all-flows.sh                  # all 8 flows
#   ./tools/run-all-flows.sh usdt-k2p mint    # only the named flows
#   ./tools/run-all-flows.sh --list           # show flow names
#   USDT_AMOUNT=0.05 RWA_AMOUNT=1 ./tools/run-all-flows.sh
#
# Each flow needs a funded, whitelisted wallet — see README "Setup". PRIVATE_KEY
# is read from each package's own .env by the scripts themselves; this runner
# never touches it.
#
# Env knobs:
#   USDT_AMOUNT   amount for USDT bridges and the mint flow   (default 0.01 / 0.4)
#   RWA_AMOUNT    amount for RWA bridges and the redeem flow  (default 0.4)
#   LOG_DIR       where per-flow logs land                    (default ./.run-logs)
#   FLOW_TIMEOUT  seconds before a hung flow is killed        (default 900)
#   PREAPPROVE=1  top up Pruv-side allowances before running (see note below)
#
# Note on hangs: the Pruv testnet demo key is shared. If another sender takes
# your nonce, a submitted approve silently leaves the mempool and ethers'
# tx.wait() blocks forever. FLOW_TIMEOUT kills such a run, and PREAPPROVE=1
# sets generous allowances up front so the flows skip approving entirely.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT/.run-logs}"
USDT_AMOUNT="${USDT_AMOUNT:-0.01}"
MINT_AMOUNT="${MINT_AMOUNT:-0.4}"
RWA_AMOUNT="${RWA_AMOUNT:-0.4}"
FLOW_TIMEOUT="${FLOW_TIMEOUT:-900}"

# name|package|success marker|args...
FLOWS=(
  "usdt-k2p|scripts-usdt|Bridge complete|--source-chain kaia --destination-chain pruv --token-amount $USDT_AMOUNT"
  "usdt-p2k|scripts-usdt|Bridge complete|--source-chain pruv --destination-chain kaia --token-amount $USDT_AMOUNT"
  "mint|scripts-mint|MINT FLOW COMPLETE|--token-amount $MINT_AMOUNT"
  "redeem|scripts-redeem|REDEEM FLOW COMPLETE|--token-amount $RWA_AMOUNT"
  "rwa-k2p|scripts-rwa|Message delivered|--source-chain kaia --destination-chain pruv --token-amount $RWA_AMOUNT"
  "rwa-p2k|scripts-rwa|Message delivered|--source-chain pruv --destination-chain kaia --token-amount $RWA_AMOUNT"
  "rwa-mint|scripts-rwa|Message delivered|--source-chain pruv --destination-chain kaia --token-amount $RWA_AMOUNT --mint"
  "rwa-redeem|scripts-rwa|Redeemed|--source-chain kaia --destination-chain pruv --token-amount $RWA_AMOUNT --redeem"
)

if [ "${1:-}" = "--list" ]; then
  for f in "${FLOWS[@]}"; do
    IFS='|' read -r name pkg _ args <<<"$f"
    printf '  %-12s %-16s %s\n' "$name" "$pkg" "$args"
  done
  exit 0
fi

# Optional flow filter from positional args.
WANTED=("$@")
wanted() {
  [ ${#WANTED[@]} -eq 0 ] && return 0
  local w
  for w in "${WANTED[@]}"; do [ "$w" = "$1" ] && return 0; done
  return 1
}

mkdir -p "$LOG_DIR"

if [ "${PREAPPROVE:-0}" = "1" ]; then
  echo "==> Topping up Pruv-side allowances"
  (cd "$ROOT/scripts-mint" && NODE_PATH="$PWD/node_modules" npx tsx "$ROOT/tools/preapprove-pruv.ts") \
    || echo "    (pre-approve reported problems — continuing anyway)"
fi

# Run one flow with a wall-clock limit (macOS has no coreutils `timeout`).
# Sets FLOW_CODE to the exit status, or 124 if the limit was hit.
FLOW_CODE=0
run_flow() {
  local pkg=$1 log=$2; shift 2
  ( cd "$ROOT/$pkg" && exec npx tsx src/main.ts "$@" ) >"$log" 2>&1 &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$FLOW_TIMEOUT" ]; then
      pkill -P "$pid" 2>/dev/null
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      FLOW_CODE=124
      return
    fi
    sleep 5
    waited=$((waited + 5))
  done
  wait "$pid"
  FLOW_CODE=$?
}

RESULTS=()
FAILED=0

for f in "${FLOWS[@]}"; do
  IFS='|' read -r name pkg marker args <<<"$f"
  wanted "$name" || continue

  log="$LOG_DIR/$name.log"
  echo "==> $name  ($pkg $args)"
  start=$(date +%s)

  run_flow "$pkg" "$log" $args   # $args intentionally unquoted: split into flags
  code=$FLOW_CODE

  elapsed=$(( $(date +%s) - start ))

  if [ $code -eq 124 ]; then
    status="TIMEOUT"
  elif [ $code -ne 0 ]; then
    status="FAIL(exit $code)"
  elif grep -q "$marker" "$log"; then
    status="PASS"
  else
    status="FAIL(no marker)"
  fi

  [ "$status" = "PASS" ] || FAILED=1
  RESULTS+=("$(printf '%-12s %-16s %4ds  %s' "$name" "$status" "$elapsed" "$log")")
  echo "    $status in ${elapsed}s"
done

echo
echo "──────────────────────────────────────────────────────────────"
printf '%-12s %-16s %5s  %s\n' FLOW STATUS TIME LOG
echo "──────────────────────────────────────────────────────────────"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "──────────────────────────────────────────────────────────────"

exit $FAILED
