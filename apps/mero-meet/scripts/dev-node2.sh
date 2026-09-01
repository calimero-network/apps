#!/usr/bin/env bash
# scripts/dev-node2.sh — Start local merod NODE 2 (the second call peer).
#
# Runs a second node, bootstraps it directly to node1 (mDNS is unreliable with
# two merods on one host), installs Mero Meet, and appends its URL/tokens to
# app/.env.dev-call. Does NOT join the room yet — dev-invite.sh does that.
#
# Usage:
#   ./scripts/dev-node2.sh           # start node2
#   ./scripts/dev-node2.sh --stop    # stop node2
#   ./scripts/dev-node2.sh --clean   # --stop + delete node home

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="meet-dev-2"
NODE_HOME="${MEET_DEV_NODE2_HOME:-$HOME/.calimero/meet-dev-2}"
NODE_PORT="${MEET_DEV_PORT2:-2670}"
NODE_P2P_PORT="${MEET_DEV_P2P_PORT2:-2671}"
NODE_URL="http://localhost:${NODE_PORT}"

NODE1_P2P_PORT="${MEET_DEV_P2P_PORT:-2661}"
NODE1_LOG="/tmp/meet-dev-node.log"

ADMIN_USER="${MEET_ADMIN_USER:-admin}"
ADMIN_PASS="${MEET_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/mero_meet.wasm"
ENV_FILE="$REPO_ROOT/app/.env.dev-call"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }

wait_for_node() {
  printf "  Waiting for node2"
  for _ in $(seq 1 60); do
    if node_is_running; then printf '  ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'; red "Node2 did not become healthy after 60s"; exit 1
}

pid_file() { echo "/tmp/meet-dev-node2.pid"; }

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)  STOP=true ;;
    --clean) STOP=true; CLEAN=true ;;
    --help|-h) sed -n '3,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
  esac
done

nuke_node() {
  pf=$(pid_file)
  if [ -f "$pf" ]; then kill "$(cat "$pf")" 2>/dev/null || true; rm -f "$pf"; fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
}

if $STOP; then
  step "Stopping node2"
  nuke_node
  $CLEAN && { rm -rf "$NODE_HOME"; yellow "Removed $NODE_HOME"; }
  green "Done"
  exit 0
fi

for cmd in merod jq curl python3; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

step "Nuking existing node2 (clean slate)"
nuke_node
rm -rf "$NODE_HOME"
green "Clean slate ready"

[ -f "$WASM_PATH" ] || { red "WASM not found at $WASM_PATH — run ./scripts/dev-node.sh first"; exit 1; }

step "Initialising node2 at $NODE_HOME"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded
green "Node2 initialised"

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

# ── Bootstrap directly to node1 (skip flaky mDNS) ─────────────────────────────
step "Wiring node2 → node1 bootstrap"
NODE1_PEER_ID=""
if [ -f "$NODE1_LOG" ]; then
  for _ in $(seq 1 10); do
    NODE1_PEER_ID=$(grep -m1 "Listening on: /ip4/127.0.0.1/tcp/${NODE1_P2P_PORT}/p2p/" "$NODE1_LOG" 2>/dev/null \
      | grep -oE '12D3KooW[A-Za-z0-9]+' | head -1 || true)
    [ -n "$NODE1_PEER_ID" ] && break
    sleep 1
  done
fi
if [ -n "$NODE1_PEER_ID" ]; then
  python3 - "$CONFIG_FILE" "$NODE1_P2P_PORT" "$NODE1_PEER_ID" <<'PYEOF'
import sys, re
cfg_path, p2p_port, peer_id = sys.argv[1], sys.argv[2], sys.argv[3]
txt = open(cfg_path).read()
for addr in [f'/ip4/127.0.0.1/tcp/{p2p_port}/p2p/{peer_id}',
             f'/ip4/127.0.0.1/udp/{p2p_port}/quic-v1/p2p/{peer_id}']:
    if addr in txt:
        continue
    txt = re.sub(r'(\[bootstrap\]\s*\nnodes\s*=\s*\[)',
                 lambda m, a=addr: m.group(1) + f'\n    "{a}",', txt, count=1)
open(cfg_path, 'w').write(txt)
PYEOF
  green "Bootstrap injected: node1 ($NODE1_PEER_ID) @ 127.0.0.1:${NODE1_P2P_PORT}"
else
  yellow "Could not read node1 peer-id from $NODE1_LOG — will rely on mDNS (may flake)"
fi

step "Starting node2"
merod --node "$NODE_NAME" --home "$NODE_HOME" run > "/tmp/meet-dev-node2.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node2 started (pid $!  logs: /tmp/meet-dev-node2.log)"
wait_for_node

step "Authenticating"
AUTH_RES=$(curl -sf -X POST "${NODE_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" \
        '{auth_method:"user_password",public_key:$u,client_name:"dev-node2.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')" \
  2>/dev/null) || AUTH_RES="{}"
ACCESS_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.access_token // empty')
REFRESH_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed for node2"; echo "$AUTH_RES" >&2; exit 1; }
green "Authenticated as '${ADMIN_USER}'"

step "Installing Mero Meet app on node2"
APP_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/install-dev-application" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
  2>/dev/null) || APP_RES="{}"
APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty')
if [ -z "$APP_ID" ]; then
  APP_ID=$(curl -sf "${NODE_URL}/admin-api/applications" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
    | jq -r '.data.apps[0].id // .data.applications[0].id // empty')
fi
[ -n "$APP_ID" ] || { red "Could not get APP_ID on node2"; exit 1; }
green "App installed on node2 (id: $APP_ID)"

# ── Append node2 details to env ───────────────────────────────────────────────
[ -f "$ENV_FILE" ] || { red "$ENV_FILE missing — run ./scripts/dev-node.sh first"; exit 1; }
sed -i.bak \
  -e "s|^DEV_NODE_URL_2=.*|DEV_NODE_URL_2=${NODE_URL}|" \
  -e "s|^DEV_ACCESS_TOKEN_2=.*|DEV_ACCESS_TOKEN_2=${ACCESS_TOKEN}|" \
  -e "s|^DEV_REFRESH_TOKEN_2=.*|DEV_REFRESH_TOKEN_2=${REFRESH_TOKEN}|" \
  -e "s|^DEV_APP_ID_2=.*|DEV_APP_ID_2=${APP_ID}|" \
  "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
green "Updated $ENV_FILE with node2 details"

printf '\n\033[1;32m  Node2 ready.\033[0m  Next: \033[36m./scripts/dev-invite.sh\033[0m\n\n'
