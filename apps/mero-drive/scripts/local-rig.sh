#!/usr/bin/env bash
# Three native merod nodes, the mero-drive bundle, a mesh, and app/.env.integration.
# Every process it starts is recorded in its own pid file and stopped only from there.
set -euo pipefail

RIG_DIR="${MERODRIVE_RIG_DIR:-/tmp/merodrive-rig}" # wiped by `up`; holds node homes, logs and the pid file
NODE_COUNT=3                                      # node n listens on 3918+2n (p2p) and 3919+2n (rpc)
BASE_PORT=3920
NODE_PREFIX=drive-rig-node
ADMIN_USER="admin"
ADMIN_PASSWORD=adminadmin # throwaway, loopback only; merod enforces 8 characters
LOG_LEVEL="${RIG_LOG_LEVEL:-merod=info,calimero_=info,calimero_node::sync=debug}"
HEALTH_TIMEOUT=60 # seconds a node gets to serve /admin-api/health after a start
STOP_TIMEOUT=30   # seconds a node gets to exit after SIGTERM

DRIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DRIVE_DIR/app/.env.integration"
PID_FILE="$RIG_DIR/rig.pids"
WORKFLOW="$RIG_DIR/rig-mesh.yml"

die() {
  echo "local-rig: $*" >&2
  exit 1
}

node_name() { echo "$NODE_PREFIX-$1"; }
p2p_port() { echo $((BASE_PORT + 2 * ($1 - 1))); }
rpc_port() { echo $((BASE_PORT + 2 * $1 - 1)); }
# The swarm port in the node's own config, which is the isolated one once it
# has been moved, so a second isolation never replaces a port that is not there.
current_p2p_port() {
  awk '/^\[swarm\]/ { in_swarm = 1; next } /^\[/ { in_swarm = 0 } in_swarm && /^listen/ { match($0, /tcp\/[0-9]+/); print substr($0, RSTART + 4, RLENGTH - 4); exit }' "$(config_path "$1")"
}

# A fresh port per isolation: a peer that learned the last one would otherwise
# dial straight back in, and the node would never actually be alone.
free_port() {
  local port
  while :; do
    port=$((39000 + RANDOM % 900))
    if ! lsof -nP -i :"$port" >/dev/null 2>&1; then
      echo "$port"
      return
    fi
  done
}
node_home() { echo "$RIG_DIR/data/$(node_name "$1")/$(node_name "$1")"; }
config_path() { echo "$(node_home "$1")/$(node_name "$1")/config.toml"; }

node_url() { echo "http://localhost:$(rpc_port "$1")"; }

require_node_index() {
  case "${1:-}" in
  [1-9]*) [ "$1" -ge 1 ] && [ "$1" -le "$NODE_COUNT" ] || die "node must be 1..$NODE_COUNT" ;;
  *) die "node must be 1..$NODE_COUNT" ;;
  esac
}

# MEROD_BINARY wins; then the binary `up` recorded, so a restart from the dev
# server (no PATH of ours) uses the same build; then the integration build.
resolve_merod() {
  local merod="${MEROD_BINARY:-}"
  [ -n "$merod" ] || [ ! -L "$RIG_DIR/bin/merod" ] || merod="$(readlink "$RIG_DIR/bin/merod")"
  [ -n "$merod" ] || merod="$(command -v merod-integration || command -v merod || true)"
  [ -n "$merod" ] && [ -x "$merod" ] || die "no merod; set MEROD_BINARY or put merod-integration on PATH"
  echo "$merod"
}

# One switch at a time: the dev server and a test cleanup can both call
# offline/online for the same node, and two starts on one home race.
LOCK_DIR="$RIG_DIR/rig.lock"
with_lock() {
  local waited=0
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -lt 180 ] || die "rig lock held for 180s at $LOCK_DIR"
  done
  trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT
  "$@"
}

# `<index> <pid>` per line. A node that is offline holds no line.
read_pid() {
  [ -f "$PID_FILE" ] || return 0
  awk -v n="$1" '$1 == n { print $2 }' "$PID_FILE"
}

