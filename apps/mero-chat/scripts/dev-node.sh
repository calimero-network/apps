#!/usr/bin/env bash
# scripts/dev-node.sh — Start a local merod node for development.
#
# Usage:
#   ./scripts/dev-node.sh              # primary node: app + workspace + #general
#   ./scripts/dev-node.sh --secondary  # second participant, no workspace
#   ./scripts/dev-node.sh --stop       # stop the node
#   ./scripts/dev-node.sh --clean      # --stop + delete node home directory
#   ./scripts/dev-node.sh --help
#
# `--secondary` (also reachable as ./scripts/dev-node2.sh) runs a second node on
# its own ports and home, installs the SAME bundle, and bootstraps straight to
# the primary — but deliberately creates no workspace, so you can invite it from
# the web app and exercise the P2P invitation flow.
#
# After this script finishes, run:
#   make dev        ← starts the Vite frontend at http://localhost:5173
#
# Then open http://localhost:5173 in your browser and log in with the node URL,
# username and password printed at the end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Role ──────────────────────────────────────────────────────────────────────
# One implementation, two roles. They previously lived in two ~250-line scripts
# that had drifted: every fix had to be made twice, and when one of them was
# missed the symptom was remote from the cause (installing the raw wasm on the
# secondary gave it a DIFFERENT application id, so the two nodes could never
# share a context).

SECONDARY=false
for arg in "$@"; do
  case "$arg" in
    --secondary|--node2) SECONDARY=true ;;
  esac
done

# Which merod to run. Defaults to PATH, but a Homebrew merod is easily years
# behind this repo's toolchain (cargo-mero is pinned to 0.11.0-rc.20): an old
# binary mints a root key without newer permissions, and login then fails with
# "Root key does not have permission: namespace". Point this at a locally built
# merod to match:
#   MEROD_BIN=../core/target/release/merod ./scripts/dev-node.sh
MEROD_BIN="${MEROD_BIN:-merod}"

if $SECONDARY; then
  LABEL="node2"
  NODE_NAME="curb-dev-2"
  NODE_HOME="${CURB_DEV_NODE2_HOME:-$HOME/.calimero/curb-dev-2}"
  NODE_PORT="${CURB_DEV_PORT2:-2429}"
  NODE_P2P_PORT="${CURB_DEV_P2P_PORT2:-2529}"
  PID_FILE="/tmp/curb-dev-node2.pid"
else
  LABEL="node"
  NODE_NAME="curb-dev"
  NODE_HOME="${CURB_DEV_NODE_HOME:-$HOME/.calimero/curb-dev}"
  NODE_PORT="${CURB_DEV_PORT:-2428}"
  NODE_P2P_PORT="${CURB_DEV_P2P_PORT:-2528}"
  PID_FILE="/tmp/curb-dev-node.pid"
fi
# 127.0.0.1, not localhost: the node is started with `--server-host 127.0.0.1`
# so it only ever binds IPv4 loopback. `localhost` resolves to ::1 first, and
# curl only falls back to IPv4 when nothing answers on ::1 — so if any other
# process holds ::1 on this port (Calimero Desktop bundles its own merod) every
# request silently goes to the wrong node.
NODE_URL="http://127.0.0.1:${NODE_PORT}"
LOG_FILE="/tmp/curb-dev-$([ "$SECONDARY" = true ] && echo node2 || echo node).log"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

WASM_PATH="$REPO_ROOT/logic/res/curb.wasm"

# Bundle filename is "<last dotted segment of package>-<version>.mpk", matching
# logic/build-bundle.sh. Both read the package from [package.metadata.calimero]
# so the two never drift.
BUNDLE_VERSION="${APP_VERSION:-0.1.0}"
BUNDLE_PACKAGE=$(sed -n 's/^package  *= *"\(.*\)"/\1/p' "$REPO_ROOT/logic/Cargo.toml" | tail -1)
BUNDLE_PATH="$REPO_ROOT/logic/res/${BUNDLE_PACKAGE##*.}-${BUNDLE_VERSION}.mpk"

