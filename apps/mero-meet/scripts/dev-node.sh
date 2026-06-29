#!/usr/bin/env bash
# scripts/dev-node.sh — Start local merod NODE 1 for solo browser testing.
#
# Builds the WASM, runs a node, installs Mero Meet, and creates a room
# (namespace + context). Writes node URL / tokens / room ids to
# app/.env.dev-call so dev-node2.sh + dev-call.sh can wire up the second peer.
#
# Usage:
#   ./scripts/dev-node.sh            # start node1 + create room
#   ./scripts/dev-node.sh --stop     # stop node1
#   ./scripts/dev-node.sh --clean    # --stop + delete node home
#
# A video call needs TWO context members, so after this run dev-node2.sh +
# dev-invite.sh, then dev-call.sh. See DEV-TESTING.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="meet-dev"
NODE_HOME="${MEET_DEV_NODE_HOME:-$HOME/.calimero/meet-dev}"
NODE_PORT="${MEET_DEV_PORT:-2660}"
NODE_P2P_PORT="${MEET_DEV_P2P_PORT:-2661}"
NODE_URL="http://localhost:${NODE_PORT}"

ADMIN_USER="${MEET_ADMIN_USER:-admin}"
ADMIN_PASS="${MEET_ADMIN_PASS:-calimero1234}"
ROOM_NAME="${MEET_ROOM_NAME:-Dev Room}"

WASM_PATH="$REPO_ROOT/logic/res/mero_meet.wasm"
ENV_FILE="$REPO_ROOT/app/.env.dev-call"

# ── Helpers ───────────────────────────────────────────────────────────────────

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }

wait_for_node() {
  printf "  Waiting for node1"
  for _ in $(seq 1 60); do
    if node_is_running; then printf '  ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'; red "Node1 did not become healthy after 60s"; exit 1
}

pid_file() { echo "/tmp/meet-dev-node.pid"; }

# ── Parse args ────────────────────────────────────────────────────────────────

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)  STOP=true ;;
    --clean) STOP=true; CLEAN=true ;;
    --help|-h) sed -n '3,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
  esac
done

nuke_node() {
  pf=$(pid_file)
  if [ -f "$pf" ]; then
    kill "$(cat "$pf")" 2>/dev/null || true
    rm -f "$pf"
  fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
}

if $STOP; then
  step "Stopping node1"
  nuke_node
  $CLEAN && { rm -rf "$NODE_HOME"; yellow "Removed $NODE_HOME"; }
  green "Done"
  exit 0
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────

for cmd in merod jq curl python3; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

# ── Clean slate ───────────────────────────────────────────────────────────────

step "Nuking existing node1 (clean slate)"
nuke_node
rm -rf "$NODE_HOME"
green "Clean slate ready"

# ── Build WASM ────────────────────────────────────────────────────────────────

step "Building WASM"
(cd "$REPO_ROOT/logic" && bash build.sh)
[ -f "$WASM_PATH" ] || { red "WASM not built at $WASM_PATH"; exit 1; }
green "mero_meet.wasm built"

# ── Init + start node ─────────────────────────────────────────────────────────

step "Initialising node1 at $NODE_HOME"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded
green "Node1 initialised"

# CORS — allow all localhost origins so the Vite dev server (any port) can talk
# to the node admin API from the browser.
CONFIG_FILE="$NODE_HOME/${NODE_NAME}/config.toml"
if [ -f "$CONFIG_FILE" ]; then
  python3 - "$CONFIG_FILE" <<'PYEOF'
import sys, re
path = sys.argv[1]
txt  = open(path).read()
txt  = re.sub(r'allow_all_origins\s*=\s*false', 'allow_all_origins = true', txt)
open(path, 'w').write(txt)
PYEOF
  green "CORS patched (allow_all_origins = true)"
fi

step "Starting node1"
merod --node "$NODE_NAME" --home "$NODE_HOME" run > "/tmp/meet-dev-node.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node1 started (pid $!  logs: /tmp/meet-dev-node.log)"
wait_for_node

# ── Authenticate ──────────────────────────────────────────────────────────────