write_pid() {
  local index=$1 pid=$2 rest
  rest="$([ -f "$PID_FILE" ] && awk -v n="$index" '$1 != n' "$PID_FILE" || true)"
  { [ -n "$rest" ] && echo "$rest"; [ -n "$pid" ] && echo "$index $pid"; } >"$PID_FILE.tmp" || true
  mv "$PID_FILE.tmp" "$PID_FILE"
}

is_isolated() { [ -f "$(config_path "$1").online" ]; }

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

healthy() { curl -sf -o /dev/null --max-time 3 "$(node_url "$1")/admin-api/health"; }

wait_healthy() {
  local index=$1 deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    healthy "$index" && return 0
    sleep 1
  done
  die "node $index never became healthy within ${HEALTH_TIMEOUT}s; see $RIG_DIR/data/logs"
}

start_node() {
  local index=$1 name merod home
  name="$(node_name "$index")"
  home="$(node_home "$index")"
  merod="$(resolve_merod)"
  [ -d "$home" ] || die "no home for node $index at $home; run \`up\` first"
  CALIMERO_HOME="$home" NODE_NAME="$name" RUST_LOG="$LOG_LEVEL" \
    MERO_AUTH_ADMIN_USER="$ADMIN_USER" MERO_AUTH_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    nohup "$merod" --home "$home" --node "$name" run \
    >>"$RIG_DIR/data/$name/logs/$name.log" 2>&1 &
  write_pid "$index" $!
  wait_healthy "$index"
}

