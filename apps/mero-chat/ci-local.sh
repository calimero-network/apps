#!/usr/bin/env bash
# ci-local.sh — run the same checks GitHub frontend-ci.yml runs, in order.
#
# Each step prints its own header. The script exits on the first failure
# (set -e) so you see the real error, not a cascade. Final summary tells
# you exactly which step failed if any.
#
# Usage:  bash ci-local.sh
#         (run from anywhere; script cds to its own dir)

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$REPO_ROOT/app"
LOGIC_DIR="$REPO_ROOT/logic"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

step() {
  echo
  bold "━━━ $1 ━━━"
}

trap 'red "✗ FAILED at: $CURRENT_STEP"; exit 1' ERR

# ── 1. Logic crate (Rust → WASM) ────────────────────────────────────────────
CURRENT_STEP="logic build (cargo → wasm32)"
step "$CURRENT_STEP"
cd "$LOGIC_DIR"
bash build.sh
green "✓ logic/res/curb.wasm built"

# ── 2. Frontend deps ────────────────────────────────────────────────────────
CURRENT_STEP="pnpm install --frozen-lockfile"
step "$CURRENT_STEP"
cd "$APP_DIR"
pnpm install --frozen-lockfile
green "✓ deps installed"

# ── 3. Typecheck ────────────────────────────────────────────────────────────
CURRENT_STEP="pnpm exec tsc --noEmit"
step "$CURRENT_STEP"
pnpm exec tsc --noEmit
green "✓ tsc clean"

# ── 4. Lint ─────────────────────────────────────────────────────────────────
CURRENT_STEP="pnpm lint"
step "$CURRENT_STEP"
pnpm lint
green "✓ lint clean"

# ── 5. Unit tests ───────────────────────────────────────────────────────────
CURRENT_STEP="pnpm test (vitest)"
step "$CURRENT_STEP"
pnpm test
green "✓ unit tests passed"

# ── 6. Playwright (mocked project — no live node needed) ────────────────────
CURRENT_STEP="pnpm e2e --project=mocked"
step "$CURRENT_STEP"
# Make sure the mocked browser is installed. Skips if already present.
pnpm exec playwright install chromium >/dev/null 2>&1 || true
pnpm e2e
green "✓ playwright (mocked) passed"

# ── Done ────────────────────────────────────────────────────────────────────
echo
green "════════════════════════════════════════════════"
green "  ALL CI CHECKS PASSED"
green "════════════════════════════════════════════════"
echo
yellow "Note: integration / live / rpc / rpc-admin Playwright"
yellow "projects are NOT run here — they need a live merod"
yellow "node via scripts/setup-nodes.sh --restart."
