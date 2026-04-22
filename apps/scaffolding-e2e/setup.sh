#!/usr/bin/env bash
# setup.sh — Calimero E2E Scaffolding App: automated backend setup
#
# Usage:
#   ./setup.sh              # single node (Node A only), uses merod directly
#   ./setup.sh --two-nodes  # Node A + Node B, joins namespace and context
#   ./setup.sh --merobox    # use merobox to manage nodes (Docker or --no-docker)
#   ./setup.sh --stop       # kill running merod/merobox processes
#   ./setup.sh --clean      # stop + delete node home directories
#
# Credentials (override via env):
#   CALIMERO_ADMIN_USER=admin   CALIMERO_ADMIN_PASS=calimero1234
#
# Auth is bootstrapped automatically on a fresh node — no browser needed.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

NODE_A_HOME="${CALIMERO_HOME_A:-$HOME/.calimero/node-a}"
NODE_B_HOME="${CALIMERO_HOME_B:-$HOME/.calimero/node-b}"
NODE_A_PORT="${CALIMERO_PORT_A:-2528}"
NODE_B_PORT="${CALIMERO_PORT_B:-2529}"
NODE_A_P2P_PORT="${CALIMERO_P2P_PORT_A:-2628}"
NODE_B_P2P_PORT="${CALIMERO_P2P_PORT_B:-2629}"
ADMIN_USER="${CALIMERO_ADMIN_USER:-admin}"
ADMIN_PASS="${CALIMERO_ADMIN_PASS:-calimero1234}"  # min 8 chars
LOGIC_MPK="logic/res/e2e-kv-store-1.0.0.mpk"
ENV_FILE="frontend/.env"
ENV_EXAMPLE="frontend/.env.example"

TWO_NODES=false
STOP=false
CLEAN=false
USE_MEROBOX=false

for arg in "$@"; do
  case "$arg" in
    --two-nodes) TWO_NODES=true ;;
    --stop)      STOP=true ;;
    --clean)     CLEAN=true ;;
    --merobox)   USE_MEROBOX=true ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    red "ERROR: '$1' not found in PATH."
    if [ "$1" = "merod" ] || [ "$1" = "meroctl" ]; then
      yellow "Run: ./install-calimero.sh  (then restart your terminal)"
    elif [ "$1" = "jq" ]; then
      yellow "Install jq: brew install jq  (macOS) or apt install jq (Linux)"
    elif [ "$1" = "merobox" ]; then
      yellow "Install merobox: pip install merobox"
    fi
    exit 1
  fi
}

node_is_running() {
  local port=$1
  curl -sf "http://127.0.0.1:${port}/admin-api/health" &>/dev/null
}

wait_for_node() {
  local port=$1 label=$2
  printf "Waiting for %s (port %s)" "$label" "$port"
  for i in $(seq 1 60); do
    if node_is_running "$port"; then printf ' ready\n'; return; fi
    printf '.'
    sleep 1
  done
  printf '\n'
  red "ERROR: $label did not become healthy after 60s"
  exit 1
}

pid_file() { echo "/tmp/merod-$1.pid"; }

# ── Auth bootstrap ─────────────────────────────────────────────────────────────
# Calls POST /auth/token with user/password credentials.
# On a fresh node (no root keys) this creates the first admin user (bootstrap).
# On an existing node it simply authenticates.
# Returns tokens in NODE_ACCESS_TOKEN / NODE_REFRESH_TOKEN globals.

NODE_ACCESS_TOKEN=""
NODE_REFRESH_TOKEN=""

bootstrap_auth() {
  local port=$1 node_name=$2

  step "Authenticating $node_name as '${ADMIN_USER}'"

  local res
  res=$(curl -sf -X POST "http://127.0.0.1:${port}/auth/token" \
    -H "Content-Type: application/json" \
    -d "{\"auth_method\":\"user_password\",\"public_key\":\"${ADMIN_USER}\",\"client_name\":\"setup.sh\",\"timestamp\":0,\"permissions\":[],\"provider_data\":{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}}" \
    2>/dev/null) || true

  NODE_ACCESS_TOKEN=$(echo "$res" | jq -r '.data.access_token // empty' 2>/dev/null)
  NODE_REFRESH_TOKEN=$(echo "$res" | jq -r '.data.refresh_token // empty' 2>/dev/null)

  if [ -z "$NODE_ACCESS_TOKEN" ]; then
    red "ERROR: Auth failed for $node_name."
    yellow "Response: $res"
    yellow "Check credentials: CALIMERO_ADMIN_USER=${ADMIN_USER} CALIMERO_ADMIN_PASS=***"
    exit 1
  fi

  green "Authenticated as '${ADMIN_USER}'"
}

