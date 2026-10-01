#!/usr/bin/env bash
# scripts/integration-test.sh — shell-based integration driver.
#
# Complements merobox: where merobox's `assert` step types and generic
# error wrappers can't cleanly express what we need (negative HTTP-status
# checks, fine-grained error.message inspection, retries with backoff),
# this driver does direct curl + meroctl + jq against a live 2-node setup
# and prints a single PASS/FAIL line per assertion.
#
# Setup expectation: 2 merod nodes already running (start with
# `make ci-no-build` or `bash scripts/setup-nodes.sh`). The driver
# reads `app/.env.integration` for tokens + IDs.
#
# Usage:
#   bash scripts/integration-test.sh                # run all cases
#   bash scripts/integration-test.sh case-name      # run one case
#
# Each `cases/*.sh` file is a standalone scenario that sources lib.sh
# and calls assert_* helpers.

set -u  # don't set -e — we want every case to run even if one fails

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB="$SCRIPT_DIR/integration/lib.sh"
CASES_DIR="$SCRIPT_DIR/integration/cases"
ENV_FILE="$REPO_ROOT/app/.env.integration"

# shellcheck disable=SC1090
. "$LIB"

# ── Pre-flight ────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  red "$ENV_FILE not found — run setup-nodes.sh first"
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

NODE_1_URL="${E2E_NODE_URL:-http://localhost:2428}"
NODE_2_URL="${E2E_NODE_URL_2:-http://localhost:2429}"

step "Checking node health"
wait_for_node_ready "$NODE_1_URL" || exit 1
wait_for_node_ready "$NODE_2_URL" || exit 1
green "Both nodes healthy"

step "Authenticating against both nodes"
auth_node "$NODE_1_URL" N1 || { red "node-1 auth failed"; exit 1; }
auth_node "$NODE_2_URL" N2 || { red "node-2 auth failed"; exit 1; }
green "Authenticated"

# Make these visible to cases.
export NODE_1_URL NODE_2_URL AUTH_TOKEN_N1 AUTH_TOKEN_N2

# ── Run cases ─────────────────────────────────────────────────────────────

ALL_PASS=0
ALL_FAIL=0
ANY_RAN=0

run_case() {
  local case_file="$1"
  local case_name; case_name=$(basename "$case_file" .sh)
  step "Case: $case_name"
  ASSERT_PASS=0
  ASSERT_FAIL=0
  # shellcheck disable=SC1090
  . "$case_file"
  ANY_RAN=$((ANY_RAN+1))
  ALL_PASS=$((ALL_PASS+ASSERT_PASS))
  ALL_FAIL=$((ALL_FAIL+ASSERT_FAIL))
  if [ "$ASSERT_FAIL" -eq 0 ]; then
    green "$case_name: $ASSERT_PASS/$ASSERT_PASS green"
  else
    red "$case_name: $ASSERT_FAIL failed (of $((ASSERT_PASS+ASSERT_FAIL)))"
  fi
}

if [ "$#" -ge 1 ]; then
  # Single named case
  case_file="$CASES_DIR/$1.sh"
  if [ ! -f "$case_file" ]; then
    red "case '$1' not found at $case_file"
    exit 2
  fi
  run_case "$case_file"
else
  # All cases, alphabetical
  for case_file in "$CASES_DIR"/*.sh; do
    [ -f "$case_file" ] || continue
    run_case "$case_file"
  done
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo
if [ "$ANY_RAN" -eq 0 ]; then
  red "No cases ran."
  exit 2
fi

if [ "$ALL_FAIL" -eq 0 ]; then
  green "ALL CASES PASSED ($ALL_PASS assertions)"
  exit 0
else
  red "TOTAL: $ALL_FAIL failed, $ALL_PASS passed"
  exit 1
fi
