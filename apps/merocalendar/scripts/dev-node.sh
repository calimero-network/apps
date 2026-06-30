#!/usr/bin/env bash
# scripts/dev-node.sh — Start node1 for Mero Calendar development.
#
# Usage:
#   ./scripts/dev-node.sh           # start node, install app, create workspace + project
#   ./scripts/dev-node.sh --stop    # stop the node
#   ./scripts/dev-node.sh --clean   # --stop + delete node home directory
#   ./scripts/dev-node.sh --help
#
# After this script finishes, run:
#   make dev        ← starts the Vite frontend at http://localhost:5174
#
# Log in with:
#   Node URL:   http://localhost:2470
#   Username:   admin
#   Password:   calimero1234

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="merocalendar-dev"
NODE_HOME="${MEROCALENDAR_DEV_NODE_HOME:-$HOME/.calimero/merocalendar-dev}"
NODE_PORT="${MEROCALENDAR_DEV_PORT:-2470}"
NODE_P2P_PORT="${MEROCALENDAR_DEV_P2P_PORT:-2570}"
NODE_URL="http://localhost:${NODE_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/merocalendar.wasm"

# ── Helpers ───────────────────────────────────────────────────────────────────

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }
info()   { printf '     %s\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }

wait_for_node() {
  printf "  Waiting for node"
  for _ in $(seq 1 60); do
    if node_is_running; then printf '  ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'; red "Node did not become healthy after 60s"; exit 1
}

pid_file() { echo "/tmp/merocalendar-dev-node.pid"; }

# ── Parse args ────────────────────────────────────────────────────────────────

STOP=false; CLEAN=false; SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --stop)        STOP=true ;;
    --clean)       STOP=true; CLEAN=true ;;
    --skip-build)  SKIP_BUILD=true ;;
    --help|-h)
      sed -n '3,13p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
  esac
done

# ── Stop / Clean ──────────────────────────────────────────────────────────────

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
  yellow "Removed $NODE_HOME"
}

if $STOP; then
  step "Stopping dev node"
  pf=$(pid_file)
  if [ -f "$pf" ]; then
    pid=$(cat "$pf")
    kill "$pid" 2>/dev/null && yellow "Stopped node (pid $pid)" || yellow "Process $pid already gone"
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

for cmd in merod jq curl python3; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

# ── Nuke existing node ────────────────────────────────────────────────────────

step "Nuking existing node (clean slate)"
nuke_node
green "Clean slate ready"

# ── Build WASM ────────────────────────────────────────────────────────────────

if $SKIP_BUILD; then
  yellow "Skipping WASM build (--skip-build)"
  [ -f "$WASM_PATH" ] || { red "WASM not found at $WASM_PATH — run without --skip-build first"; exit 1; }
else
  step "Building WASM"
  (cd "$REPO_ROOT/logic" && bash build.sh)
  green "merocalendar.wasm built"
fi

# ── Init node ─────────────────────────────────────────────────────────────────

step "Initialising node at $NODE_HOME"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded
green "Node initialised"

# ── Patch CORS ────────────────────────────────────────────────────────────────

CONFIG_FILE="$NODE_HOME/${NODE_NAME}/config.toml"
if [ -f "$CONFIG_FILE" ]; then
  python3 - "$CONFIG_FILE" <<'PYEOF'
import sys, re
path = sys.argv[1]
txt  = open(path).read()
txt  = re.sub(r'allow_all_origins\s*=\s*false', 'allow_all_origins = true', txt)
txt  = re.sub(r'allowed_origins\s*=\s*\[\]',   'allowed_origins = []',       txt)
open(path, 'w').write(txt)
PYEOF
  green "CORS patched (allow_all_origins = true)"
fi

# ── Start node ────────────────────────────────────────────────────────────────

step "Starting node"
export RUST_LOG="${RUST_LOG:-debug,h2=warn,hyper=warn,tower=warn,rustls=warn,tokio=warn,mio=warn}"
merod --node "$NODE_NAME" --home "$NODE_HOME" run \
  --auth-mode embedded \
  > "/tmp/merocalendar-dev-node.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node started (pid $!  logs: /tmp/merocalendar-dev-node.log)"
