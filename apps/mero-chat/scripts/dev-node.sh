#!/usr/bin/env bash
# scripts/dev-node.sh — Start a single local merod node for development.
#
# Usage:
#   ./scripts/dev-node.sh           # start node, install app, print login info
#   ./scripts/dev-node.sh --stop    # stop the node
#   ./scripts/dev-node.sh --clean   # --stop + delete node home directory
#   ./scripts/dev-node.sh --help
#
# After this script finishes, run:
#   make dev        ← starts the Vite frontend at http://localhost:5173
#
# Then open http://localhost:5173 in your browser and log in:
#   Node URL:   http://localhost:2428
#   Username:   admin
#   Password:   (printed at the end of this script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="curb-dev"
NODE_HOME="${CURB_DEV_NODE_HOME:-$HOME/.calimero/curb-dev}"
NODE_PORT="${CURB_DEV_PORT:-2428}"
NODE_P2P_PORT="${CURB_DEV_P2P_PORT:-2528}"
NODE_URL="http://localhost:${NODE_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/curb.wasm"

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

pid_file() { echo "/tmp/curb-dev-node.pid"; }

# ── Parse args ────────────────────────────────────────────────────────────────

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)   STOP=true ;;
    --clean)  STOP=true; CLEAN=true ;;
    --help|-h)
      sed -n '3,12p' "${BASH_SOURCE[0]}"
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

for cmd in merod jq curl; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done

# ── Nuke existing node (always start fresh) ──────────────────────────────────

step "Nuking existing node (clean slate)"
nuke_node
green "Clean slate ready"

# ── Build WASM if needed ──────────────────────────────────────────────────────

step "Checking WASM"
if [ ! -f "$WASM_PATH" ]; then
  yellow "curb.wasm not found — building (first run is slow)…"
  (cd "$REPO_ROOT/logic" && bash build.sh)
  green "curb.wasm built"
else
  green "curb.wasm exists"
fi

# ── Init node (idempotent) ────────────────────────────────────────────────────

step "Initialising node at $NODE_HOME"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded
green "Node initialised"

# ── Patch CORS — allow all localhost origins for dev ─────────────────────────

CONFIG_FILE="$NODE_HOME/${NODE_NAME}/config.toml"
if [ -f "$CONFIG_FILE" ]; then
  python3 - "$CONFIG_FILE" <<'PYEOF'
import sys, re
path = sys.argv[1]
txt  = open(path).read()
txt  = re.sub(r'allow_all_origins\s*=\s*false', 'allow_all_origins = true',  txt)
txt  = re.sub(r'allowed_origins\s*=\s*\[\]',   'allowed_origins = []',        txt)
open(path, 'w').write(txt)
PYEOF
  green "CORS patched (allow_all_origins = true)"
fi

# ── Start node ────────────────────────────────────────────────────────────────

step "Starting node"
merod --node "$NODE_NAME" --home "$NODE_HOME" run \
  > "/tmp/curb-dev-node.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node started (pid $!  logs: /tmp/curb-dev-node.log)"
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
[ -n "$ACCESS_TOKEN" ] || { red "Auth failed — check credentials (E2E_ADMIN_USER / E2E_ADMIN_PASS)"; echo "$AUTH_RES" >&2; exit 1; }
green "Authenticated as '${ADMIN_USER}'"

# ── Register with meroctl (optional — not needed for dev workflow) ────────────

if command -v meroctl &>/dev/null; then
  meroctl node remove "$NODE_NAME" 2>/dev/null || true
  meroctl node add "$NODE_NAME" "$NODE_HOME" \
    --access-token  "$ACCESS_TOKEN" \
    --refresh-token "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')" \
    2>/dev/null && green "Registered with meroctl" || yellow "meroctl registration skipped (non-fatal)"
fi

# ── Install app via REST ──────────────────────────────────────────────────────

step "Installing curb app"
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

# ── Create workspace + channel ────────────────────────────────────────────────

step "Setting up workspace and channels"

NAMESPACE_ID=""
CONTEXT_ID=""
MEMBER_KEY=""

# Create namespace via REST API
NS_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg a "$APP_ID" '{applicationId: $a, upgradePolicy: "LazyOnAccess", alias: "Dev Workspace"}')" \
  2>/dev/null) || NS_RES="{}"
NAMESPACE_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty' 2>/dev/null || true)

# Fall back to meroctl if direct API failed
if [ -z "$NAMESPACE_ID" ]; then
  NS_OUTPUT=$(meroctl --node "$NODE_NAME" --output-format json namespace create \
    --application-id "$APP_ID" --upgrade-policy automatic --alias "Dev Workspace" 2>/dev/null) || true
  NAMESPACE_ID=$(echo "$NS_OUTPUT" | jq -r '.namespaceId // .data.namespaceId // empty' 2>/dev/null || true)
fi

