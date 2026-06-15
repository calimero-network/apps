#!/usr/bin/env bash
# scripts/dev-node.sh — Start node1 for Mero Tag development.
#
# Usage:
#   ./scripts/dev-node.sh            # build WASM, init node, install app, create tracking space
#   ./scripts/dev-node.sh --stop     # stop the node
#   ./scripts/dev-node.sh --clean    # --stop + delete node home directory
#   ./scripts/dev-node.sh --skip-build
#
# Log in from the app with:
#   Node URL:   http://localhost:2440   (use your Mac's LAN IP from a phone)
#   Username:   admin
#   Password:   calimero1234
#   Context ID: printed at the end ("Tracking space")

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="merotag-dev"
NODE_HOME="${MEROTAG_DEV_NODE_HOME:-$HOME/.calimero/merotag-dev}"
NODE_PORT="${MEROTAG_DEV_PORT:-2440}"
NODE_P2P_PORT="${MEROTAG_DEV_P2P_PORT:-2540}"
NODE_URL="http://localhost:${NODE_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/mero_tag.wasm"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }
pid_file() { echo "/tmp/merotag-dev-node.pid"; }

wait_for_node() {
  printf "  Waiting for node"
  for _ in $(seq 1 60); do
    if node_is_running; then printf '  ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'; red "Node did not become healthy after 60s"; exit 1
}

STOP=false; CLEAN=false; SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --stop)       STOP=true ;;
    --clean)      STOP=true; CLEAN=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --help|-h)    sed -n '3,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
  esac
done

nuke_node() {
  pf=$(pid_file)
  if [ -f "$pf" ]; then kill "$(cat "$pf")" 2>/dev/null || true; rm -f "$pf"; fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
}

if $STOP; then
  step "Stopping dev node"
  nuke_node
  if $CLEAN; then rm -rf "$NODE_HOME"; yellow "Removed $NODE_HOME"; fi
  green "Done"; exit 0
fi

for cmd in merod jq curl python3; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

step "Clean slate"
nuke_node
rm -rf "$NODE_HOME"
green "Ready"

if $SKIP_BUILD; then
  [ -f "$WASM_PATH" ] || { red "WASM not found at $WASM_PATH — run without --skip-build first"; exit 1; }
  yellow "Skipping WASM build"
else
  step "Building WASM"
  (cd "$REPO_ROOT/logic" && bash build.sh)
  green "mero_tag.wasm built"
fi

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
  green "CORS patched (allow_all_origins = true)"
fi

step "Starting node"
export RUST_LOG="${RUST_LOG:-info,h2=warn,hyper=warn,tower=warn,rustls=warn,tokio=warn,mio=warn}"
merod --node "$NODE_NAME" --home "$NODE_HOME" run --auth-mode embedded \
  > "/tmp/merotag-dev-node.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node started (pid $!  logs: /tmp/merotag-dev-node.log)"
wait_for_node

step "Authenticating"
AUTH_RES=$(curl -sf -X POST "${NODE_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" \
        '{auth_method:"user_password",public_key:$u,client_name:"dev-node.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')" )
ACCESS_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.access_token // empty')
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed"; echo "$AUTH_RES" >&2; exit 1; }
green "Authenticated as '${ADMIN_USER}'"

if command -v meroctl &>/dev/null; then
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  meroctl node add "$NODE_NAME" "$NODE_HOME" \
    --access-token "$ACCESS_TOKEN" \
    --refresh-token "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')" \
    2>/dev/null && green "Registered with meroctl" || yellow "meroctl registration skipped"
fi

step "Installing Mero Tag app"
APP_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/install-dev-application" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" ) || APP_RES="{}"
APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty' 2>/dev/null || true)
if [ -z "$APP_ID" ]; then
  APP_ID=$(curl -sf "${NODE_URL}/admin-api/applications" -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
    | jq -r '.data.apps[0].id // .data.applications[0].id // empty' 2>/dev/null || true)