# Register a node with meroctl, injecting fresh tokens so no browser prompt is needed.
# Removes any stale registration first to avoid the "already exists" error.
register_node() {
  local name=$1 home=$2
  meroctl node remove "$name" 2>/dev/null || true
  meroctl node add "$name" "$home" \
    --access-token  "$NODE_ACCESS_TOKEN" \
    --refresh-token "$NODE_REFRESH_TOKEN" \
    2>/dev/null && green "$name registered with meroctl" || yellow "$name could not be registered"
}

# ── merod node management ─────────────────────────────────────────────────────

start_node_merod() {
  local name=$1 home=$2 port=$3 p2p_port=$4

  if node_is_running "$port"; then
    yellow "$name already running on port $port"
    bootstrap_auth "$port" "$name"
    register_node "$name" "$home"
    return
  fi

  if [ ! -d "$home" ]; then
    step "Initializing $name at $home"
    merod --node "$name" --home "$home" init \
      --server-host 127.0.0.1 \
      --server-port "$port" \
      --swarm-port "$p2p_port" \
      --auth-mode embedded
  fi

  step "Starting $name"
  merod --node "$name" --home "$home" run > "/tmp/merod-${name}.log" 2>&1 &
  echo $! > "$(pid_file "$name")"
  wait_for_node "$port" "$name"
  green "$name running (pid $!, logs: /tmp/merod-${name}.log)"

  bootstrap_auth "$port" "$name"
  register_node "$name" "$home"
}

stop_node_merod() {
  local name=$1
  local pf; pf=$(pid_file "$name")
  if [ -f "$pf" ]; then
    local pid; pid=$(cat "$pf")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && yellow "Stopped $name (pid $pid)"
    fi
    rm -f "$pf"
  fi
  pkill -f "merod --node ${name}" 2>/dev/null || true
}

# ── merobox node management ───────────────────────────────────────────────────
# Nodes are started via `merobox run --no-docker`.  merobox names them
# calimero-node-1, calimero-node-2, etc.  We register them with meroctl under
# our canonical names (node-a, node-b) after getting their ports.

MEROBOX_NODE_A_NAME="calimero-node-1"
MEROBOX_NODE_B_NAME="calimero-node-2"

start_node_merobox() {
  local name=$1 port=$2 p2p_port=$3 home=$4 mbox_name=$5

  if node_is_running "$port"; then
    yellow "$mbox_name already running on port $port"
  else
    step "Starting $mbox_name via merobox"
    merobox run --no-docker \
      --prefix "calimero-node" \
      --base-rpc-port "$port" \
      --base-port "$p2p_port" \
      --data-dir "$home" \
      --auth-mode embedded \
      -c 1 &>/tmp/merobox-${name}.log &
    wait_for_node "$port" "$mbox_name"
    green "$mbox_name running (logs: /tmp/merobox-${name}.log)"
  fi

  bootstrap_auth "$port" "$name"
  register_node "$name" "$home"
}

stop_node_merobox() {
  local mbox_name=$1
  merobox stop --name "$mbox_name" 2>/dev/null || true
}

# ── Unified wrappers (dispatch to merod or merobox) ───────────────────────────

start_node() {
  local name=$1 home=$2 port=$3 p2p_port=$4
  if $USE_MEROBOX; then
    local mbox_name
    mbox_name=$([ "$name" = "node-a" ] && echo "$MEROBOX_NODE_A_NAME" || echo "$MEROBOX_NODE_B_NAME")
    start_node_merobox "$name" "$port" "$p2p_port" "$home" "$mbox_name"
  else
    start_node_merod "$name" "$home" "$port" "$p2p_port"
  fi
}

stop_node() {
  local name=$1
  if $USE_MEROBOX; then
    local mbox_name
    mbox_name=$([ "$name" = "node-a" ] && echo "$MEROBOX_NODE_A_NAME" || echo "$MEROBOX_NODE_B_NAME")
    stop_node_merobox "$mbox_name"
  else
    stop_node_merod "$name"
  fi
}