step "Authenticating"
AUTH_RES=$(curl -sf -X POST "${NODE_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" \
        '{auth_method:"user_password",public_key:$u,client_name:"dev-node.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')" \
  2>/dev/null) || AUTH_RES="{}"
ACCESS_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.access_token // empty')
REFRESH_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed"; echo "$AUTH_RES" >&2; exit 1; }
green "Authenticated as '${ADMIN_USER}'"

# ── Install app ───────────────────────────────────────────────────────────────

step "Installing Mero Meet app"
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
[ -n "$APP_ID" ] || { red "Could not get APP_ID"; exit 1; }
green "App installed (id: $APP_ID)"

# ── Create room: namespace + context ──────────────────────────────────────────

step "Creating room '${ROOM_NAME}'"
NS_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg a "$APP_ID" --arg n "$ROOM_NAME" \
        '{applicationId:$a, upgradePolicy:"LazyOnAccess", alias:$n}')" \
  2>/dev/null) || NS_RES="{}"
NAMESPACE_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty')
[ -n "$NAMESPACE_ID" ] || { red "Namespace create failed"; echo "$NS_RES" >&2; exit 1; }
green "Namespace: $NAMESPACE_ID"

# Members get all base caps (15) so node2 can fully participate.
curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/default-capabilities" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d '{"defaultCapabilities":15}' &>/dev/null \
  && green "Member caps set (15)" || yellow "Could not set caps (non-fatal)"

# Context init params = JSON bytes of {name} (contract `init(name: String)`).
INIT_BYTES=$(printf '%s' "{\"name\":\"${ROOM_NAME}\"}" | python3 -c \
  "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')")

CTX_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/contexts" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg appId "$APP_ID" --arg groupId "$NAMESPACE_ID" \
        --arg alias "$ROOM_NAME" --argjson init "$INIT_BYTES" \
        '{applicationId:$appId, protocol:"near", groupId:$groupId, alias:$alias, initializationParams:$init}')" \
  2>/dev/null) || CTX_RES="{}"
CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty')
MEMBER_KEY=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty')
if [ -n "$CONTEXT_ID" ] && [ -z "$MEMBER_KEY" ]; then
  MEMBER_KEY=$(curl -sf "${NODE_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
    | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end')
fi
[ -n "$CONTEXT_ID" ] || { red "Context create failed"; echo "$CTX_RES" >&2; exit 1; }
[ -n "$MEMBER_KEY" ] || { red "Could not get node1 member key"; exit 1; }
green "Room context: $CONTEXT_ID"
green "Node1 identity: $MEMBER_KEY"

# ── Write env ─────────────────────────────────────────────────────────────────

{
  printf 'DEV_ROOM_NAME="%s"\n'    "$ROOM_NAME"
  printf 'DEV_NODE_URL=%s\n'       "$NODE_URL"
  printf 'DEV_ACCESS_TOKEN=%s\n'   "$ACCESS_TOKEN"
  printf 'DEV_REFRESH_TOKEN=%s\n'  "$REFRESH_TOKEN"
  printf 'DEV_APP_ID=%s\n'         "$APP_ID"
  printf 'DEV_NAMESPACE_ID=%s\n'   "$NAMESPACE_ID"
  printf 'DEV_CONTEXT_ID=%s\n'     "$CONTEXT_ID"
  printf 'DEV_MEMBER_KEY=%s\n'     "$MEMBER_KEY"
  printf 'DEV_NODE_URL_2=\n'
  printf 'DEV_ACCESS_TOKEN_2=\n'
  printf 'DEV_REFRESH_TOKEN_2=\n'
  printf 'DEV_APP_ID_2=\n'
  printf 'DEV_MEMBER_KEY_2=\n'
} > "$ENV_FILE"
green "Wrote $ENV_FILE"

printf '\n\033[1;32m  Node1 ready — room "%s" created.\033[0m\n' "$ROOM_NAME"
printf '  Next:  \033[36m./scripts/dev-node2.sh && ./scripts/dev-invite.sh\033[0m\n\n'