if [ -n "$NAMESPACE_ID" ]; then
  green "Workspace created (id: ${NAMESPACE_ID})"

  # ── Permission model (rc.37+, 1-group-per-context) ─────────────────────────
  # Each channel/DM = its own subgroup under the namespace root, with one
  # context inside. Members hold caps at the *namespace* level that let them
  # start (and clean up) their own channel-groups:
  #   1   CAN_CREATE_CONTEXT       — inside their own subgroup (they're admin)
  #   2   CAN_INVITE_MEMBERS       — invite into the workspace
  #   4   CAN_JOIN_OPEN_SUBGROUPS  — auto-join open channels
  #  32   CAN_CREATE_SUBGROUP      — create a channel-group at root (rc.37)
  #  64   CAN_DELETE_SUBGROUP      — delete a channel-group they own (rc.37)
  # 128   CAN_MANAGE_VISIBILITY    — flip open↔restricted on their group (rc.37)
  # Total = 231.
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/default-capabilities" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"defaultCapabilities":231}' &>/dev/null \
    && green "Namespace member caps set (231 = create/delete subgroup + manage visibility + create context + invite + join-open)" \
    || yellow "Could not set namespace caps (non-fatal)"

  # Namespace's own subgroup-visibility = open so all child channel-groups are
  # discoverable / joinable by namespace members via parent-walk.
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/subgroup-visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"subgroupVisibility":"open"}' &>/dev/null || true

  # ── #general = standalone open subgroup + one context inside ───────────────
  step "Creating #general (open subgroup + context)"

  GEN_SG_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces/${NAMESPACE_ID}/groups" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"groupAlias":"general"}' 2>/dev/null) || GEN_SG_RES="{}"
  GENERAL_SG_ID=$(echo "$GEN_SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null)
  if [ -z "$GENERAL_SG_ID" ]; then
    yellow "Could not create #general subgroup — skipped"
  else
    green "  general subgroup: $GENERAL_SG_ID"

    # Open visibility so all namespace members auto-join the channel.
    curl -sf -X PUT "${NODE_URL}/admin-api/groups/${GENERAL_SG_ID}/settings/subgroup-visibility" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
      -d '{"subgroupVisibility":"open"}' &>/dev/null || true

    TIMESTAMP=$(date +%s)
    INIT_JSON="{\"name\":\"general\",\"context_type\":\"Channel\",\"description\":\"\",\"created_at\":${TIMESTAMP},\"creator_username\":\"\"}"
    INIT_BYTES=$(printf '%s' "$INIT_JSON" | python3 -c \
      "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')" 2>/dev/null || echo "[]")

    CTX_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/contexts" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$(jq -n \
            --arg appId "$APP_ID" \
            --arg groupId "$GENERAL_SG_ID" \
            --argjson initParams "$INIT_BYTES" \
            '{applicationId: $appId, protocol: "near", groupId: $groupId, alias: "general", initializationParams: $initParams}')" \
      2>/dev/null) || CTX_RES="{}"
    CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
    MEMBER_KEY=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)

    if [ -n "$CONTEXT_ID" ]; then
      green "  general context: ${CONTEXT_ID}"
      curl -sf -X PUT "${NODE_URL}/admin-api/groups/${GENERAL_SG_ID}/contexts/${CONTEXT_ID}/visibility" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
        -d '{"mode":"open"}' &>/dev/null || true
    else
      yellow "  Could not create #general context"
    fi
  fi
else
  yellow "Could not create workspace — create one from the app after logging in"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

printf '\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Dev node ready\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
# ── Write .env.integration for Playwright ────────────────────────────────────

ENV_FILE="$REPO_ROOT/app/.env.integration"
{
  printf 'E2E_NODE_URL=%s\n'        "$NODE_URL"
  printf 'E2E_ACCESS_TOKEN=%s\n'   "$ACCESS_TOKEN"
  printf 'E2E_REFRESH_TOKEN=%s\n'  "$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')"
  printf 'E2E_NODE_URL_2=\n'
  printf 'E2E_ACCESS_TOKEN_2=\n'
  printf 'E2E_REFRESH_TOKEN_2=\n'
  printf 'E2E_GROUP_ID=%s\n'       "${NAMESPACE_ID:-}"
  printf 'E2E_CONTEXT_ID=%s\n'     "${CONTEXT_ID:-}"
  printf 'E2E_MEMBER_KEY=%s\n'     "${MEMBER_KEY:-}"
  printf 'E2E_MEMBER_KEY_2=\n'
} > "$ENV_FILE"
green "Wrote $ENV_FILE"

printf '\n'
printf '  Node URL:   \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Username:   \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:   \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  App ID:     %s\n' "$APP_ID"
if [ -n "${NAMESPACE_ID:-}" ]; then
  printf '  Workspace:  %s\n' "$NAMESPACE_ID"
fi
if [ -n "${CONTEXT_ID:-}" ]; then
  printf '  Channel:    %s  (#general)\n' "$CONTEXT_ID"
fi
if [ -n "${MEMBER_KEY:-}" ]; then
  printf '  Identity:   %s\n' "$MEMBER_KEY"
fi
printf '  Logs:       /tmp/curb-dev-node.log\n'
printf '\n'
printf '  Next step:\n'
printf '    \033[36mmake dev\033[0m   →  open http://localhost:5173, connect to %s\n' "$NODE_URL"
printf '\n'
printf '  When done:\n'
printf '    \033[36m./scripts/dev-node.sh --stop\033[0m\n'
printf '\n'
