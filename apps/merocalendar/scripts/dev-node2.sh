#!/usr/bin/env bash
# scripts/dev-node2.sh — Start a second local merod node for Mero Calendar development.
#
# Usage:
#   ./scripts/dev-node2.sh           # start node2, install app
#   ./scripts/dev-node2.sh --stop    # stop node2
#   ./scripts/dev-node2.sh --clean   # --stop + delete node2 home directory
#   ./scripts/dev-node2.sh --help
#
# Node2 has no workspace. Invite it via:
#   ./scripts/dev-invite.sh
# or from the webapp: log in to node1, invite node2's peer into the workspace.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="merocalendar-dev-2"
NODE_HOME="${MEROCALENDAR_DEV_NODE2_HOME:-$HOME/.calimero/merocalendar-dev-2}"
NODE_PORT="${MEROCALENDAR_DEV_PORT2:-2471}"
NODE_P2P_PORT="${MEROCALENDAR_DEV_P2P_PORT2:-2571}"
NODE_URL="http://localhost:${NODE_PORT}"

NODE1_P2P_PORT="${MEROCALENDAR_DEV_P2P_PORT:-2570}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/merocalendar.wasm"

# ── Helpers ───────────────────────────────────────────────────────────────────

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

pid_file() { echo "/tmp/merocalendar-dev-node2.pid"; }

# ── Parse args ────────────────────────────────────────────────────────────────

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)   STOP=true ;;
    --clean)  STOP=true; CLEAN=true ;;
    --help|-h)
      sed -n '3,11p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
  esac
done

# ── Stop / Clean ──────────────────────────────────────────────────────────────

nuke_node() {
  pf=$(pid_file)
  if [ -f "$pf" ]; then
    pid=$(cat "$pf")
    kill "$pid" 2>/dev/null && yellow "Stopped node2 (pid $pid)" || yellow "Process $pid already gone"
    rm -f "$pf"
  fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  rm -rf "$NODE_HOME"
  yellow "Removed $NODE_HOME"
}

if $STOP; then
  step "Stopping node2"
  pf=$(pid_file)
  if [ -f "$pf" ]; then
    pid=$(cat "$pf")
    kill "$pid" 2>/dev/null && yellow "Stopped node2 (pid $pid)" || yellow "Process $pid already gone"
    rm -f "$pf"
  fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  if $CLEAN; then
    rm -rf "$NODE_HOME"
    yellow "Removed $NODE_HOME"
  fi
  green "Done"
  exit 0
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────

for cmd in merod jq curl; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

[ -f "$WASM_PATH" ] || { red "merocalendar.wasm not found — run 'make dev-node' first"; exit 1; }

# ── Nuke existing node2 ───────────────────────────────────────────────────────

step "Nuking existing node2 (clean slate)"
nuke_node
green "Clean slate ready"

# ── Init node2 ────────────────────────────────────────────────────────────────

step "Initialising node2 at $NODE_HOME"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded
green "Node2 initialised"

# ── Bootstrap directly to node1 ───────────────────────────────────────────────
# Two merods on the same host race over UDP/5353 (mDNS), so mDNS discovery is
# unreliable. Skip it by injecting node1's loopback multiaddr with peer ID.

NODE1_LOG="/tmp/merocalendar-dev-node.log"
NODE1_PEER_ID=""
if [ -f "$NODE1_LOG" ]; then
  for _ in $(seq 1 10); do
    NODE1_PEER_ID=$(grep -m1 "Listening on: /ip4/127.0.0.1/tcp/${NODE1_P2P_PORT}/p2p/" "$NODE1_LOG" 2>/dev/null \
      | grep -oE '12D3KooW[A-Za-z0-9]+' | head -1 || true)
    [ -n "$NODE1_PEER_ID" ] && break
    sleep 1
  done
fi

CFG_FILE="$NODE_HOME/${NODE_NAME}/config.toml"
if [ -n "$NODE1_PEER_ID" ]; then
  python3 - "$CFG_FILE" "$NODE1_P2P_PORT" "$NODE1_PEER_ID" <<'PYEOF'