wait_for_node

# ── Authenticate ──────────────────────────────────────────────────────────────

step "Authenticating"
AUTH_RES=$(curl -sf -X POST "${NODE_URL}/auth/token" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --arg u "$ADMIN_USER" \
        --arg p "$ADMIN_PASS" \
        '{auth_method:"user_password",public_key:$u,client_name:"dev-node.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')" \
  2>/dev/null)

ACCESS_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.access_token // empty')
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed — check credentials"; echo "$AUTH_RES" >&2; exit 1; }
green "Authenticated as '${ADMIN_USER}'"

# ── Register with meroctl ─────────────────────────────────────────────────────

if command -v meroctl &>/dev/null; then
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  meroctl node add "$NODE_NAME" "$NODE_HOME" \
    --access-token  "$ACCESS_TOKEN" \
    --refresh-token "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')" \
    2>/dev/null && green "Registered with meroctl" || yellow "meroctl registration skipped (non-fatal)"
fi

# ── Install app ───────────────────────────────────────────────────────────────

step "Installing Mero Calendar app"
APP_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/install-dev-application" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
  2>/dev/null) || APP_RES="{}"
APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty' 2>/dev/null || true)

if [ -z "$APP_ID" ]; then
  yellow "Fetching existing app ID"
  APP_ID=$(curl -sf "${NODE_URL}/admin-api/applications" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
    | jq -r '.data.apps[0].id // .data.applications[0].id // empty' 2>/dev/null || true)
fi
[ -n "$APP_ID" ] || { red "Could not get APP_ID"; exit 1; }
green "App installed (id: $APP_ID)"

# ── Create workspace (namespace) ──────────────────────────────────────────────

step "Creating workspace"
NS_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg a "$APP_ID" '{applicationId: $a, upgradePolicy: "LazyOnAccess", alias: "Dev Workspace", name: "Dev Workspace"}')" \
  2>/dev/null) || NS_RES="{}"
NAMESPACE_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty' 2>/dev/null || true)

if [ -z "$NAMESPACE_ID" ]; then
  NS_OUTPUT=$(meroctl --node "$NODE_NAME" --output-format json namespace create \
    --application-id "$APP_ID" --upgrade-policy automatic --alias "Dev Workspace" 2>/dev/null) || true
  NAMESPACE_ID=$(echo "$NS_OUTPUT" | jq -r '.namespaceId // .data.namespaceId // empty' 2>/dev/null || true)
fi

if [ -n "$NAMESPACE_ID" ]; then
  green "Workspace created ($NAMESPACE_ID)"

  # Set member capabilities: create context + invite + join open + create/delete subgroup
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/default-capabilities" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"defaultCapabilities":231}' &>/dev/null \
    && green "Namespace caps set (231)" || yellow "Could not set caps (non-fatal)"

  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/subgroup-visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"subgroupVisibility":"open"}' &>/dev/null || true
else
  yellow "Could not create workspace — create one from the app after logging in"
fi

# ── Create default project context ────────────────────────────────────────────

PROJECT_GROUP_ID=""
CONTEXT_ID=""
MEMBER_KEY=""