# ── Helpers ───────────────────────────────────────────────────────────────────

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }
info()   { printf '     %s\n' "$*"; }

node_is_running() { curl -sf "${NODE_URL}/admin-api/health" &>/dev/null; }

# Fail fast when something else already holds our ports.
#
# Without this a clash is silent and then baffling: if another merod (e.g. the
# one bundled with Calimero Desktop) holds the WILDCARD *:2428, our node still
# binds 127.0.0.1:2428 successfully, but `localhost` resolves to ::1 first —
# where our IPv4-only socket does not answer. The result is a 60s
# "did not become healthy" timeout on a node that is actually up and fine.
assert_ports_free() {
  local clash=0 holder
  for port in "$NODE_PORT" "$NODE_P2P_PORT"; do
    # `|| true`: lsof exits 1 when it finds nothing, which under `set -e`
    # would abort the script precisely when the port IS free.
    #
    # Retry briefly: nuke_node kills the previous node moments earlier and
    # merod does not release its swarm socket instantly, so a single check
    # reports OUR OWN just-stopped node as a clash.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      holder=$(lsof -iTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}' || true)
      [ -z "$holder" ] && break
      sleep 1
    done
    if [ -n "$holder" ]; then
      red "Port $port is already in use by $holder"
      clash=1
    fi
  done
  if [ "$clash" -eq 1 ]; then
    info ""
    info "Quit the other process (Calimero Desktop bundles its own merod), or"
    info "run this script on different ports:"
    info ""
    if $SECONDARY; then
      info "  CURB_DEV_PORT2=3429 CURB_DEV_P2P_PORT2=3529 $0 --secondary"
    else
      info "  CURB_DEV_PORT=3428 CURB_DEV_P2P_PORT=3528 $0"
    fi
    info ""
    info "Remember to point the web app at the port you choose."
    exit 1
  fi
}

wait_for_node() {
  printf "  Waiting for %s" "$LABEL"
  for _ in $(seq 1 60); do
    if node_is_running; then printf '  ready\n'; return; fi
    printf '.'; sleep 1
  done
  printf '\n'
  red "$LABEL did not become healthy after 60s"
  info "Last lines of $LOG_FILE:"
  tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/     /'
  exit 1
}

pid_file() { echo "$PID_FILE"; }

# ── Parse args ────────────────────────────────────────────────────────────────

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)   STOP=true ;;
    --clean)  STOP=true; CLEAN=true ;;
    --help|-h)
      sed -n '3,20p' "${BASH_SOURCE[0]}"
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

for cmd in jq curl cargo-mero; do
  command -v "$cmd" &>/dev/null || { red "'$cmd' not found in PATH"; exit 1; }
done
command -v "$MEROD_BIN" &>/dev/null || [ -x "$MEROD_BIN" ] || { red "merod not found: $MEROD_BIN"; exit 1; }
info "merod: $("$MEROD_BIN" --version 2>/dev/null | head -1)"

# ── Nuke existing node (always start fresh) ──────────────────────────────────

step "Nuking existing $LABEL (clean slate)"
nuke_node
green "Clean slate ready"

# ── Build WASM + package the bundle ──────────────────────────────────────────
#
# `cargo mero build` emits only the raw wasm. Installing that leaves the node
# with empty metadata, so Calimero Desktop shows no name, no icon and no "Open"
# entry (it gates those on metadata.links.frontend). The bundle carries the
# manifest, so install the .mpk instead.
#
# The secondary reuses whatever the primary built — both MUST install the same
# artifact or they end up with different application ids and can never share a
# context. It only builds when there is nothing to reuse (standalone run).
if ! $SECONDARY || [ ! -f "$BUNDLE_PATH" ]; then
  step "Building WASM"
  (cd "$REPO_ROOT/logic" && cargo mero build)
  green "curb.wasm built"

  step "Packaging bundle"
  (cd "$REPO_ROOT/logic" && ./build-bundle.sh)
  green "bundle built"
else
  info "Reusing bundle: ${BUNDLE_PATH##*/}"
fi

# ── Init node (idempotent) ────────────────────────────────────────────────────

assert_ports_free

