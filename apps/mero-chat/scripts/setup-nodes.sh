#!/usr/bin/env bash
# scripts/setup-nodes.sh — Curb chat app: integration test backend setup
#
# Usage:
#   ./scripts/setup-nodes.sh              # start 2 nodes via merod + meroctl (default)
#   ./scripts/setup-nodes.sh --merobox    # use merobox to manage nodes instead
#   ./scripts/setup-nodes.sh --stop       # kill running nodes, remove env file
#   ./scripts/setup-nodes.sh --clean      # --stop + delete node home directories
#   ./scripts/setup-nodes.sh --restart    # --clean then start fresh (used by pnpm e2e:*)
#   ./scripts/setup-nodes.sh --help
#
# Credentials (override via env):
#   E2E_ADMIN_USER=admin   E2E_ADMIN_PASS=calimero1234
#
# Auth is bootstrapped automatically against the node HTTP API — no browser needed.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_1_HOME="${CURB_NODE_1_HOME:-$HOME/.calimero/curb-node-1}"
NODE_2_HOME="${CURB_NODE_2_HOME:-$HOME/.calimero/curb-node-2}"
NODE_1_PORT="${NODE_1_PORT:-2428}"
NODE_2_PORT="${NODE_2_PORT:-2429}"
NODE_1_P2P_PORT="${NODE_1_P2P_PORT:-2528}"
NODE_2_P2P_PORT="${NODE_2_P2P_PORT:-2529}"
NODE_1_URL="http://localhost:${NODE_1_PORT}"
NODE_2_URL="http://localhost:${NODE_2_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/curb.wasm"
ENV_OUT="$REPO_ROOT/app/.env.integration"

USE_MEROBOX=false
STOP=false
CLEAN=false
RESTART=false

for arg in "$@"; do
  case "$arg" in
    --merobox)   USE_MEROBOX=true ;;
    --stop)      STOP=true ;;
    --clean)     CLEAN=true; STOP=true ;;
    --restart)   CLEAN=true; STOP=true; RESTART=true ;;
    --help|-h)
      sed -n '3,12p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    red "ERROR: '$1' not found in PATH."
    case "$1" in
      merod|meroctl) yellow "Install: ./install-calimero.sh  (then restart terminal)" ;;
      merobox)       yellow "Install merobox: https://calimero-network.github.io/docs/merobox/install" ;;
      jq)            yellow "Install jq: brew install jq  (macOS)  or  apt install jq  (Linux)" ;;
    esac
    exit 1
  fi
}

node_is_running() { curl -sf "http://127.0.0.1:${1}/admin-api/health" &>/dev/null; }

wait_for_node() {
  local port=$1 label=$2
  printf "Waiting for %s (port %s)" "$label" "$port"
  for _ in $(seq 1 60); do
    if node_is_running "$port"; then printf ' ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'; red "ERROR: $label did not become healthy after 60s"; exit 1
}

pid_file() { echo "/tmp/curb-merod-$1.pid"; }

# ── Auth bootstrap ─────────────────────────────────────────────────────────────
# Sets NODE_ACCESS_TOKEN / NODE_REFRESH_TOKEN globals.

NODE_ACCESS_TOKEN=""
NODE_REFRESH_TOKEN=""

bootstrap_auth() {
  local port=$1 label=$2
  step "Authenticating $label as '${ADMIN_USER}'"

  local res
  res=$(curl -sf -X POST "http://127.0.0.1:${port}/auth/token" \
    -H "Content-Type: application/json" \
    -d "{\"auth_method\":\"user_password\",\"public_key\":\"${ADMIN_USER}\",\"client_name\":\"setup-nodes.sh\",\"timestamp\":0,\"permissions\":[],\"provider_data\":{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}}" \
    2>/dev/null) || true

  NODE_ACCESS_TOKEN=$(echo "$res" | jq -r '.data.access_token  // empty' 2>/dev/null)
  NODE_REFRESH_TOKEN=$(echo "$res" | jq -r '.data.refresh_token // empty' 2>/dev/null)

  if [ -z "$NODE_ACCESS_TOKEN" ]; then
    red "ERROR: Auth failed for $label."
    yellow "Response: $res"
    yellow "Credentials: ${ADMIN_USER} / ${ADMIN_PASS}  (override: E2E_ADMIN_USER / E2E_ADMIN_PASS)"
    exit 1
  fi
  green "Authenticated as '${ADMIN_USER}' on $label"
}

