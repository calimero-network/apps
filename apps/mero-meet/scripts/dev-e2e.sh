#!/usr/bin/env bash
# scripts/dev-e2e.sh — automated two-peer call test against the local dev stack.
#
# The hands-off twin of dev-call.sh: instead of opening two Chrome windows for
# you to click around in, it drives both peers headlessly (Playwright, fake
# cameras) and ASSERTS the whole lifecycle: join → media flows both ways →
# leave → rejoin (both directions) → everyone leaves → the call dies.
#
# Prereqs:
#   make dev-nodes     # node1 + node2 + room (once)
#   make dev           # vite dev server (separate terminal)
# Then:
#   make dev-e2e       # ← this script
#
# Vite on a non-default port: DEV_VITE_PORT=5183 make dev-e2e

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VITE_HOST="${DEV_VITE_HOST:-http://localhost}"
VITE_PORT="${DEV_VITE_PORT:-5173}"
BASE="${VITE_HOST}:${VITE_PORT}"

red()  { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step() { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

# Vite must be serving the app.
if ! curl -sf -o /dev/null --max-time 3 "$BASE"; then
  red "nothing serving at $BASE — run 'make dev' first (or set DEV_VITE_PORT)"
  exit 1
fi

# Reuse dev-call.sh's URL construction (it validates .env.dev-call itself).
step "Resolving peer URLs"
URLS="$(DEV_VITE_HOST="$VITE_HOST" DEV_VITE_PORT="$VITE_PORT" bash "$SCRIPT_DIR/dev-call.sh" --print)"
URL_A="$(printf '%s\n' "$URLS" | grep -o "${BASE}/#[^ ]*" | sed -n 1p)"
URL_B="$(printf '%s\n' "$URLS" | grep -o "${BASE}/#[^ ]*" | sed -n 2p)"
[ -n "$URL_A" ] && [ -n "$URL_B" ] || { red "could not resolve peer URLs — did dev-nodes complete?"; exit 1; }

# Playwright's chromium (no-op when already cached).
step "Ensuring Playwright chromium"
(cd "$REPO_ROOT/app" && pnpm exec playwright install chromium >/dev/null)

OUT_DIR="${OUT_DIR:-/tmp/meet-dev-e2e}"
step "Running the two-peer call lifecycle (artifacts → $OUT_DIR)"
cd "$REPO_ROOT/app"
URL_A="$URL_A" URL_B="$URL_B" OUT_DIR="$OUT_DIR" node scripts/call-e2e.mjs