# ── Stop / Clean ──────────────────────────────────────────────────────────────

if $STOP || $CLEAN; then
  step "Stopping nodes"
  stop_node "node-a"
  stop_node "node-b"
  if $CLEAN; then
    step "Removing node homes"
    rm -rf "$NODE_A_HOME" "$NODE_B_HOME"
    yellow "Removed $NODE_A_HOME and $NODE_B_HOME"
    step "Deregistering nodes from meroctl"
    meroctl node remove node-a 2>/dev/null && yellow "Removed node-a from meroctl" || true
    meroctl node remove node-b 2>/dev/null && yellow "Removed node-b from meroctl" || true
  fi
  green "Done."
  exit 0
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────

step "Checking prerequisites"
if $USE_MEROBOX; then
  check_cmd merobox
  check_cmd meroctl
else
  check_cmd merod
  check_cmd meroctl
fi
check_cmd jq
check_cmd python3
green "All tools found"

# ── Build the app bundle ──────────────────────────────────────────────────────

if [ ! -f "$LOGIC_MPK" ]; then
  step "Building app bundle (Rust + WASM — first run is slow)"
  if [ ! -f "logic/build-bundle.sh" ]; then
    red "ERROR: logic/build-bundle.sh not found. Run this script from the repo root."
    exit 1
  fi
  (cd logic && bash build-bundle.sh)
  green "Bundle built: $LOGIC_MPK"
else
  green "App bundle already exists: $LOGIC_MPK"
fi

# ── Node A ────────────────────────────────────────────────────────────────────

start_node "node-a" "$NODE_A_HOME" "$NODE_A_PORT" "$NODE_A_P2P_PORT"

step "Installing app on node-a"
APP_ID=$(meroctl --node node-a --output-format json app install \
  --path "$LOGIC_MPK" 2>/dev/null \
  | jq -r 'if type == "object" then (.applicationId // .data.applicationId // empty) else empty end' 2>/dev/null)

if [ -z "$APP_ID" ]; then
  yellow "App already installed — fetching existing app ID"
  APP_ID=$(meroctl --node node-a --output-format json app ls \
    | jq -r '.apps[0].id // .data.apps[0].id // .data.applications[0].id // empty')
fi

if [ -z "$APP_ID" ]; then
  red "ERROR: Could not get APP_ID from meroctl. Check node-a logs: /tmp/merod-node-a.log"
  exit 1
fi
green "APP_ID: $APP_ID"

step "Creating namespace on node-a"
NS_ID=$(meroctl --node node-a --output-format json namespace create \
  --application-id "$APP_ID" \
  | jq -r '.namespaceId // .data.namespaceId // empty')

if [ -z "$NS_ID" ]; then
  yellow "Namespace may already exist — listing"
  NS_ID=$(meroctl --node node-a --output-format json namespace ls \
    | jq -r '.namespaces[0].id // .data[0].namespace_id // empty')
fi

if [ -z "$NS_ID" ]; then
  red "ERROR: Could not get NS_ID"
  exit 1
fi
green "NS_ID: $NS_ID"

step "Creating context on node-a"
CTX_ID=$(meroctl --node node-a --output-format json context create \
  --group-id "$NS_ID" \
  --application-id "$APP_ID" \
  | jq -r '.contextId // .data.contextId // empty')

if [ -z "$CTX_ID" ]; then
  yellow "Context may already exist — listing"
  CTX_ID=$(meroctl --node node-a --output-format json context ls \
    | jq -r '.contexts[0].id // .data.contexts[0].id // empty')
fi

if [ -z "$CTX_ID" ]; then
  red "ERROR: Could not get CTX_ID"
  exit 1
fi
green "CTX_ID: $CTX_ID"

# ── Node B (optional) ─────────────────────────────────────────────────────────