step "Initialising node at $NODE_HOME"
# merod 0.11 requires the admin account to exist before the node ever listens:
# `--auth-mode embedded` without credentials is a hard error (0.10 provisioned a
# default). Feed the same credentials this script authenticates with, via stdin
# so the password never appears in argv or the process environment.
printf '%s' "$ADMIN_PASS" | "$MEROD_BIN" --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT" \
  --auth-mode embedded \
  --admin-user "$ADMIN_USER" \
  --admin-password-stdin
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

# ── Bootstrap the secondary straight to the primary ──────────────────────────
# Two merods on the same host race over UDP/5353 (mDNS) with each other and
# anything else on the box (browsers, etc.), so mDNS discovery is unreliable and
# rendezvous-only pairing is slow. Skip discovery by putting the primary's
# loopback multiaddr in the secondary's bootstrap list.

if $SECONDARY; then
  PRIMARY_LOG="/tmp/curb-dev-node.log"
  PRIMARY_P2P_PORT="${CURB_DEV_P2P_PORT:-2528}"
  PRIMARY_PEER_ID=""
  if [ -f "$PRIMARY_LOG" ]; then
    for _ in $(seq 1 10); do
      PRIMARY_PEER_ID=$(grep -m1 "Listening on: /ip4/127.0.0.1/tcp/${PRIMARY_P2P_PORT}/p2p/" "$PRIMARY_LOG" 2>/dev/null \
        | grep -oE '12D3KooW[A-Za-z0-9]+' | head -1 || true)
      [ -n "$PRIMARY_PEER_ID" ] && break
      sleep 1
    done
  fi

  if [ -n "$PRIMARY_PEER_ID" ]; then
    python3 - "$CONFIG_FILE" "$PRIMARY_P2P_PORT" "$PRIMARY_PEER_ID" <<'PYEOF'
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
    green "Bootstrap injected: primary ($PRIMARY_PEER_ID) at 127.0.0.1:${PRIMARY_P2P_PORT}"
  else
    yellow "Could not read the primary's peer-id from $PRIMARY_LOG — relying on mDNS/rendezvous (may flake)"
  fi
fi

# ── Start node ────────────────────────────────────────────────────────────────

step "Starting $LABEL"
"$MEROD_BIN" --node "$NODE_NAME" --home "$NODE_HOME" run \
  > "$LOG_FILE" 2>&1 &
echo $! > "$(pid_file)"
green "Node started (pid $!  logs: $LOG_FILE)"
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
# install-dev-application detects a bundle archive by path and takes the
# manifest route (install_application_from_path -> install_bundle_from_path),
# so this carries name/icon/links.frontend onto the node. No registry or HTTP
# involved. Bundle app-id = hash(package, signer), so the id is stable across
# metadata edits — it only moves if the signing key changes.
[ -f "$BUNDLE_PATH" ] || { red "Bundle not found: $BUNDLE_PATH"; exit 1; }
APP_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/install-dev-application" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$BUNDLE_PATH" '{path: $p, metadata: [], package: null, version: null}')" \
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

# ── Create workspace (primary only) ──────────────────────────────────────────
#
# The secondary is deliberately left without one: you invite it from the web
# app, which is what exercises the P2P invitation and join flow.

NAMESPACE_ID=""
GENERAL_GROUP_ID=""
CONTEXT_ID=""
MEMBER_KEY=""

if ! $SECONDARY; then
step "Setting up workspace"

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

  # Permission model (rc.37+, 1-group-per-context):
  #   1   CAN_CREATE_CONTEXT       — inside their own subgroup
  #   2   CAN_INVITE_MEMBERS       — invite into the workspace
  #   4   CAN_JOIN_OPEN_SUBGROUPS  — auto-join open channels
  #  32   CAN_CREATE_SUBGROUP      — create a channel-group at root
  #  64   CAN_DELETE_SUBGROUP      — delete a channel-group they own
  # 128   CAN_MANAGE_VISIBILITY    — flip open↔restricted on their group
  # Total = 231.
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/default-capabilities" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"defaultCapabilities":231}' &>/dev/null \
    && green "Namespace member caps set (231)" \
    || yellow "Could not set namespace caps (non-fatal)"

  # Open subgroup-visibility so channels created by members are discoverable.
  curl -sf -X PUT "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/settings/subgroup-visibility" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
    -d '{"subgroupVisibility":"open"}' &>/dev/null || true
