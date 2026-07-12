#!/usr/bin/env bash
# Build the bundle if missing, then run one or all perf workflows.
# Usage: run-perf.sh [financial|amortization|all]   (default: all)
# Env:   PERF_SMOKE=1 collapses each sweep to a tiny smoke size.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SCENARIO="${1:-all}"

MPK="logic/res/p2p-sheets-1.0.0.mpk"
if [ ! -f "$MPK" ]; then
  echo "Bundle missing — building..."
  bash logic/build-bundle.sh
fi

run_one() {
  local wf="$1"
  echo "Running $wf (PERF_SMOKE=${PERF_SMOKE:-0})..."
  PERF_SMOKE="${PERF_SMOKE:-0}" merobox bootstrap run "test/perf/$wf"
}

case "$SCENARIO" in
  financial)   run_one workflow-perf-financial.yml ;;
  amortization) run_one workflow-perf-amortization.yml ;;
  all)         run_one workflow-perf-financial.yml; run_one workflow-perf-amortization.yml ;;
  *) echo "unknown scenario: $SCENARIO (want financial|amortization|all)" >&2; exit 2 ;;
esac
