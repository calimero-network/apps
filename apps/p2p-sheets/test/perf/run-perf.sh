#!/usr/bin/env bash
# Build the bundle if missing, then run the financial perf workflow.
# Env: PERF_SMOKE=1 collapses the size sweep to a tiny smoke size.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MPK="logic/res/p2p-sheets-1.0.0.mpk"
if [ ! -f "$MPK" ]; then
  echo "Bundle missing — building..."
  bash logic/build-bundle.sh
fi

echo "Running financial perf workflow (PERF_SMOKE=${PERF_SMOKE:-0})..."
PERF_SMOKE="${PERF_SMOKE:-0}" merobox bootstrap run test/perf/workflow-perf-financial.yml