register_node() {
  local name=$1 home=$2
  meroctl node remove "$name" 2>/dev/null || true
  meroctl node add "$name" "$home" \
    --access-token  "$NODE_ACCESS_TOKEN" \
    --refresh-token "$NODE_REFRESH_TOKEN" \
    2>/dev/null && green "$name registered with meroctl" \
    || yellow "WARNING: could not register $name with meroctl (non-fatal)"
}

# ── RPC helper ────────────────────────────────────────────────────────────────

rpc_call() {
  local url=$1 token=$2 ctx_id=$3 executor=$4 method=$5 args_json=$6
  curl -sf -X POST "${url}/jsonrpc" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
          --arg ctx "$ctx_id" \
          --arg m   "$method" \
          --argjson a "$args_json" \
          --arg e   "$executor" \
          '{"jsonrpc":"2.0","id":1,"method":"execute","params":{"contextId":$ctx,"method":$m,"argsJson":$a,"executorPublicKey":$e}}')" \
    >/dev/null
}

# ── merod node management ─────────────────────────────────────────────────────

start_node_merod() {
  local name=$1 home=$2 port=$3 p2p_port=$4

  # Always start clean — kill anything on the target port (could be a stale
  # dev-node or a previous failed CI run) and wipe the home directory.
  stop_node_merod "$name"
  pkill -f "merod.*--server-port ${port}" 2>/dev/null || true
  rm -rf "$home"

  step "Initialising $name at $home"
  merod --node "$name" --home "$home" init \
    --server-host 127.0.0.1 \
    --server-port "$port" \
    --swarm-port  "$p2p_port" \
    --auth-mode embedded

  step "Starting $name"
  merod --node "$name" --home "$home" run > "/tmp/curb-merod-${name}.log" 2>&1 &
  echo $! > "$(pid_file "$name")"
  wait_for_node "$port" "$name"
  green "$name running  (pid $!  logs: /tmp/curb-merod-${name}.log)"

  bootstrap_auth "$port" "$name"
  # meroctl registration is best-effort; we use REST API for all operations
  register_node "$name" "$home" 2>/dev/null || true
}

stop_node_merod() {
  local name=$1
  local pf; pf=$(pid_file "$name")
  if [ -f "$pf" ]; then
    local pid; pid=$(cat "$pf")
    kill "$pid" 2>/dev/null && yellow "Stopped $name (pid $pid)" || true
    rm -f "$pf"
  fi
  pkill -f "merod --node ${name}" 2>/dev/null || true
}

# ── merobox node management ───────────────────────────────────────────────────

start_nodes_merobox() {
  step "Starting nodes via merobox (--no-docker)"
  cd "$REPO_ROOT/workflows"
  merobox stop --all  2>/dev/null || true
  merobox nuke --force 2>/dev/null || true
  # integration-setup.yml sets stop_all_nodes: false so nodes stay running
  merobox bootstrap run --no-docker integration-setup.yml
  cd "$REPO_ROOT"
}

# ── Stop / Clean ──────────────────────────────────────────────────────────────

if $STOP; then
  step "Stopping nodes"
  stop_node_merod "node-1"
  stop_node_merod "node-2"
  # Only call merobox if we are actually in merobox mode (avoids Docker dependency)
  if $USE_MEROBOX && command -v merobox &>/dev/null; then
    merobox stop --all 2>/dev/null || true
    merobox nuke --force 2>/dev/null || true
  fi
  if $CLEAN; then
    step "Removing node home directories"
    rm -rf "$NODE_1_HOME" "$NODE_2_HOME"
    yellow "Removed $NODE_1_HOME  $NODE_2_HOME"
  fi
  rm -f "$ENV_OUT" && yellow "Removed $ENV_OUT"
  if ! $RESTART; then
    green "Done."
    exit 0
  fi
  green "Clean done — starting fresh nodes…"
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────

