#!/usr/bin/env bash
# scripts/dev-node.sh — Start node1 for Mero AR development.
#
# Usage:
#   ./scripts/dev-node.sh            # build WASM, init node, install app, create room
#   ./scripts/dev-node.sh --stop     # stop the node
#   ./scripts/dev-node.sh --clean    # --stop + delete node home directory
#   ./scripts/dev-node.sh --skip-build
#
# Log in from the app with:
#   Node URL:   http://localhost:2450   (use your Mac's LAN IP from a phone)
#   Username:   admin
#   Password:   calimero1234
#   Context ID: printed at the end ("Room")

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="meroar-dev"
NODE_HOME="${MEROAR_DEV_NODE_HOME:-$HOME/.calimero/meroar-dev}"
NODE_PORT="${MEROAR_DEV_PORT:-2450}"
NODE_P2P_PORT="${MEROAR_DEV_P2P_PORT:-2550}"
NODE_URL="http://localhost:${NODE_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

# A signed .mpk bundle, not the raw .wasm. core#3652 (0.11.0-rc.31) made
# application distribution registry-only and took raw wasm out of the protocol,
# so `install-dev-application` refuses a bare .wasm.
BUNDLE_PATH="$REPO_ROOT/logic/res/mero-ar.mpk"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }
pid_file() { echo "/tmp/meroar-dev-node.pid"; }

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
  [ -f "$BUNDLE_PATH" ] || { red "bundle not found at $BUNDLE_PATH — run without --skip-build first"; exit 1; }
  yellow "Skipping bundle build"
else
  step "Building the .mpk bundle"
  # `--dev` signs with the well-known development key (the registry refuses it,
  # which is the point). `--app-version` is a placeholder: the registry owns the
  # published number — see logic/Cargo.toml.
  (cd "$REPO_ROOT/logic" && cargo mero bundle --dev --no-icon --app-version 0.0.0 --output res/mero-ar.mpk)
  green "mero-ar.mpk built"
fi

step "Initialising node at $NODE_HOME"
# The admin account is created HERE, not on first login: since core rc.20
# `--auth-mode embedded` refuses to initialise without credentials (it wants the
# admin to exist before the node ever listens), so a plain `init` fails with
# "requires admin credentials". Passing the password on stdin keeps it out of the
# process list.
printf '%s' "$ADMIN_PASS" | merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded \
  --admin-user "$ADMIN_USER" \
  --admin-password-stdin
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
  > "/tmp/meroar-dev-node.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node started (pid $!  logs: /tmp/meroar-dev-node.log)"
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

# ⚠️ Every admin-api request body is `deny_unknown_fields`. One stale key is a
# 400 for the WHOLE call, naming only the first offender — so these bodies carry
# exactly the fields the node declares and nothing else. Bodies drift on core
# releases; re-read the structs in
# crates/server/primitives/src/admin/mod.rs before adding a field here.
#
# `api` exists so a rejected body says so. The previous `|| RES="{}"` swallowed
# the status AND the message, and the script went on to print a "ready" banner
# with an empty context id — which is how four separate bodies went stale
# without anyone noticing.
api() {  # api <METHOD> <path> <json-body>  → prints the response body
  local method="$1" path="$2" body="$3" out code
  out=$(mktemp)
  code=$(curl -sS -X "$method" "${NODE_URL}${path}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d "$body" -o "$out" -w '%{http_code}' 2>/dev/null || echo 000)
  if [ "$code" != "200" ]; then
    red "${method} ${path} → HTTP ${code}"
    printf '  request:  %s\n' "$body" >&2
    printf '  response: %s\n' "$(cat "$out")" >&2
    rm -f "$out"; exit 1
  fi
  cat "$out"; rm -f "$out"
}

step "Installing Mero AR app"
# `path` ONLY. rc.38 rejects `metadata`/`package`/`version` outright.
APP_RES=$(api POST /admin-api/install-dev-application "$(jq -n --arg p "$BUNDLE_PATH" '{path:$p}')")
APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty' 2>/dev/null || true)
[ -n "$APP_ID" ] || { red "install-dev-application returned no applicationId: $APP_RES"; exit 1; }
green "App installed (id: $APP_ID)"

step "Creating workspace + room"
# `applicationId` + `name`. `upgradePolicy` and `alias` are gone — the node
# takes only applicationId / name / appKey / bytecodeId.
NS_RES=$(api POST /admin-api/namespaces "$(jq -n --arg a "$APP_ID" '{applicationId:$a, name:"Dev Workspace"}')")
NAMESPACE_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty' 2>/dev/null || true)
[ -n "$NAMESPACE_ID" ] || { red "namespace create returned no id: $NS_RES"; exit 1; }

CONTEXT_ID=""; MEMBER_KEY=""; BOARD_GROUP_ID=""
if [ -n "$NAMESPACE_ID" ]; then
  green "Workspace: $NAMESPACE_ID"
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/default-capabilities" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"defaultCapabilities":231}' &>/dev/null || true
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/subgroup-visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"subgroupVisibility":"open"}' &>/dev/null || true

  # `groupName` (+ optional `visibility`). `groupAlias` is not a field — sending
  # it is a 422 before the subgroup is ever created.
  SG_RES=$(api POST "/admin-api/namespaces/${NAMESPACE_ID}/groups" '{"groupName":"room"}')
  BOARD_GROUP_ID=$(echo "$SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null || true)
  [ -n "$BOARD_GROUP_ID" ] || { red "subgroup create returned no groupId: $SG_RES"; exit 1; }

  if [ -n "$BOARD_GROUP_ID" ]; then
    green "Subgroup: $BOARD_GROUP_ID"
    curl -sf -X PUT "${NODE_URL}/admin-api/groups/${BOARD_GROUP_ID}/settings/subgroup-visibility" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
      -d '{"subgroupVisibility":"open"}' &>/dev/null || true

    # MeroAR.init(name)
    INIT_JSON='{"name":"Room"}'
    INIT_BYTES=$(printf '%s' "$INIT_JSON" | python3 -c \
      "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')")

    # No `protocol`, no `alias`: the node takes applicationId / serviceName /
    # contextSeed / initializationParams / groupId / identitySecret / name.
    CTX_RES=$(api POST /admin-api/contexts \
      "$(jq -n --arg appId "$APP_ID" --arg groupId "$BOARD_GROUP_ID" --argjson initParams "$INIT_BYTES" \
            '{applicationId:$appId, groupId:$groupId, name:"Room", initializationParams:$initParams}')")
    CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
    MEMBER_KEY=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
    [ -n "$CONTEXT_ID" ] || { red "context create returned no contextId: $CTX_RES"; exit 1; }
    green "Context: $CONTEXT_ID"
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
printf '\033[1;32m  Mero AR dev node ready\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n\n'
printf '  Node URL (simulator):  \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Node URL (phone/LAN):  \033[1mhttp://%s:%s\033[0m\n' "$LAN_IP" "$NODE_PORT"
printf '  Username:              \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:              \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  Context ID:            \033[1m%s\033[0m\n' "${CONTEXT_ID:-<create from app>}"
printf '  Logs:                  /tmp/meroar-dev-node.log\n\n'
printf '  Next:  \033[36mmake app-run\033[0m  (simulator)  or open MeroAR.xcodeproj\n'
printf '  Two-node P2P:  \033[36mmake node2\033[0m  then  \033[36mmake invite\033[0m\n'
printf '  Stop:  \033[36mmake stop\033[0m\n\n'