stop_node() {
  local index=$1 pid deadline
  pid="$(read_pid "$index")"
  if ! alive "$pid"; then
    write_pid "$index" ""
    return 0
  fi
  kill -TERM "$pid"
  deadline=$((SECONDS + STOP_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    alive "$pid" || break
    sleep 1
  done
  alive "$pid" && die "node $index (pid $pid) did not exit within ${STOP_TIMEOUT}s"
  write_pid "$index" ""
}

# The response is enveloped, so every field read below goes through `.data`.
mint_token() {
  curl -sf "$(node_url "$1")/auth/token" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg u "$ADMIN_USER" --arg p "$ADMIN_PASSWORD" \
      --arg k "$(openssl rand -base64 32)" --argjson t "$(date +%s)000" \
      '{auth_method:"user_password",public_key:$k,client_name:"mero-drive-rig",timestamp:$t,permissions:["admin"],provider_data:{username:$u,password:$p}}')" ||
    die "could not mint a token on node $1"
}

# Exactly one application is installed per node, so a match is unambiguous.
application_id() {
  local token=$1 apps
  apps="$(curl -sf "$(node_url 1)/admin-api/applications" -H "Authorization: Bearer $token")" ||
    die "could not list applications on node 1"
  local count
  count="$(echo "$apps" | jq '.data.apps | length')"
  [ "$count" = "1" ] || die "expected 1 installed application on node 1, found $count"
  echo "$apps" | jq -r '.data.apps[0].id'
}

write_workflow() {
  local bundle=$1 index
  {
    cat <<YAML
name: mero-drive local rig
description: >
  Installs the mero-drive bundle on every rig node, creates the namespace, a
  folder group and its docs context, joins the other nodes and waits for the
  three to agree on one context state hash.

auth_mode: embedded

log_level: "$LOG_LEVEL"

# Defined individually so every port is pinned: with \`count\`, --e2e-mode
# allocates ports dynamically and a restart reconnects on the wrong one.
nodes:
YAML
    for index in $(seq 1 "$NODE_COUNT"); do
      cat <<YAML
  $(node_name "$index"):
    port: $(p2p_port "$index")
    rpc_port: $(rpc_port "$index")
YAML
    done
    echo "steps:"
    for index in $(seq 1 "$NODE_COUNT"); do
      cat <<YAML
  - name: Log in on node $index
    type: login
    node: $(node_name "$index")
    username: $ADMIN_USER
    password: $ADMIN_PASSWORD

  - name: Install the bundle on node $index
    type: install_application
    node: $(node_name "$index")
    path: $bundle
    dev: true
YAML
      [ "$index" = 1 ] && printf '    outputs:\n      app_id: applicationId\n'
      echo
    done
    cat <<YAML
  - name: Settle before the first admin call
    type: wait
    seconds: 12

  - name: Create the namespace on node 1
    type: create_namespace
    node: $(node_name 1)
    application_id: '{{app_id}}'
    outputs:
      namespace_id: namespaceId

  - name: Create the folder group
    type: create_group_in_namespace
    node: $(node_name 1)
    namespace_id: '{{namespace_id}}'
    group_name: rig
    outputs:
      rig_group: groupId

  - name: Create the docs context bound to the folder group
    type: create_context
    node: $(node_name 1)
    application_id: '{{app_id}}'
    group_id: '{{rig_group}}'
    service_name: docs
    outputs:
      rig_ctx: contextId
YAML
    for index in $(seq 2 "$NODE_COUNT"); do
      cat <<YAML

  - name: Invite node $index into the namespace
    type: create_namespace_invitation
    node: $(node_name 1)
    namespace_id: '{{namespace_id}}'
    outputs:
      invite_$index: invitation

  - name: Wait for namespace gossip to reach node $index
    type: wait
    seconds: 10

  - name: Node $index joins the namespace
    type: join_namespace
    node: $(node_name "$index")
    namespace_id: '{{namespace_id}}'
    invitation: '{{invite_$index}}'
    outputs:
      identity_$index: memberIdentity

  - name: Add node $index to the folder group
    type: add_group_members
    node: $(node_name 1)
    group_id: '{{rig_group}}'
    members:
      - identity: '{{identity_$index}}'
        role: Member

  - name: Wait for the folder subgroup membership to propagate
    type: wait
    seconds: 10

  - name: Node $index joins the docs context
    type: join_context
    node: $(node_name "$index")
    context_id: '{{rig_ctx}}'
YAML
    done
    cat <<YAML

  - name: All nodes converge on one context state hash
    type: wait_for_sync
    context_id: '{{rig_ctx}}'
    nodes:
YAML
    for index in $(seq 1 "$NODE_COUNT"); do echo "      - $(node_name "$index")"; done
    cat <<YAML
    timeout: 120
    trigger_sync: true

stop_all_nodes: false
YAML
  } >"$WORKFLOW"
}

cmd_up() {
  local merod bundle package token app_id index
  merod="$(resolve_merod)"
  command -v merobox >/dev/null || die "no merobox on PATH"
  command -v jq >/dev/null || die "no jq on PATH"

  package="$(sed -n 's/^package *= *"\(.*\)"/\1/p' "$DRIVE_DIR/logic/Cargo.toml" | head -1)"
  [ -n "$package" ] || die "no [package.metadata.calimero] package in logic/Cargo.toml"
  bundle="$DRIVE_DIR/logic/dist/$package.mpk"
  pnpm --dir "$DRIVE_DIR" logic:build
  [ -f "$bundle" ] || die "logic:build produced no $bundle"

  rm -rf "$RIG_DIR"
  mkdir -p "$RIG_DIR/bin"
  : >"$PID_FILE"
  # merobox resolves a merod on PATH even when it only touches PIDs.
  ln -sf "$merod" "$RIG_DIR/bin/merod"
  write_workflow "$bundle"

  # --e2e-mode clears the public bootstrap nodes and turns on mDNS; --log-level
  # has to be on the command line, because merobox's CLI default overrides the
  # workflow's own.
  (
    cd "$RIG_DIR"
    PATH="$RIG_DIR/bin:$PATH" MERO_AUTH_ADMIN_USER="$ADMIN_USER" MERO_AUTH_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      merobox bootstrap run "$WORKFLOW" \
      --no-docker --binary-path "$merod" \
      --auth-mode embedded --auth-username "$ADMIN_USER" --auth-password "$ADMIN_PASSWORD" \
      --e2e-mode --log-level "$LOG_LEVEL"
  )

  for index in $(seq 1 "$NODE_COUNT"); do
    local pid
    pid="$(cat "$RIG_DIR/data/.pids/$(node_name "$index").pid")"
    alive "$pid" || die "node $index is not running after bootstrap"
    write_pid "$index" "$pid"
  done

  token="$(mint_token 1 | jq -r .data.access_token)"
  app_id="$(application_id "$token")"
  write_env "$app_id"

  echo
  echo "rig up: $NODE_COUNT nodes, run dir $RIG_DIR"
  cmd_status
  echo "application: $app_id"
  echo "contexts:    $(curl -sf "$(node_url 1)/admin-api/contexts" -H "Authorization: Bearer $token" | jq -r '.data.contexts[]? // .data[]? // empty' | tr '\n' ' ')"
  echo "env:         $ENV_FILE"
}

# Tokens live one hour, so `tokens` re-mints them for a rig that stays up longer.
write_env() {
  local app_id=$1
  {
    echo "# Written by scripts/local-rig.sh. Do not edit by hand."
    echo "E2E_APPLICATION_ID=$app_id"
    for index in $(seq 1 "$NODE_COUNT"); do
      local suffix="" tokens
      [ "$index" = 1 ] || suffix="_$index"
      tokens="$(mint_token "$index")"
      echo "E2E_NODE_URL$suffix=$(node_url "$index")"
      echo "E2E_ACCESS_TOKEN$suffix=$(echo "$tokens" | jq -r .data.access_token)"
      echo "E2E_REFRESH_TOKEN$suffix=$(echo "$tokens" | jq -r .data.refresh_token)"
    done
  } >"$ENV_FILE"
}

cmd_tokens() {
  local index token
  for index in $(seq 1 "$NODE_COUNT"); do
    healthy "$index" || die "node $index is not healthy; bring it online first"
  done
  token="$(mint_token 1 | jq -r .data.access_token)"
  write_env "$(application_id "$token")"
  echo "tokens refreshed: $ENV_FILE"
}

cmd_down() {
  local index
  [ -f "$PID_FILE" ] || die "no pid file at $PID_FILE; nothing this script started is running"
  for index in $(seq 1 "$NODE_COUNT"); do
    stop_node "$index"
    restore_config "$index"
  done
  echo "rig down: $NODE_COUNT nodes stopped"
}

cmd_status() {
  local index pid state
  for index in $(seq 1 "$NODE_COUNT"); do
    pid="$(read_pid "$index")"
    if ! alive "$pid"; then
      state="offline"
    elif healthy "$index"; then
      is_isolated "$index" && state="isolated pid $pid" || state="online  pid $pid"
    else
      state="starting pid $pid"
    fi
    echo "node $index  $(node_url "$index")  $state"
  done
}

# Backed up once per offline stretch, so a repeat `offline` never clobbers the original.
backup_config() {
  local config
  config="$(config_path "$1")"
  [ -f "$config.online" ] || cp "$config" "$config.online"
}

restore_config() {
  local config
  config="$(config_path "$1")"
  [ -f "$config.online" ] && mv "$config.online" "$config"
  return 0
}

# Moves the swarm listeners off their bootstrap port and turns off mDNS, so
# peers dialing the old port and address fail while the RPC port keeps serving.
isolate_config() {
  local index=$1 config
  config="$(config_path "$index")"
  python3 - "$config" "$(current_p2p_port "$index")" "$(free_port)" <<'PY'
import re
import sys
import tomllib

path, old_port, new_port = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()


def rewrite_section(text, header, pattern, replacement):
    start = text.index(f"\n[{header}]\n") + 1
    end = text.find("\n[", start + 1)
    end = len(text) if end == -1 else end
    return text[:start] + re.sub(pattern, replacement, text[start:end]) + text[end:]


text = rewrite_section(text, "swarm", rf'(?<=/){re.escape(old_port)}(?=["/])', new_port)
text = rewrite_section(text, "discovery", r"mdns = true", "mdns = false")
open(path, "w").write(text)
tomllib.loads(text)  # fail loudly if the rewrite produced invalid toml
PY
}

cmd_offline() {
  require_node_index "${1:-}"
  stop_node "$1"
  backup_config "$1"
  isolate_config "$1"
  start_node "$1"
  echo "node $1 offline (isolated, rpc still serving)"
}

cmd_online() {
  require_node_index "${1:-}"
  stop_node "$1"
  restore_config "$1"
  start_node "$1"
  echo "node $1 online  $(node_url "$1")"
}

case "${1:-}" in
up) cmd_up ;;
down) cmd_down ;;
status) cmd_status ;;
tokens) with_lock cmd_tokens ;;
offline) with_lock cmd_offline "${2:-}" ;;
online) with_lock cmd_online "${2:-}" ;;
*)
  echo "usage: local-rig.sh up|down|status|tokens|offline <n>|online <n>" >&2
  exit 2
  ;;
esac
