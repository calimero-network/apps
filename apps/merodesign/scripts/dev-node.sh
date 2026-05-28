#!/usr/bin/env bash
# scripts/dev-node.sh — Start a single local merod node for MeroDesign development.
#
# Usage:
#   ./scripts/dev-node.sh           # start node, install app, print login info
#   ./scripts/dev-node.sh --stop    # stop the node
#   ./scripts/dev-node.sh --clean   # --stop + delete node home directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="merodesign-dev"
NODE_HOME="${MERODESIGN_DEV_NODE_HOME:-$HOME/.calimero/merodesign-dev}"
NODE_PORT="${MERODESIGN_DEV_PORT:-2430}"
NODE_P2P_PORT="${MERODESIGN_DEV_P2P_PORT:-2530}"
NODE_URL="http://localhost:${NODE_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/merodesign.wasm"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }

wait_for_node() {
  printf "  Waiting for node"
  for _ in $(seq 1 60); do
    if node_is_running; then printf '  ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'; red "Node did not become healthy after 60s"; exit 1
}

pid_file() { echo "/tmp/merodesign-dev-node.pid"; }

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)  STOP=true ;;
    --clean) STOP=true; CLEAN=true ;;
  esac
done

nuke_node() {
  pf=$(pid_file)
  if [ -f "$pf" ]; then
    pid=$(cat "$pf")
    kill "$pid" 2>/dev/null && yellow "Stopped node (pid $pid)" || yellow "Process $pid already gone"
    rm -f "$pf"
  fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  rm -rf "$NODE_HOME"
}

if $STOP; then
  step "Stopping dev node"
  nuke_node
  green "Done"
  exit 0
fi

for cmd in merod jq curl; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

step "Nuking existing node"
nuke_node
green "Clean slate ready"

step "Building WASM"
(cd "$REPO_ROOT/logic" && bash build.sh)
green "merodesign.wasm built"

step "Initialising node at $NODE_HOME"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded
green "Node initialised"

CONFIG_FILE="$NODE_HOME/${NODE_NAME}/config.toml"
if [ -f "$CONFIG_FILE" ]; then
  python3 - "$CONFIG_FILE" <<'PYEOF'
import sys, re
path = sys.argv[1]
txt  = open(path).read()
txt  = re.sub(r'allow_all_origins\s*=\s*false', 'allow_all_origins = true', txt)
open(path, 'w').write(txt)
PYEOF
  green "CORS patched"
fi

step "Starting node"
merod --node "$NODE_NAME" --home "$NODE_HOME" run \
  > "/tmp/merodesign-dev-node.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node started (pid $!  logs: /tmp/merodesign-dev-node.log)"
wait_for_node

step "Authenticating"
AUTH_RES=$(curl -sf -X POST "${NODE_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --arg u "$ADMIN_USER" \
        --arg p "$ADMIN_PASS" \
        '{auth_method:"user_password",public_key:$u,client_name:"dev-node.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')")
ACCESS_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.access_token // empty')
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed"; exit 1; }
green "Authenticated"

step "Installing MeroDesign app"
APP_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/install-dev-application" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
  2>/dev/null) || APP_RES="{}"
APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty' 2>/dev/null || true)
[ -n "$APP_ID" ] || { red "Could not install app"; exit 1; }
green "App installed ($APP_ID)"

ENV_FILE="$REPO_ROOT/app/.env.integration"
{
  printf 'E2E_NODE_URL=%s\n'       "$NODE_URL"
  printf 'E2E_ACCESS_TOKEN=%s\n'  "$ACCESS_TOKEN"
  printf 'E2E_REFRESH_TOKEN=%s\n' "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')"
  printf 'VITE_APPLICATION_ID=%s\n' "$APP_ID"
} > "$ENV_FILE"
green "Wrote $ENV_FILE"

printf '\n\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Dev node ready\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n\n'
printf '  Node URL:   \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Username:   \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:   \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  Logs:       /tmp/merodesign-dev-node.log\n\n'
printf '  Next:  \033[36mmake dev\033[0m  →  http://localhost:5173\n\n'