step "Checking prerequisites"
if $USE_MEROBOX; then
  check_cmd merobox
  check_cmd meroctl
else
  check_cmd merod
  # meroctl is optional in merod mode — all app/namespace ops use REST API
fi
check_cmd jq
check_cmd curl
green "All tools found"

# ── Build WASM if needed ──────────────────────────────────────────────────────

step "Checking WASM build"
if [ ! -f "$WASM_PATH" ]; then
  yellow "curb.wasm not found — building (first run is slow)…"
  (cd "$REPO_ROOT/logic" && bash build.sh)
  green "curb.wasm built: $WASM_PATH"
else
  green "WASM already exists: $WASM_PATH"
fi

# ── Start nodes ───────────────────────────────────────────────────────────────

if $USE_MEROBOX; then
  start_nodes_merobox
  wait_for_node "$NODE_1_PORT" "node-1"
  wait_for_node "$NODE_2_PORT" "node-2"

  # Get tokens for both nodes (workflow left them running but we still need JWTs)
  bootstrap_auth "$NODE_1_PORT" "node-1"
  ACCESS_TOKEN_1="$NODE_ACCESS_TOKEN"; REFRESH_TOKEN_1="$NODE_REFRESH_TOKEN"
  register_node "node-1" "$HOME/.calimero/calimero-node-1"

  bootstrap_auth "$NODE_2_PORT" "node-2"
  ACCESS_TOKEN_2="$NODE_ACCESS_TOKEN"; REFRESH_TOKEN_2="$NODE_REFRESH_TOKEN"
  register_node "node-2" "$HOME/.calimero/calimero-node-2"

