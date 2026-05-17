#!/usr/bin/env bash
# scripts/ci.sh — Run the full RPC test suite against two live merod nodes.
#
# Usage:
#   ./scripts/ci.sh                    # start nodes, run all RPC tests, stop nodes
#   ./scripts/ci.sh --no-build         # skip logic-build (WASM already built)
#   ./scripts/ci.sh --keep-nodes       # leave nodes running after tests
#   ./scripts/ci.sh --help
#
# The script:
#   1. Optionally builds logic/res/curb.wasm
#   2. Starts two merod nodes via setup-nodes.sh (writes .env.integration)
#   3. Runs: pnpm exec playwright test --project=rpc-logic --project=rpc-admin
#   4. Always stops nodes on exit (success or failure)
#
# Exit code mirrors playwright's exit code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/app"

# ── Colours ───────────────────────────────────────────────────────────────────

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

# ── Args ──────────────────────────────────────────────────────────────────────

BUILD=true
KEEP_NODES=false

for arg in "$@"; do
  case "$arg" in
    --no-build)    BUILD=false ;;
    --keep-nodes)  KEEP_NODES=true ;;
    --help|-h)
      sed -n '3,12p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
  esac
done

# ── Cleanup trap ──────────────────────────────────────────────────────────────

cleanup() {
  local code=$?
  if ! $KEEP_NODES; then
    step "Stopping nodes"
    bash "$SCRIPT_DIR/setup-nodes.sh" --stop 2>/dev/null || true
    green "Nodes stopped"
  else
    yellow "Nodes left running (--keep-nodes). Stop with: ./scripts/setup-nodes.sh --stop"
  fi
  exit $code
}
trap cleanup EXIT

# ── 1. Build WASM ─────────────────────────────────────────────────────────────

if $BUILD; then
  step "Building WASM"
  (cd "$REPO_ROOT/logic" && bash build.sh)
  green "WASM built"
else
  yellow "Skipping WASM build (--no-build)"
fi

# ── 2. Start nodes ────────────────────────────────────────────────────────────

step "Starting two merod nodes"
bash "$SCRIPT_DIR/setup-nodes.sh"
green "Nodes ready"

# ── 3. Install frontend deps (idempotent) ─────────────────────────────────────

step "Ensuring frontend dependencies"
(cd "$APP_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
green "Dependencies ready"

# ── 4. Run all tests (Playwright starts Vite for mocked; rpc/rpc-admin headless) ─

step "Running RPC + admin + mocked tests"
cd "$APP_DIR"

pnpm exec playwright test \
  --project=rpc \
  --project=rpc-admin \
  --project=mocked \
  "${PLAYWRIGHT_EXTRA_ARGS[@]:-}"

# Exit code from playwright propagates via the trap.