if [ -n "$NAMESPACE_ID" ]; then
  step "Creating default calendar"

  # Create a subgroup that will hold the team's single calendar context.
  SG_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces/${NAMESPACE_ID}/groups" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"groupAlias":"calendar","groupName":"calendar"}' 2>/dev/null) || SG_RES="{}"
  PROJECT_GROUP_ID=$(echo "$SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null || true)

  if [ -z "$PROJECT_GROUP_ID" ]; then
    PROJECT_GROUP_ID=$(curl -sf "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/subgroups" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
      | jq -r '(.subgroups // .data // .) | if type=="array" then .[0].group_id // .[0].groupId else empty end' \
      2>/dev/null || true)
  fi

  if [ -n "$PROJECT_GROUP_ID" ]; then
    green "Project subgroup: $PROJECT_GROUP_ID"

    curl -sf -X PUT "${NODE_URL}/admin-api/groups/${PROJECT_GROUP_ID}/settings/subgroup-visibility" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
      -d '{"subgroupVisibility":"open"}' &>/dev/null || true

    # Serialize init params. The Mero Calendar contract's init() takes no
    # arguments, so the params are an empty JSON object.
    INIT_JSON='{}'
    INIT_BYTES=$(printf '%s' "$INIT_JSON" | python3 -c \
      "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')" 2>/dev/null || echo "[]")

    CTX_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/contexts" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$(jq -n \
            --arg appId "$APP_ID" \
            --arg groupId "$PROJECT_GROUP_ID" \
            --argjson initParams "$INIT_BYTES" \
            '{applicationId: $appId, protocol: "near", groupId: $groupId, alias: "My Calendar", name: "My Calendar", initializationParams: $initParams}')" \
      2>/dev/null) || CTX_RES="{}"

    CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
    MEMBER_KEY=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)

    if [ -z "$CONTEXT_ID" ]; then
      CONTEXT_ID=$(curl -sf "${NODE_URL}/admin-api/groups/${PROJECT_GROUP_ID}/contexts" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
        | jq -r '(.data // .) | if type=="array" then .[0].contextId // .[0].id else empty end' \
        2>/dev/null || true)
    fi

    if [ -n "$CONTEXT_ID" ] && [ -z "$MEMBER_KEY" ]; then
      MEMBER_KEY=$(curl -sf "${NODE_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
        | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' \
        2>/dev/null || true)
    fi

    [ -n "$CONTEXT_ID" ] && green "Project context: $CONTEXT_ID" \
      || yellow "Could not create project context (create one from the app)"
    [ -n "$MEMBER_KEY" ] && green "Member key: $MEMBER_KEY" || true
  else
    yellow "Could not create project subgroup"
  fi
fi

# ── Write .env.integration ────────────────────────────────────────────────────

ENV_FILE="$REPO_ROOT/app/.env.integration"
{
  printf 'E2E_NODE_URL=%s\n'          "$NODE_URL"
  printf 'E2E_ACCESS_TOKEN=%s\n'      "$ACCESS_TOKEN"
  printf 'E2E_REFRESH_TOKEN=%s\n'     "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')"
  printf 'E2E_NODE_URL_2=\n'
  printf 'E2E_ACCESS_TOKEN_2=\n'
  printf 'E2E_REFRESH_TOKEN_2=\n'
  printf 'E2E_GROUP_ID=%s\n'           "${NAMESPACE_ID:-}"
  printf 'E2E_PROJECT_GROUP_ID=%s\n'   "${PROJECT_GROUP_ID:-}"
  printf 'E2E_CONTEXT_ID=%s\n'         "${CONTEXT_ID:-}"
  printf 'E2E_MEMBER_KEY=%s\n'         "${MEMBER_KEY:-}"
  printf 'E2E_MEMBER_KEY_2=\n'
  printf 'VITE_APPLICATION_ID=%s\n'    "$APP_ID"
  printf 'VITE_APPLICATION_PACKAGE=com.calimero.merocalendar\n'
} > "$ENV_FILE"
green "Wrote $ENV_FILE"

# ── Done ─────────────────────────────────────────────────────────────────────

printf '\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Dev node ready\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\n'
printf '  Node URL:   \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Username:   \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:   \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  App ID:     %s\n' "$APP_ID"
[ -n "${NAMESPACE_ID:-}" ] && printf '  Workspace:  %s\n' "$NAMESPACE_ID"
[ -n "${CONTEXT_ID:-}"   ] && printf '  Project:    %s\n' "$CONTEXT_ID"
printf '  Logs:       /tmp/merocalendar-dev-node.log\n'
printf '\n'
printf '  Next step:\n'
printf '    \033[36mmake dev\033[0m   →  open http://localhost:5174\n'
printf '\n'
printf '  For two-node P2P testing:\n'
printf '    \033[36mmake dev-node2\033[0m  then  \033[36mmake dev-invite\033[0m\n'
printf '\n'
printf '  When done:\n'
printf '    \033[36mmake stop\033[0m\n'
printf '\n'