else
  yellow "Could not create workspace — create one from the app after logging in"
fi

# ── Create #general channel context (needed for RPC tests) ───────────────────

if [ -n "$NAMESPACE_ID" ]; then
  step "Creating #general channel"

  # 1. Create a subgroup for the channel
  SG_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/namespaces/${NAMESPACE_ID}/groups" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"groupAlias":"general"}' 2>/dev/null) || SG_RES="{}"
  GENERAL_GROUP_ID=$(echo "$SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null || true)

  if [ -z "$GENERAL_GROUP_ID" ]; then
    GENERAL_GROUP_ID=$(curl -sf "${NODE_URL}/admin-api/groups/${NAMESPACE_ID}/subgroups" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
      | jq -r '(.subgroups // .data // .) | if type=="array" then .[0].group_id // .[0].groupId else empty end' \
      2>/dev/null || true)
  fi

  if [ -n "$GENERAL_GROUP_ID" ]; then
    green "General subgroup: $GENERAL_GROUP_ID"

    curl -sf -X PUT "${NODE_URL}/admin-api/groups/${GENERAL_GROUP_ID}/settings/subgroup-visibility" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "Content-Type: application/json" \
      -d '{"subgroupVisibility":"open"}' &>/dev/null || true

    # 2. Create the context (channel) inside the subgroup
    INIT_JSON='{"name":"general","context_type":"Channel","description":"","created_at":1751952997,"creator_username":""}'
    INIT_BYTES=$(printf '%s' "$INIT_JSON" | python3 -c \
      "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')" 2>/dev/null || echo "[]")

    CTX_RES=$(curl -sf -X POST "${NODE_URL}/admin-api/contexts" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$(jq -n \
            --arg appId "$APP_ID" \
            --arg groupId "$GENERAL_GROUP_ID" \
            --argjson initParams "$INIT_BYTES" \
            '{applicationId: $appId, protocol: "near", groupId: $groupId, alias: "general", initializationParams: $initParams}')" \
      2>/dev/null) || CTX_RES="{}"

    CONTEXT_ID=$(echo "$CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
    MEMBER_KEY=$(echo "$CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)

    # Fallback: list contexts in subgroup
    if [ -z "$CONTEXT_ID" ]; then
      CONTEXT_ID=$(curl -sf "${NODE_URL}/admin-api/groups/${GENERAL_GROUP_ID}/contexts" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
        | jq -r '(.data // .) | if type=="array" then .[0].contextId // .[0].id else empty end' \
        2>/dev/null || true)
    fi

    # Fallback: fetch identity from context
    if [ -n "$CONTEXT_ID" ] && [ -z "$MEMBER_KEY" ]; then
      MEMBER_KEY=$(curl -sf "${NODE_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null \
        | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' \
        2>/dev/null || true)
    fi

    [ -n "$CONTEXT_ID" ] && green "Context ID: $CONTEXT_ID" \
      || yellow "Could not get context ID (RPC tests will skip)"
    [ -n "$MEMBER_KEY" ] && green "Member key: $MEMBER_KEY" \
      || yellow "Could not get member key (RPC tests will skip)"
  else
    yellow "Could not create general subgroup (RPC tests will skip)"
  fi
fi
fi  # end primary-only workspace setup

# ── Done ─────────────────────────────────────────────────────────────────────

ENV_FILE="$REPO_ROOT/app/.env.integration"
REFRESH_TOKEN=$(echo "$AUTH_RES" | jq -r '.data.refresh_token // empty')

if $SECONDARY; then
  # Fill in the node2 slots the primary left empty, rather than rewriting the
  # file and dropping the primary's tokens.
  if [ -f "$ENV_FILE" ]; then
    sed -i.bak \
      -e "s|^E2E_NODE_URL_2=.*|E2E_NODE_URL_2=${NODE_URL}|" \
      -e "s|^E2E_ACCESS_TOKEN_2=.*|E2E_ACCESS_TOKEN_2=${ACCESS_TOKEN}|" \
      -e "s|^E2E_REFRESH_TOKEN_2=.*|E2E_REFRESH_TOKEN_2=${REFRESH_TOKEN}|" \
      "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
    green "Updated $ENV_FILE with $LABEL tokens"
  else
    yellow "$ENV_FILE not found — run the primary first if you need e2e env"
  fi
else
  {
    printf 'E2E_NODE_URL=%s\n'        "$NODE_URL"
    printf 'E2E_ACCESS_TOKEN=%s\n'   "$ACCESS_TOKEN"
    printf 'E2E_REFRESH_TOKEN=%s\n'  "$REFRESH_TOKEN"
    printf 'E2E_NODE_URL_2=\n'
    printf 'E2E_ACCESS_TOKEN_2=\n'
    printf 'E2E_REFRESH_TOKEN_2=\n'
    printf 'E2E_GROUP_ID=%s\n'         "${NAMESPACE_ID:-}"
    printf 'E2E_CONTEXT_GROUP_ID=%s\n' "${GENERAL_GROUP_ID:-}"
    printf 'E2E_CONTEXT_ID=%s\n'      "${CONTEXT_ID:-}"
    printf 'E2E_MEMBER_KEY=%s\n'      "${MEMBER_KEY:-}"
    printf 'E2E_MEMBER_KEY_2=\n'
  } > "$ENV_FILE"
  green "Wrote $ENV_FILE"

  # Point the Vite dev server at the app we just installed. The app id is a hash
  # over the wasm AND its manifest metadata, so a local build never matches the
  # id baked into src/constants/config.ts. The frontend resolves the app strictly
  # by id, so without this it reports the app as not installed and offers to
  # install it. Preserve any other keys the developer has set.
  #
  # Secondary skips this: both nodes install the same bundle, so the id is
  # already correct and rewriting it would race with the primary.
  APP_ENV_FILE="$REPO_ROOT/app/.env"
  if [ -f "$APP_ENV_FILE" ]; then
    grep -v '^VITE_APPLICATION_ID=' "$APP_ENV_FILE" > "$APP_ENV_FILE.tmp" || true
    mv "$APP_ENV_FILE.tmp" "$APP_ENV_FILE"
  fi
  printf 'VITE_APPLICATION_ID="%s"\n' "$APP_ID" >> "$APP_ENV_FILE"
  green "Wrote VITE_APPLICATION_ID to $APP_ENV_FILE"
fi

printf '\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
if $SECONDARY; then
  printf '\033[1;32m  Node2 ready (no workspace)\033[0m\n'
else
  printf '\033[1;32m  Dev node ready\033[0m\n'
fi
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\n'
printf '  Node URL:   \033[1m%s\033[0m\n' "$NODE_URL"
printf '  Username:   \033[1m%s\033[0m\n' "$ADMIN_USER"
printf '  Password:   \033[1m%s\033[0m\n' "$ADMIN_PASS"
printf '  App ID:     %s\n' "$APP_ID"
if [ -n "${NAMESPACE_ID:-}" ]; then
  printf '  Workspace:  %s\n' "$NAMESPACE_ID"
fi
printf '  Logs:       %s\n' "$LOG_FILE"
printf '\n'
if $SECONDARY; then
  printf '  This node has no workspace — invite it from the web app:\n'
  printf '    1. Log in to the primary at http://localhost:5173\n'
  printf '    2. Invite this peer into the namespace\n'
  printf '    3. Open a second browser PROFILE and connect it to %s\n' "$NODE_URL"
  printf '\n'
  printf '  When done:\n'
  printf '    \033[36m%s --secondary --stop\033[0m\n' "$0"
else
  printf '  Next step:\n'
  printf '    \033[36mmake dev\033[0m   →  open http://localhost:5173, connect to %s\n' "$NODE_URL"
  printf '\n'
  printf '  When done:\n'
  printf '    \033[36mmake stop\033[0m\n'
fi
printf '\n'