import sys, re
cfg_path, p2p_port, peer_id = sys.argv[1], sys.argv[2], sys.argv[3]
txt = open(cfg_path).read()
new_entries = [
    f'/ip4/127.0.0.1/tcp/{p2p_port}/p2p/{peer_id}',
    f'/ip4/127.0.0.1/udp/{p2p_port}/quic-v1/p2p/{peer_id}',
]
for addr in new_entries:
    if addr in txt:
        continue
    txt = re.sub(
        r'(\[bootstrap\]\s*\nnodes\s*=\s*\[)',
        lambda m, a=addr: m.group(1) + f'\n    "{a}",',
        txt, count=1,
    )
open(cfg_path, 'w').write(txt)
PYEOF
  green "Bootstrap injected: node1 ($NODE1_PEER_ID) at 127.0.0.1:${NODE1_P2P_PORT}"
else
  yellow "Could not read node1 peer-id from $NODE1_LOG — will rely on mDNS/rendezvous (may be slow)"
fi

# ── Patch CORS ────────────────────────────────────────────────────────────────

if [ -f "$CFG_FILE" ]; then
  python3 - "$CFG_FILE" <<'PYEOF'
import sys, re
path = sys.argv[1]
txt  = open(path).read()
txt  = re.sub(r'allow_all_origins\s*=\s*false', 'allow_all_origins = true', txt)
open(path, 'w').write(txt)
PYEOF
  green "CORS patched"
fi

# ── Start node2 ───────────────────────────────────────────────────────────────

step "Starting node2"
export RUST_LOG="${RUST_LOG:-debug,h2=warn,hyper=warn,tower=warn,rustls=warn,tokio=warn,mio=warn}"
merod --node "$NODE_NAME" --home "$NODE_HOME" run \
  --auth-mode embedded \
  > "/tmp/merocalendar-dev-node2.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node2 started (pid $!  logs: /tmp/merocalendar-dev-node2.log)"
wait_for_node

# ── Authenticate ──────────────────────────────────────────────────────────────

step "Authenticating"
AUTH_RES=$(curl -sf -X POST "${NODE_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --arg u "$ADMIN_USER" \
        --arg p "$ADMIN_PASS" \
        '{auth_method:"user_password",public_key:$u,client_name:"dev-node2.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')" \
  2>/dev/null)

ACCESS_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.access_token // empty')
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed for node2"; echo "$AUTH_RES" >&2; exit 1; }
green "Authenticated as '${ADMIN_USER}'"

# ── Register with meroctl ─────────────────────────────────────────────────────

if command -v meroctl &>/dev/null; then
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  meroctl node add "$NODE_NAME" "$NODE_HOME" \
    --access-token  "$ACCESS_TOKEN" \
    --refresh-token "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')" \
    2>/dev/null && green "Registered node2 with meroctl" || yellow "meroctl registration skipped (non-fatal)"
fi

# ── Install app on node2 ─────────────────────────────────────────────────────

step "Installing Mero Calendar app on node2"
APP_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/install-dev-application" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
  2>/dev/null) || APP_RES="{}"
APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty' 2>/dev/null || true)

if [ -z "$APP_ID" ]; then
  APP_ID=$(curl -sf "${NODE_URL}/admin-api/applications" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
    | jq -r '.data.apps[0].id // .data.applications[0].id // empty' 2>/dev/null || true)
fi
[ -n "$APP_ID" ] || { red "Could not get APP_ID for node2"; exit 1; }
green "App installed on node2 (id: $APP_ID)"

# ── Update .env.integration with node2 tokens ────────────────────────────────

ENV_FILE="$REPO_ROOT/app/.env.integration"
if [ -f "$ENV_FILE" ]; then
  sed -i.bak \
    -e "s|^E2E_NODE_URL_2=.*|E2E_NODE_URL_2=${NODE_URL}|" \
    -e "s|^E2E_ACCESS_TOKEN_2=.*|E2E_ACCESS_TOKEN_2=${ACCESS_TOKEN}|" \
    -e "s|^E2E_REFRESH_TOKEN_2=.*|E2E_REFRESH_TOKEN_2=$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')|" \
    "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  green "Updated $ENV_FILE with node2 tokens"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

printf '\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Node2 ready (no workspace yet)\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\n'
printf '  Node2 URL:  \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Username:   \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:   \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  Logs:       /tmp/merocalendar-dev-node2.log\n'
printf '\n'
printf '  Next step:\n'
printf '    \033[36mmake dev-invite\033[0m  →  invite node2 into node1'\''s workspace\n'
printf '\n'