if $TWO_NODES; then
  start_node "node-b" "$NODE_B_HOME" "$NODE_B_PORT" "$NODE_B_P2P_PORT"

  step "Installing app on node-b"
  meroctl --node node-b app install --path "$LOGIC_MPK" >/dev/null 2>&1 || yellow "App already on node-b"

  step "Generating namespace invitation from node-a"
  INVITE_RAW=$(meroctl --node node-a --output-format json namespace invite "$NS_ID")
  # invite outputs { data: { invitation: SignedGroupOpenInvitation } } — extract the inner object
  INVITE=$(echo "$INVITE_RAW" | jq -c '.data.invitation')

  step "node-b joining namespace"
  meroctl --node node-b namespace join "$NS_ID" "$INVITE"

  step "node-b joining context"
  meroctl --node node-b group join-context "$CTX_ID"

  green "Node B is now a member of the namespace and context"
fi

# ── Frontend .env ─────────────────────────────────────────────────────────────

step "Writing frontend/.env"
if [ ! -f "$ENV_EXAMPLE" ]; then
  yellow ".env.example not found — creating .env from scratch"
  cat > "$ENV_FILE" <<EOF
VITE_NODE_URL=http://localhost:${NODE_A_PORT}
VITE_APP_ID=${APP_ID}
VITE_ADMIN_USER=${ADMIN_USER}
VITE_ADMIN_PASS=${ADMIN_PASS}
EOF
else
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  patch_env() {
    local key=$1 val=$2
    if grep -q "^${key}=" "$ENV_FILE"; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    else
      echo "${key}=${val}" >> "$ENV_FILE"
    fi
  }
  patch_env "VITE_NODE_URL"    "http://localhost:${NODE_A_PORT}"
  patch_env "VITE_APP_ID"      "$APP_ID"
  patch_env "VITE_ADMIN_USER"  "$ADMIN_USER"
  patch_env "VITE_ADMIN_PASS"  "$ADMIN_PASS"
  rm -f "${ENV_FILE}.bak"
fi
green "Wrote $ENV_FILE"

step "Syncing WASM into frontend/public"
if [ -f "frontend/package.json" ]; then
  (cd frontend && npm run sync-wasm 2>/dev/null || true)
fi

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n'
bold "═══════════════════════════════════════════════════════"
bold " Setup complete"
bold "═══════════════════════════════════════════════════════"
printf '\n'
printf "  APP_ID   %s\n" "$APP_ID"
printf "  NS_ID    %s\n" "$NS_ID"
printf "  CTX_ID   %s\n" "$CTX_ID"
printf '\n'
printf "  Node A:  http://localhost:%s\n" "$NODE_A_PORT"
if $USE_MEROBOX; then
  printf "           (logs: /tmp/merobox-node-a.log)\n"
else
  printf "           (logs: /tmp/merod-node-a.log)\n"
fi
if $TWO_NODES; then
  printf "  Node B:  http://localhost:%s\n" "$NODE_B_PORT"
  if $USE_MEROBOX; then
    printf "           (logs: /tmp/merobox-node-b.log)\n"
  else
    printf "           (logs: /tmp/merod-node-b.log)\n"
  fi
fi
printf '\n'
printf "  Auth:    user='%s'  pass='%s'\n" "$ADMIN_USER" "$ADMIN_PASS"
printf "           (override: CALIMERO_ADMIN_USER / CALIMERO_ADMIN_PASS)\n"
printf '\n'
bold "Next steps:"
printf '\n'
printf "  1. cd frontend && npm install && npm run dev\n"
printf '\n'
printf "  2. Open Tab A:  http://localhost:5173?node=http://localhost:%s\n" "$NODE_A_PORT"
if $TWO_NODES; then
  printf "     Open Tab B:  http://localhost:5173?node=http://localhost:%s\n" "$NODE_B_PORT"
  printf '\n'
  printf "  3. In each tab: connect with user/pass above, then select context:\n"
  printf "     CTX_ID: %s\n" "$CTX_ID"
  printf '\n'
  printf "  4. Write a KV key in Tab A — it should appear in Tab B within ~3s.\n"
else
  printf '\n'
  printf "  3. Log in with the credentials above, select the context shown.\n"
  printf "  4. Run again with --two-nodes to add a second node for CRDT sync testing.\n"
fi
printf '\n'
if $TWO_NODES; then
  bold "Sync Test server (optional — needed for the Sync Test tab):"
  printf '\n'
  printf "  cd sync-test-server && node server.js\n"
  printf "  Starts a coordination server on http://localhost:3099\n"
  printf "  Used by the Sync Test tab to coordinate writes/reads between Tab A and Tab B.\n"
  printf '\n'
fi