fi
[ -n "$APP_ID" ] || { red "Could not get APP_ID"; exit 1; }
green "App installed (id: $APP_ID)"

step "Creating workspace + tracking space"
NS_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg a "$APP_ID" '{applicationId:$a, upgradePolicy:"LazyOnAccess", alias:"Dev Workspace", name:"Dev Workspace"}')" ) || NS_RES="{}"
NAMESPACE_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty' 2>/dev/null || true)

CONTEXT_ID=""; MEMBER_KEY=""; BOARD_GROUP_ID=""
if [ -n "$NAMESPACE_ID" ]; then
  green "Workspace: $NAMESPACE_ID"
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/default-capabilities" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"defaultCapabilities":231}' &>/dev/null || true
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/subgroup-visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"subgroupVisibility":"open"}' &>/dev/null || true

  SG_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces/${NAMESPACE_ID}/groups" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"groupAlias":"tracking-space","groupName":"tracking-space"}' 2>/dev/null) || SG_RES="{}"
  BOARD_GROUP_ID=$(echo "$SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null || true)

  if [ -n "$BOARD_GROUP_ID" ]; then
    green "Subgroup: $BOARD_GROUP_ID"
    curl -sf -X PUT "${NODE_URL}/admin-api/groups/${BOARD_GROUP_ID}/settings/subgroup-visibility" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
      -d '{"subgroupVisibility":"open"}' &>/dev/null || true

    # MeroTag.init(name)
    INIT_JSON='{"name":"Tracking space"}'
    INIT_BYTES=$(printf '%s' "$INIT_JSON" | python3 -c \
      "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')")

    CTX_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/contexts" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
      -d "$(jq -n --arg appId "$APP_ID" --arg groupId "$BOARD_GROUP_ID" --argjson initParams "$INIT_BYTES" \
            '{applicationId:$appId, protocol:"near", groupId:$groupId, alias:"Tracking space", name:"Tracking space", initializationParams:$initParams}')" ) || CTX_RES="{}"
    CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
    MEMBER_KEY=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
    [ -n "$CONTEXT_ID" ] && green "Context: $CONTEXT_ID" || yellow "Could not create context"
  fi
fi

ENV_FILE="$REPO_ROOT/app/.env.integration"
{
  printf 'E2E_NODE_URL=%s\n'       "$NODE_URL"
  printf 'E2E_ACCESS_TOKEN=%s\n'   "$ACCESS_TOKEN"
  printf 'E2E_REFRESH_TOKEN=%s\n'  "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')"
  printf 'E2E_GROUP_ID=%s\n'       "${NAMESPACE_ID:-}"
  printf 'E2E_SPACE_GROUP_ID=%s\n' "${BOARD_GROUP_ID:-}"
  printf 'E2E_CONTEXT_ID=%s\n'     "${CONTEXT_ID:-}"
  printf 'E2E_MEMBER_KEY=%s\n'     "${MEMBER_KEY:-}"
  printf 'APPLICATION_ID=%s\n'     "$APP_ID"
} > "$ENV_FILE"
green "Wrote $ENV_FILE"

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "<your-mac-ip>")
printf '\n\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Mero Tag dev node ready\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n\n'
printf '  Node URL (simulator):  \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Node URL (phone/LAN):  \033[1mhttp://%s:%s\033[0m\n' "$LAN_IP" "$NODE_PORT"
printf '  Username:              \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:              \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  Context ID:            \033[1m%s\033[0m\n' "${CONTEXT_ID:-<create from app>}"
printf '  Logs:                  /tmp/merotag-dev-node.log\n\n'
printf '  Next:  \033[36mmake app-run\033[0m  (simulator)  or open MeroTag.xcodeproj\n'
printf '  Two-node P2P:  \033[36mmake node2\033[0m  then  \033[36mmake invite\033[0m\n'
printf '  Stop:  \033[36mmake stop\033[0m\n\n'
