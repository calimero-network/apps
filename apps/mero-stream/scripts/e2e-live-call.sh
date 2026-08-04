#!/usr/bin/env bash
# scripts/e2e-live-call.sh — the whole two-node 480p call, start to finish, hands off.
#
# Chains what already existed into one command and adds the browser leg:
#
#   1. cargo mero build            (rc.19: ABI emit -> wasm32 -> wasm-opt -> embed)
#   2. dev-node.sh                 node1: init, CORS, auth, install app, namespace + context
#   3. dev-node2.sh                node2: init, auth, install app
#   4. dev-invite.sh               open invitation -> node2 joins namespace -> context
#   5. vite dev server             served on VITE_PORT
#   6. browser-call.mjs            two Chrome contexts, sender encodes, receiver decodes
#   7. teardown                    both nodes + vite (always, even on failure)
#
# Everything is torn down on exit unless --keep. Node homes are wiped at START by
# dev-node.sh, so a previous failed run never leaks into this one.
#
# Usage:
#   ./scripts/e2e-live-call.sh                  # full run, headed Chrome
#   ./scripts/e2e-live-call.sh --headless
#   ./scripts/e2e-live-call.sh --keep           # leave nodes + vite up afterwards
#   ./scripts/e2e-live-call.sh --seconds 60
#   ./scripts/e2e-live-call.sh --skip-build     # reuse logic/res/mero_stream.wasm
#   ./scripts/e2e-live-call.sh --prod           # test the PRODUCTION bundle (what Vercel serves)
#   ./scripts/e2e-live-call.sh --via-invite     # run the 4-scenario 2-node suite first, then
#                                              # stream on the ROOM it builds via an invitation
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

# NOT 5173. Every Calimero app's dev server defaults to it, so an automated run on
# 5173 fights whatever the developer already has up — and loses in the worst
# possible way. See the port-collision guard below for what that actually did.
VITE_PORT="${VITE_PORT:-5199}"
# 127.0.0.1, not `localhost`: localhost resolves to ::1 first on macOS, and a
# server bound only to IPv6 is a DIFFERENT server from the one we started. Pinning
# the family means the URL we health-check is the URL Chrome will open.
VITE_HOST="127.0.0.1"
VITE_URL="http://${VITE_HOST}:${VITE_PORT}"
VITE_LOG="/tmp/mero-stream-vite.log"
VITE_PID=""

KEEP=false
HEADLESS_ENV=""
SKIP_BUILD=false
PROD=false
VIA_INVITE=false
CALL_SECONDS="${CALL_SECONDS:-20}"

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=true; shift ;;
    --headless) HEADLESS_ENV="1"; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --prod) PROD=true; shift ;;
    --via-invite) VIA_INVITE=true; shift ;;
    --seconds) CALL_SECONDS="$2"; shift 2 ;;
    --help|-h) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
done

green() { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red() { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step() { printf '\n\033[1;35m══ %s\033[0m\n' "$*"; }

# ── Teardown ──────────────────────────────────────────────────────────────────
# One trap for every exit path. Without this a failed assertion leaves two merods
# and a vite holding ports 2660/2662/5173, and the next run fails for the wrong
# reason.
cleanup() {
  local code=$?
  if $KEEP; then
    step "Leaving the stack up (--keep)"
    yellow "nodes + vite still running; tear down with: make dev-stop"
    [ -n "$VITE_PID" ] && yellow "vite pid $VITE_PID (log: $VITE_LOG)"
    return $code
  fi
  step "Tearing down"
  if [ -n "$VITE_PID" ]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
    green "vite stopped"
  fi
  bash scripts/dev-node2.sh --clean >/dev/null 2>&1 || true
  bash scripts/dev-node.sh --clean >/dev/null 2>&1 || true
  green "nodes stopped and homes removed"
  return $code
}
trap cleanup EXIT

# ── Preflight ─────────────────────────────────────────────────────────────────
step "Preflight"
for cmd in merod jq curl python3 node pnpm cargo; do
  command -v "$cmd" >/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done
green "toolchain present"

merod --version | head -1

# Real Chrome is required: Playwright's bundled Chromium ships without
# proprietary codecs, so H.264 encode/decode is absent and the page would take
# its "no VideoEncoder" branch. This is a hard requirement, not a preference.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  green "$("$CHROME" --version)"
elif command -v google-chrome >/dev/null; then
  green "$(google-chrome --version)"
else
  red "Google Chrome not found — required for H.264 (bundled Chromium has none)"
  exit 1
fi

# Check the port HERE, before building anything or starting nodes. Finding the
# clash after a wasm build and two node inits wastes a minute and a half for a
# problem visible up front.
#
# THIS GUARD EXISTS BECAUSE OF A REAL FALSE PASS: with the old default of 5173,
# mero-meet's dev server already held [::1]:5173. Our vite exited with "Port 5173
# is already in use", but the readiness probe was a plain
# `curl http://localhost:5173`, `localhost` resolves to ::1 first on macOS, so it
# hit MERO-MEET, got a 200, and reported "ready". Chrome was then driven against a
# completely different application, and the run failed on a missing selector —
# which reads like an app bug and is nothing of the kind.
if lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  red "port $VITE_PORT is already in use:"
  lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN >&2
  yellow "stop that server, or re-run with VITE_PORT=<free port>"
  exit 1
fi
green "port $VITE_PORT is free"

[ -d app/node_modules ] || { step "Installing app deps"; (cd app && pnpm install); }
# The driver lives in app/e2e/ precisely so this resolves: node resolves a bare
# ESM import from the importing file's directory, not the cwd, and `playwright` is
# a devDep of the app package.
(cd app && node -e "require.resolve('playwright')" >/dev/null 2>&1) \
  || { red "playwright not resolvable from app/ — run: cd app && pnpm install"; exit 1; }
green "playwright available"

# ── 1. Build the contract ─────────────────────────────────────────────────────
if $SKIP_BUILD && [ -f logic/res/mero_stream.wasm ]; then
  yellow "skipping build, reusing logic/res/mero_stream.wasm"
else
  step "Building the contract with cargo mero (rc.19)"
  bash logic/build.sh
fi

# ── 2-4. Nodes, app install, namespace, invitation ────────────────────────────
# dev-node.sh rebuilds the wasm itself; harmless, and it keeps that script
# independently runnable.
step "Node 1: install app, create namespace + context"
VITE_URL="$VITE_URL" bash scripts/dev-node.sh

step "Node 2: install app"
bash scripts/dev-node2.sh

step "Invitation: node2 joins the namespace and the context"
VITE_URL="$VITE_URL" bash scripts/dev-invite.sh

# ── 5. Vite ───────────────────────────────────────────────────────────────────
step "Serving the frontend on :$VITE_PORT ($($PROD && echo 'production bundle' || echo 'dev server'))"

# Re-check: preflight ran minutes ago and something could have grabbed the port
# since. `--strictPort` makes vite itself refuse to slide to another port too.
if lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  red "port $VITE_PORT was taken since preflight:"
  lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN >&2
  exit 1
fi

# --prod serves the PRODUCTION BUNDLE (app/dist via `vite preview`) instead of the
# dev server. That distinction is load-bearing: the app's session gate is evaluated
# differently in a prod build, and it used to hard-disable the whole UI outside
# Tauri whenever `import.meta.env.DEV` was false. A suite that only ever exercises
# the dev server cannot catch that class of bug — it is exactly what would ship a
# dead page to Vercel while every local test stayed green. `vite preview` does SPA
# history fallback, matching the rewrite rule in vercel.json.
if $PROD; then
  step "Building the production frontend (what Vercel serves)"
  (cd app && pnpm build >/dev/null 2>&1) || { red "production build failed"; exit 1; }
  green "app/dist built"
  (cd app && exec pnpm exec vite preview --host "$VITE_HOST" --port "$VITE_PORT" --strictPort) >"$VITE_LOG" 2>&1 &
else
  (cd app && exec pnpm exec vite --host "$VITE_HOST" --port "$VITE_PORT" --strictPort) >"$VITE_LOG" 2>&1 &
fi
VITE_PID=$!

printf '  waiting for %s' "$VITE_URL"
READY=false
for _ in $(seq 1 60); do
  if curl -sf "$VITE_URL" >/dev/null 2>&1; then READY=true; printf '  ready\n'; break; fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    printf '\n'; red "vite exited early — log follows"; tail -20 "$VITE_LOG" >&2; exit 1
  fi
  printf '.'; sleep 1
done
$READY || { printf '\n'; red "vite never came up (log: $VITE_LOG)"; exit 1; }

# And prove it is OUR app answering, not merely SOMETHING. This is the check that
# would have caught the collision above regardless of port or address family.
SERVED_TITLE="$(curl -sf "$VITE_URL" | tr -d '\n' | sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p')"
if [ "$SERVED_TITLE" != "Mero Stream" ]; then
  red "port $VITE_PORT is served by '${SERVED_TITLE:-<no title>}', not 'Mero Stream'"
  yellow "something else is answering on that port — refusing to test the wrong app"
  exit 1
fi
green "vite up, serving '$SERVED_TITLE' (pid $VITE_PID, log: $VITE_LOG)"

# ── 6. The browser call ───────────────────────────────────────────────────────
URLS_FILE=/tmp/mero-stream-dev-urls.txt
if $VIA_INVITE; then
  step "Two-node suite: namespace -> invitation -> join -> room -> context"
  # Proves how a SECOND PERSON actually gets in, which the browser test never
  # covered: dev-invite.sh did all of it with curl before Chrome ever opened. On
  # success it emits /live URLs for the room it just built, so the stream below runs
  # on a context created THROUGH the invite path rather than one pre-baked by a script.
  (cd app && VITE_URL="$VITE_URL" node e2e/two-node-suite.mjs --emit-urls /tmp/mero-stream-room-urls.txt) \
    || { red "two-node suite failed"; exit 1; }
  URLS_FILE=/tmp/mero-stream-room-urls.txt
  green "streaming on the invite-built room"
fi

step "Driving the call in Chrome"
# `set -e` would abort before the report below, and we want the failure summary
# and the artifact hint either way.
CALL_CODE=0
(
  cd app
  HEADLESS="$HEADLESS_ENV" CALL_SECONDS="$CALL_SECONDS" \
    node e2e/browser-call.mjs --urls "$URLS_FILE"
) || CALL_CODE=$?

if [ $CALL_CODE -eq 0 ]; then
  step "PASS"
  green "two-node 480p H.264 call verified end to end"
else
  step "FAIL"
  red "see data/browser-call/ for screenshots, console logs and result.json"
fi
exit $CALL_CODE