else
  # ── merod path ────────────────────────────────────────────────────────────

  start_node_merod "node-1" "$NODE_1_HOME" "$NODE_1_PORT" "$NODE_1_P2P_PORT"
  ACCESS_TOKEN_1="$NODE_ACCESS_TOKEN"; REFRESH_TOKEN_1="$NODE_REFRESH_TOKEN"

  start_node_merod "node-2" "$NODE_2_HOME" "$NODE_2_PORT" "$NODE_2_P2P_PORT"
  ACCESS_TOKEN_2="$NODE_ACCESS_TOKEN"; REFRESH_TOKEN_2="$NODE_REFRESH_TOKEN"

  # ── Install app via REST (no meroctl needed) ──────────────────────────────

  step "Installing curb app on node-1"
  # Drop -f and capture HTTP status so we can surface merod's actual error
  # body if the install fails — `-sf` silently swallows non-2xx responses.
  APP_HTTP=$(curl -s -o /tmp/curb-app-install-n1.json -w '%{http_code}' \
    -X POST "${NODE_1_URL}/admin-api/install-dev-application" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
    2>/dev/null) || APP_HTTP="000"
  APP_RES=$(cat /tmp/curb-app-install-n1.json 2>/dev/null || echo "{}")
  APP_ID=$(echo "$APP_RES" | jq -r '.data.applicationId // empty' 2>/dev/null || true)

  if [ -z "$APP_ID" ]; then
    yellow "install-dev-application returned HTTP $APP_HTTP — body:"
    printf '%s\n' "$APP_RES" | sed 's/^/    /' >&2

    yellow "Fetching existing app ID from node-1"
    APPS_RES=$(curl -s "${NODE_1_URL}/admin-api/applications" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null || echo "{}")
    APP_ID=$(echo "$APPS_RES" | jq -r '.data.apps[0].id // .data.applications[0].id // empty' 2>/dev/null || true)
    if [ -z "$APP_ID" ]; then
      yellow "GET /admin-api/applications body:"
      printf '%s\n' "$APPS_RES" | sed 's/^/    /' >&2
    fi
  fi
  [ -n "$APP_ID" ] || { red "ERROR: could not install or find app on node-1 (see HTTP body above)"; exit 1; }
  green "APP_ID: $APP_ID"

  step "Installing curb app on node-2"
  curl -sf -X POST "${NODE_2_URL}/admin-api/install-dev-application" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$WASM_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
    2>/dev/null | jq -r '.data.applicationId // "already installed"' 2>/dev/null \
    && green "App installed on node-2" || yellow "App install on node-2 failed (non-fatal)"

  # ── Create namespace (group / workspace) via REST ─────────────────────────

  step "Creating namespace on node-1"
  NS_RES=$(curl -sf -X POST "${NODE_1_URL}/admin-api/namespaces" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg a "$APP_ID" '{applicationId: $a, upgradePolicy: "LazyOnAccess"}')" \
    2>/dev/null) || NS_RES="{}"
  NS_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty' 2>/dev/null || true)

  if [ -z "$NS_ID" ]; then
    yellow "Fetching existing namespace from node-1"
    NS_ID=$(curl -sf "${NODE_1_URL}/admin-api/groups" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0].groupId else (.groups[0].groupId // .items[0].groupId) end' \
      2>/dev/null || true)
  fi
  [ -n "$NS_ID" ] || { red "ERROR: could not create or find namespace on node-1"; exit 1; }
  green "NS_ID (GROUP_ID): $NS_ID"

  GROUP_ID="$NS_ID"

  # ── Create "general" subgroup inside the namespace ───────────────────────────

  step "Creating general channel subgroup on node-1"
  SG_RES=$(curl -sf -X POST "${NODE_1_URL}/admin-api/namespaces/${GROUP_ID}/groups" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" \
    -H "Content-Type: application/json" \
    -d '{"groupAlias":"general"}' \
    2>/dev/null) || SG_RES="{}"
  GENERAL_GROUP_ID=$(echo "$SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null || true)

  if [ -z "$GENERAL_GROUP_ID" ]; then
    yellow "Fetching existing general subgroup from node-1"
    GENERAL_GROUP_ID=$(curl -sf "${NODE_1_URL}/admin-api/groups/${GROUP_ID}/subgroups" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null \
      | jq -r '(.subgroups // .data // .) | if type=="array" then .[0].group_id // .[0].groupId else empty end' \
      2>/dev/null || true)
  fi
  [ -n "$GENERAL_GROUP_ID" ] || { red "ERROR: could not create or find general subgroup"; exit 1; }
  green "GENERAL_GROUP_ID: $GENERAL_GROUP_ID"

  # Set subgroup visibility to open (public channel)
  curl -sf -X PUT "${NODE_1_URL}/admin-api/groups/${GENERAL_GROUP_ID}/settings/subgroup-visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" -H "Content-Type: application/json" \
    -d '{"subgroupVisibility":"open"}' &>/dev/null \
    && green "General subgroup visibility set to open" \
    || yellow "Could not set subgroup visibility (non-fatal)"

  # ── Create #general channel on node-1 (linked to general subgroup) ───────────

  step "Creating #general channel on node-1"

  # Build init params as UTF-8 byte array for the WASM init function
  INIT_JSON='{"name":"general","context_type":"Channel","description":"","created_at":1751952997,"creator_username":""}'
  INIT_BYTES=$(printf '%s' "$INIT_JSON" | python3 -c \
    "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')" 2>/dev/null || echo "[]")

  CTX_RES=$(curl -sf -X POST "${NODE_1_URL}/admin-api/contexts" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
          --arg appId "$APP_ID" \
          --arg groupId "$GENERAL_GROUP_ID" \
          --argjson initParams "$INIT_BYTES" \
          '{applicationId: $appId, protocol: "near", groupId: $groupId, alias: "general", initializationParams: $initParams}')" \
    2>/dev/null) || CTX_RES="{}"

  CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
  MEMBER_KEY_1=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)

  if [ -z "$CONTEXT_ID" ]; then
    yellow "Listing existing contexts in general subgroup"
    CONTEXT_ID=$(curl -sf "${NODE_1_URL}/admin-api/groups/${GENERAL_GROUP_ID}/contexts" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0].contextId // .[0].id else empty end' 2>/dev/null || true)
  fi
  [ -n "$CONTEXT_ID" ] || { red "ERROR: could not get CONTEXT_ID"; exit 1; }
  green "CONTEXT_ID: $CONTEXT_ID"

  # Set channel visibility to public (open)
  curl -sf -X PUT "${NODE_1_URL}/admin-api/groups/${GENERAL_GROUP_ID}/contexts/${CONTEXT_ID}/visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" -H "Content-Type: application/json" \
    -d '{"mode":"open"}' &>/dev/null \
    && green "Channel visibility set to public" \
    || yellow "Could not set channel visibility (non-fatal)"

  if [ -z "$MEMBER_KEY_1" ]; then
    MEMBER_KEY_1=$(curl -sf "${NODE_1_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' 2>/dev/null || true)
  fi
  [ -n "$MEMBER_KEY_1" ] || { red "ERROR: could not get MEMBER_KEY_1"; exit 1; }
  green "MEMBER_KEY_1 (node-1 identity): $MEMBER_KEY_1"

  # ── Create namespace invitation and have node-2 join ─────────────────────

  step "Inviting node-2 to namespace"
  INVITE_RES=$(curl -sf -X POST "${NODE_1_URL}/admin-api/namespaces/${GROUP_ID}/invite" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null) || INVITE_RES="{}"

  # Response: { data: { invitation: { invitation: {...}, inviter_signature: "..." } } }
  # The join endpoint wants: { invitation: { invitation: {...}, inviter_signature: "..." } }
  # Extract .data.invitation (not .data) to avoid double-wrapping.
  INVITE_DATA=$(echo "$INVITE_RES" | jq '.data.invitation // empty' 2>/dev/null)
  [ -n "$INVITE_DATA" ] && [ "$INVITE_DATA" != "null" ] \
    || { red "ERROR: namespace invitation is empty"; echo "$INVITE_RES" >&2; exit 1; }
  green "Namespace invitation generated"

  step "Node-2 joining namespace"
  JOIN_RES=$(curl -sf -X POST "${NODE_2_URL}/admin-api/namespaces/${GROUP_ID}/join" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --argjson inv "$INVITE_DATA" '{invitation: $inv}')" 2>/dev/null) \
    && green "Node-2 joined namespace" \
    || { red "Node-2 namespace join failed"; echo "$JOIN_RES" >&2; exit 1; }

  # ── Sync namespace to node-2 ──────────────────────────────────────────────

  step "Syncing namespace to node-2"
  curl -sf -X POST "${NODE_2_URL}/admin-api/groups/${GROUP_ID}/sync" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
    -H "Content-Type: application/json" -d '{}' &>/dev/null \
    && green "Namespace sync triggered" || yellow "Namespace sync failed (non-fatal)"

  # ── Sync general subgroup to node-2 ──────────────────────────────────────

  step "Syncing general subgroup to node-2"
  curl -sf -X POST "${NODE_2_URL}/admin-api/groups/${GENERAL_GROUP_ID}/sync" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
    -H "Content-Type: application/json" -d '{}' &>/dev/null \
    && green "General subgroup sync triggered" || yellow "General subgroup sync failed (non-fatal)"

  # ── Node-2 joins all contexts in the general subgroup ────────────────────

  step "Node-2 joining general subgroup contexts"
  CTXS_LIST=$(curl -sf "${NODE_2_URL}/admin-api/groups/${GENERAL_GROUP_ID}/contexts" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null \
    | jq -r '(.data // .) | if type=="array" then .[].contextId // .[].id else empty end' 2>/dev/null || true)

  MEMBER_KEY_2=""
  for ctx_id in $CTXS_LIST; do
    JOIN_CTX=$(curl -sf -X POST "${NODE_2_URL}/admin-api/contexts/${ctx_id}/join" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
      -H "Content-Type: application/json" -d '{}' 2>/dev/null) || JOIN_CTX="{}"
    mk=$(echo "$JOIN_CTX" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
    [ -n "$mk" ] && [ "$ctx_id" = "$CONTEXT_ID" ] && MEMBER_KEY_2="$mk"
    green "Node-2 joined context ${ctx_id}"
  done

  # Fall back: fetch identity-owned for the general context
  if [ -z "$MEMBER_KEY_2" ]; then
    MEMBER_KEY_2=$(curl -sf "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' 2>/dev/null || true)
  fi
  [ -n "$MEMBER_KEY_2" ] || { red "ERROR: could not get MEMBER_KEY_2"; exit 1; }
  green "MEMBER_KEY_2 (node-2 identity): $MEMBER_KEY_2"

  # ── Wait for context to be accessible on node-2 ───────────────────────────

  step "Waiting for context to be accessible on node-2"
  for i in $(seq 1 30); do
    CTXS_2=$(curl -sf "${NODE_2_URL}/admin-api/groups/${GENERAL_GROUP_ID}/contexts" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null) || CTXS_2="{}"
    if echo "$CTXS_2" | jq -e \
        --arg id "$CONTEXT_ID" \
        '(.data // .) | if type=="array" then .[] | select(.contextId==$id or .id==$id) else empty end' \
        >/dev/null 2>&1; then
      green "Context accessible on node-2 (attempt $i)"
      break
    fi
    if [ "$i" -eq 30 ]; then yellow "WARNING: context may not be visible on node-2 yet"; fi
    sleep 2
  done

  # ── Set member aliases (nicknames) and app-level profiles ─────────────────

  step "Setting member aliases and profiles (Alice / Bob)"

  # Namespace-level alias (shown in workspace member list)
  NS_MEMBER_1=$(curl -sf "${NODE_1_URL}/admin-api/groups/${GROUP_ID}/members" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null \
    | jq -r '(.data // .) | if type=="array" then .[0].identity else empty end' 2>/dev/null || true)
  if [ -n "$NS_MEMBER_1" ]; then
    curl -sf -X PUT "${NODE_1_URL}/admin-api/groups/${GROUP_ID}/members/${NS_MEMBER_1}/alias" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" -H "Content-Type: application/json" \
      -d '{"alias":"Alice"}' &>/dev/null && green "Alice alias set on namespace" || true
  fi

  # App-level profile via WASM RPC (used for message sender display)
  rpc_call "$NODE_1_URL" "$ACCESS_TOKEN_1" "$CONTEXT_ID" "$MEMBER_KEY_1" \
    "set_profile" '{"username":"Alice","avatar":null}'
  rpc_call "$NODE_2_URL" "$ACCESS_TOKEN_2" "$CONTEXT_ID" "$MEMBER_KEY_2" \
    "set_profile" '{"username":"Bob","avatar":null}'
  green "Profiles set"

  # ── Seed messages ─────────────────────────────────────────────────────────

  step "Seeding messages"
  rpc_call "$NODE_1_URL" "$ACCESS_TOKEN_1" "$CONTEXT_ID" "$MEMBER_KEY_1" \
    "send_message" \
    '{"message":"Hello from Alice — integration test seed","mentions":[],"mentions_usernames":[],"parent_message":null,"timestamp":1751953010,"sender_username":"Alice","files":null,"images":null}'
  rpc_call "$NODE_2_URL" "$ACCESS_TOKEN_2" "$CONTEXT_ID" "$MEMBER_KEY_2" \
    "send_message" \
    '{"message":"Hello from Bob — integration test seed","mentions":[],"mentions_usernames":[],"parent_message":null,"timestamp":1751953011,"sender_username":"Bob","files":null,"images":null}'
  green "Seed messages sent"

  MEMBER_KEY="$MEMBER_KEY_1"
fi

# ── Discover IDs (merobox path — merod path already has them) ─────────────────

if $USE_MEROBOX; then
  step "Resolving workspace and context IDs"

  GROUPS_RES=$(curl -sf "${NODE_1_URL}/admin-api/groups" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null) || GROUPS_RES="{}"
  GROUP_ID=$(echo "$GROUPS_RES" | jq -r '
    (.data // .) |
    if type=="array" then .[0].groupId
    elif type=="object" then (.groups[0].groupId // .items[0].groupId)
    else empty end' 2>/dev/null || echo "")

  if [ -z "$GROUP_ID" ]; then
    NS_RES=$(curl -sf "${NODE_1_URL}/admin-api/namespaces" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null) || NS_RES="{}"
    GROUP_ID=$(echo "$NS_RES" | jq -r '
      (.data // .) |
      if type=="array" then .[0].id // .[0].namespaceId // .[0].groupId
      elif type=="object" then (.namespaces[0].id // .items[0].id)
      else empty end' 2>/dev/null || echo "")
  fi
  [ -n "$GROUP_ID" ] && green "GROUP_ID: $GROUP_ID" || yellow "WARNING: could not discover GROUP_ID"

  CTX_RES2=$(curl -sf "${NODE_1_URL}/admin-api/contexts" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null) || CTX_RES2="{}"
  CONTEXT_ID=$(echo "$CTX_RES2" | jq -r '
    (.data // .) |
    if type=="array" then .[0].id // .[0].contextId
    elif type=="object" then (.contexts[0].id // .contexts[0].contextId // .items[0].id)
    else empty end' 2>/dev/null || echo "")
  [ -n "$CONTEXT_ID" ] && green "CONTEXT_ID: $CONTEXT_ID" || yellow "WARNING: could not discover CONTEXT_ID"

  IDENT_RES2=$(curl -sf "${NODE_1_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null) || IDENT_RES2="{}"
  MEMBER_KEY=$(echo "$IDENT_RES2" | jq -r '
    (.data // .) |
    if type=="array" then .[0]
    elif type=="object" then (.identities[0] // .items[0])
    else empty end' 2>/dev/null || echo "")
  [ -n "$MEMBER_KEY" ] && green "MEMBER_KEY: $MEMBER_KEY" || yellow "WARNING: could not discover MEMBER_KEY"

  IDENT_RES3=$(curl -sf "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null) || IDENT_RES3="{}"
  MEMBER_KEY_2=$(echo "$IDENT_RES3" | jq -r '
    (.data // .) |
    if type=="array" then .[0]
    elif type=="object" then (.identities[0] // .items[0])
    else empty end' 2>/dev/null || echo "")
  [ -n "$MEMBER_KEY_2" ] && green "MEMBER_KEY_2: $MEMBER_KEY_2" || yellow "WARNING: could not discover MEMBER_KEY_2"
fi

# ── Write app/.env.integration ────────────────────────────────────────────────

step "Writing $ENV_OUT"

cat > "$ENV_OUT" <<EOF
# Generated by scripts/setup-nodes.sh — DO NOT COMMIT (contains live tokens)
# Re-run: ./scripts/setup-nodes.sh

E2E_NODE_URL=${NODE_1_URL}
E2E_NODE_URL_2=${NODE_2_URL}

E2E_ACCESS_TOKEN=${ACCESS_TOKEN_1}
E2E_REFRESH_TOKEN=${REFRESH_TOKEN_1}

E2E_ACCESS_TOKEN_2=${ACCESS_TOKEN_2}
E2E_REFRESH_TOKEN_2=${REFRESH_TOKEN_2}

E2E_GROUP_ID=${GROUP_ID:-}
E2E_CONTEXT_GROUP_ID=${GENERAL_GROUP_ID:-${GROUP_ID:-}}
E2E_CONTEXT_ID=${CONTEXT_ID:-}
E2E_MEMBER_KEY=${MEMBER_KEY:-}
E2E_MEMBER_KEY_2=${MEMBER_KEY_2:-}
EOF

green "Written: $ENV_OUT"

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n'
bold "══════════════════════════════════════════"
bold " Integration nodes ready"
bold "══════════════════════════════════════════"
printf '\n'
printf "  Node 1:      %s\n" "$NODE_1_URL"
printf "  Node 2:      %s\n" "$NODE_2_URL"
printf "  Group ID:    %s\n" "${GROUP_ID:-<unknown>}"
printf "  Context ID:  %s\n" "${CONTEXT_ID:-<unknown>}"
printf "  Env file:    %s\n" "$ENV_OUT"
printf '\n'
printf "  Run integration tests:\n"
printf "    cd app && pnpm exec playwright test --project=integration\n"
printf '\n'
printf "  Stop nodes when done:\n"
printf "    ./scripts/setup-nodes.sh --stop\n"
printf '\n'
