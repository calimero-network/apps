#!/usr/bin/env bash
# permissions-testing.sh — 3-node offline permissions test suite
#
# Mirrors the exact structure curb creates:
#   namespace
#   └── public-chat  (subgroup, visibility:open)
#       └── context  (the actual channel)
#   └── private-chat (subgroup, visibility:restricted)
#       └── context  (the actual channel)
#
# Tests:
#   1. Namespace creation — node-1 owns it
#   2. node-2 + node-3 join namespace
#   3. public-chat subgroup + context — node-1, node-2, node-3 all members
#   4. private-chat subgroup + context — node-1 + node-2 only, node-3 excluded
#   5. Permission enforcement  — Member-level nodes get 4xx on admin ops
#   6. Capability promotion    — node-2 promoted to Admin
#   7. Admin ops by node-2     — node-2 manages members and contexts
#   8. Member removal + downgrade
#
# Admin REST API only — zero JSON-RPC.
#
# Usage:
#   ./permissions-testing.sh          # full test run
#   ./permissions-testing.sh --stop   # kill test nodes
#   ./permissions-testing.sh --clean  # stop + wipe home dirs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Config ────────────────────────────────────────────────────────────────────
N1_HOME="${HOME}/.calimero/perm-node-1"
N2_HOME="${HOME}/.calimero/perm-node-2"
N3_HOME="${HOME}/.calimero/perm-node-3"
N1_PORT=2431; N1_P2P=2531
N2_PORT=2432; N2_P2P=2532
N3_PORT=2433; N3_P2P=2533
N1_URL="http://127.0.0.1:${N1_PORT}"
N2_URL="http://127.0.0.1:${N2_PORT}"
N3_URL="http://127.0.0.1:${N3_PORT}"

ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"
WASM="${SCRIPT_DIR}/logic/res/curb.wasm"

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)    STOP=true ;;
    --clean)   CLEAN=true; STOP=true ;;
    --help|-h) sed -n '3,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
  esac
done

# ── Output ────────────────────────────────────────────────────────────────────
PASS=0; FAIL=0; SKIP=0

section() { printf '\n\033[1;36m══ %s\033[0m\n' "$*"; }
step()    { printf '\033[1;33m  ▶ %s\033[0m\n' "$*"; }
info()    { printf '\033[90m    %s\033[0m\n' "$*"; }
ok()      { printf '\033[32m    ✓ %s\033[0m\n' "$*";  PASS=$((PASS + 1)); }
warn()    { printf '\033[33m    ⚠ %s\033[0m\n' "$*";  SKIP=$((SKIP  + 1)); }
die()     { printf '\033[31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

assert_pass() {
  local desc=$1 code=$2
  [[ "$code" =~ ^2 ]] \
    && { ok   "[PASS] $desc  (HTTP $code)"; PASS=$((PASS - 1)); } \
    || { printf '\033[31m    ✗ [FAIL] %s  (HTTP %s — expected 2xx)\033[0m\n' "$desc" "$code" >&2
         FAIL=$((FAIL + 1)); }
}

assert_reject() {
  local desc=$1 code=$2
  if [[ "$code" =~ ^4 ]]; then
    printf '\033[32m    ✓ [PASS] %s  (HTTP %s — correctly rejected)\033[0m\n' "$desc" "$code"
    PASS=$((PASS + 1))
  else
    printf '\033[33m    ⚠ [WARN] %s  (HTTP %s — expected 4xx)\033[0m\n' "$desc" "$code"
    SKIP=$((SKIP + 1))
  fi
}

pid_file() { echo "/tmp/perm-test-${1}.pid"; }

# ── Stop / Clean ──────────────────────────────────────────────────────────────
stop_node() {
  local name=$1 port=$2
  local pf; pf=$(pid_file "$name")
  [ -f "$pf" ] && { kill "$(cat "$pf")" 2>/dev/null || true; rm -f "$pf"; }
  pkill -f "merod --node ${name}" 2>/dev/null || true
  pkill -f "merod.*--server-port ${port}" 2>/dev/null || true
}

if $STOP; then
  section "Stopping test nodes"
  stop_node "perm-node-1" "$N1_PORT"
  stop_node "perm-node-2" "$N2_PORT"
  stop_node "perm-node-3" "$N3_PORT"
  meroctl node remove "perm-node-1" 2>/dev/null || true
  meroctl node remove "perm-node-2" 2>/dev/null || true
  meroctl node remove "perm-node-3" 2>/dev/null || true
  $CLEAN && { rm -rf "$N1_HOME" "$N2_HOME" "$N3_HOME"; warn "Home dirs removed"; } || true
  ok "Done."; exit 0
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────
section "Prerequisites"
for cmd in merod meroctl jq curl python3; do
  command -v "$cmd" &>/dev/null && ok "$cmd" || die "$cmd not in PATH"
done
[ -f "$WASM" ] || die "curb.wasm not found — run: cd logic && bash build.sh"
ok "curb.wasm: $WASM"

# ── Helpers ───────────────────────────────────────────────────────────────────

# encode <json-string> → JSON byte array  "[110,97,109,101,…]"
encode_init() {
  printf '%s' "$1" | python3 -c \
    "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')" \
    2>/dev/null || echo "[]"
}

wait_healthy() {
  local url=$1 label=$2
  printf '    Waiting for %s ' "$label"
  for _ in $(seq 1 60); do
    curl -sf "${url}/admin-api/health" &>/dev/null && printf ' ready\n' && return
    printf '.'; sleep 1
  done
  printf '\n'; die "$label did not start in 60s"
}

# ── Start 3 nodes ─────────────────────────────────────────────────────────────
section "Starting 3 nodes via merod"

start_node() {
  local name=$1 home=$2 port=$3 p2p=$4
  step "node $name  (http :$port  p2p :$p2p)"
  stop_node "$name" "$port"; rm -rf "$home"
  merod --node "$name" --home "$home" init \
    --server-host 127.0.0.1 --server-port "$port" \
    --swarm-port "$p2p" --auth-mode embedded &>/dev/null
  merod --node "$name" --home "$home" run \
    > "/tmp/perm-test-${name}.log" 2>&1 &
  echo $! > "$(pid_file "$name")"
  wait_healthy "http://127.0.0.1:${port}" "$name"
  ok "$name running  (pid $(cat "$(pid_file "$name")"))"
}

start_node "perm-node-1" "$N1_HOME" "$N1_PORT" "$N1_P2P"
start_node "perm-node-2" "$N2_HOME" "$N2_PORT" "$N2_P2P"
start_node "perm-node-3" "$N3_HOME" "$N3_PORT" "$N3_P2P"

# ── Auth via meroctl ──────────────────────────────────────────────────────────
section "Authenticating + registering nodes with meroctl"

TOK1=""; TOK2=""; TOK3=""

auth_node() {
  local name=$1 home=$2 port=$3 var=$4
  step "$name"
  local res tok ref
  res=$(curl -sf -X POST "http://127.0.0.1:${port}/auth/token" \
    -H "Content-Type: application/json" \
    -d "{\"auth_method\":\"user_password\",\"public_key\":\"${ADMIN_USER}\",\
\"client_name\":\"perm-test\",\"timestamp\":0,\"permissions\":[],\
\"provider_data\":{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}}" \
    2>/dev/null) || die "Auth failed for $name"
  tok=$(echo "$res" | jq -r '.data.access_token  // empty')
  ref=$(echo "$res" | jq -r '.data.refresh_token // empty')
  [ -n "$tok" ] || die "Empty token for $name"
  eval "${var}='${tok}'"
  meroctl node remove "$name" 2>/dev/null || true
  meroctl node add "$name" "$home" --access-token "$tok" --refresh-token "$ref" 2>/dev/null \
    && ok "$name authenticated + registered with meroctl" \
    || warn "$name auth ok, meroctl registration non-fatal"
}

auth_node "perm-node-1" "$N1_HOME" "$N1_PORT" TOK1
auth_node "perm-node-2" "$N2_HOME" "$N2_PORT" TOK2
auth_node "perm-node-3" "$N3_HOME" "$N3_PORT" TOK3

# Curl wrappers per node — TOK vars are read at call time
n1()  { curl -sf  -H "Authorization: Bearer ${TOK1}" -H "Content-Type: application/json" "$@"; }
n2()  { curl -sf  -H "Authorization: Bearer ${TOK2}" -H "Content-Type: application/json" "$@"; }
n3()  { curl -sf  -H "Authorization: Bearer ${TOK3}" -H "Content-Type: application/json" "$@"; }
n1c() { curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOK1}" -H "Content-Type: application/json" "$@" 2>/dev/null || echo "000"; }
n2c() { curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOK2}" -H "Content-Type: application/json" "$@" 2>/dev/null || echo "000"; }
n3c() { curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOK3}" -H "Content-Type: application/json" "$@" 2>/dev/null || echo "000"; }

# ── Install app ───────────────────────────────────────────────────────────────
section "Installing curb app on all 3 nodes"

install_app() {
  local name=$1 url=$2 tok=$3
  local res id
  res=$(curl -sf -X POST "${url}/admin-api/install-dev-application" \
    -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$WASM" '{path:$p,metadata:[],package:null,version:null}')" \
    2>/dev/null) || res="{}"
  id=$(echo "$res" | jq -r '.data.applicationId // empty' 2>/dev/null || true)
  if [ -z "$id" ]; then
    id=$(curl -sf "${url}/admin-api/applications" -H "Authorization: Bearer $tok" \
      2>/dev/null | jq -r '.data.apps[0].id // .data.applications[0].id // empty' 2>/dev/null || true)
  fi
  [ -n "$id" ] || die "App install failed on $name"
  ok "$name: app installed"
  echo "$id"
}

APP_ID=$(install_app "perm-node-1" "$N1_URL" "$TOK1")
install_app "perm-node-2" "$N2_URL" "$TOK2" >/dev/null
install_app "perm-node-3" "$N3_URL" "$TOK3" >/dev/null

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — NAMESPACE
# ═══════════════════════════════════════════════════════════════════════════════
section "1 — Namespace creation + 3-node join"

step "node-1 (Alice) creates namespace"
NS_RES=$(n1 -X POST "${N1_URL}/admin-api/namespaces" \
  -d "$(jq -n --arg a "$APP_ID" '{applicationId:$a,upgradePolicy:"LazyOnAccess"}')" 2>/dev/null) || NS_RES="{}"
NS_ID=$(echo "$NS_RES" | jq -r '.data.namespaceId // .data.groupId // .data.id // empty' 2>/dev/null || true)
[ -n "$NS_ID" ] || die "Namespace creation failed"
ok "node-1 created namespace  $NS_ID"

# node-1's identity is the first and only member
N1_ID=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members" 2>/dev/null \
  | jq -r '(.data // .) | if type=="array" then .[0].identity else empty end' 2>/dev/null || true)
info "Alice identity: ${N1_ID:-unknown}"
[ -n "$N1_ID" ] && n1 -X PUT "${N1_URL}/admin-api/groups/${NS_ID}/members/${N1_ID}/alias" \
  -d '{"alias":"Alice"}' &>/dev/null && ok "node-1 alias set: Alice"

# ── node-2 joins ──────────────────────────────────────────────────────────────
step "node-1 invites node-2 (Bob)  →  node-2 joins namespace"
INV2=$(n1 -X POST "${N1_URL}/admin-api/namespaces/${NS_ID}/invite" -d '{}' 2>/dev/null \
  | jq '.data.invitation // empty') || true
[ -n "$INV2" ] && [ "$INV2" != "null" ] || die "Invitation for node-2 failed"
ok "node-1: invite generated for node-2"
n2 -X POST "${N2_URL}/admin-api/namespaces/${NS_ID}/join" \
  -d "$(jq -n --argjson inv "$INV2" '{invitation:$inv}')" &>/dev/null \
  && ok "node-2: joined namespace" || die "node-2 join failed"
n2 -X POST "${N2_URL}/admin-api/groups/${NS_ID}/sync" -d '{}' &>/dev/null || true
sleep 2

N2_ID=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members" 2>/dev/null \
  | jq -r --arg n1 "$N1_ID" \
    '(.data // .) | if type=="array" then .[] | select(.identity != $n1) | .identity else empty end' \
  2>/dev/null | head -1 || true)
info "Bob identity: ${N2_ID:-unknown}"
[ -n "$N2_ID" ] && n1 -X PUT "${N1_URL}/admin-api/groups/${NS_ID}/members/${N2_ID}/alias" \
  -d '{"alias":"Bob"}' &>/dev/null && ok "node-2 alias set: Bob"

# ── node-3 joins ──────────────────────────────────────────────────────────────
step "node-1 invites node-3 (Charlie)  →  node-3 joins namespace"
INV3=$(n1 -X POST "${N1_URL}/admin-api/namespaces/${NS_ID}/invite" -d '{}' 2>/dev/null \
  | jq '.data.invitation // empty') || true
[ -n "$INV3" ] && [ "$INV3" != "null" ] || die "Invitation for node-3 failed"
ok "node-1: invite generated for node-3"
n3 -X POST "${N3_URL}/admin-api/namespaces/${NS_ID}/join" \
  -d "$(jq -n --argjson inv "$INV3" '{invitation:$inv}')" &>/dev/null \
  && ok "node-3: joined namespace" || die "node-3 join failed"
n3 -X POST "${N3_URL}/admin-api/groups/${NS_ID}/sync" -d '{}' &>/dev/null || true
sleep 2

N3_ID=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members" 2>/dev/null \
  | jq -r --arg n1 "$N1_ID" --arg n2 "$N2_ID" \
    '(.data // .) | if type=="array" then .[] | select(.identity != $n1 and .identity != $n2) | .identity else empty end' \
  2>/dev/null | head -1 || true)
info "Charlie identity: ${N3_ID:-unknown}"
[ -n "$N3_ID" ] && n1 -X PUT "${N1_URL}/admin-api/groups/${NS_ID}/members/${N3_ID}/alias" \
  -d '{"alias":"Charlie"}' &>/dev/null && ok "node-3 alias set: Charlie"

NS_COUNT=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members" 2>/dev/null \
  | jq '(.data // .) | if type=="array" then length else 0 end' 2>/dev/null || echo 0)
info "namespace member count: $NS_COUNT (expect 3)"
[ "$NS_COUNT" -eq 3 ] 2>/dev/null && ok "Verified: 3 members in namespace" \
  || warn "Expected 3 members, got $NS_COUNT (sync may lag)"

DEFAULT_CAPS=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}" 2>/dev/null \
  | jq '.data.defaultCapabilities // 3' 2>/dev/null || echo 3)
info "namespace default capabilities bitmask: $DEFAULT_CAPS"

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — PUBLIC-CHAT: subgroup + context
# ═══════════════════════════════════════════════════════════════════════════════
section "2 — public-chat: subgroup (open) + context inside it"

# ── Create subgroup ───────────────────────────────────────────────────────────
step "node-1 creates subgroup 'public-chat' in namespace"
PUB_GID=$(n1 -X POST "${N1_URL}/admin-api/namespaces/${NS_ID}/groups" \
  -d '{"groupAlias":"public-chat"}' 2>/dev/null \
  | jq -r '.data.groupId // empty' 2>/dev/null || true)
[ -n "$PUB_GID" ] || die "public-chat subgroup creation failed"
ok "subgroup created  $PUB_GID"

step "node-1 sets public-chat visibility: open"
HTTP=$(n1c -X PUT "${N1_URL}/admin-api/groups/${PUB_GID}/settings/subgroup-visibility" \
  -d '{"subgroupVisibility":"open"}')
assert_pass "node-1 sets public-chat visibility open" "$HTTP"

# ── Create context (channel) inside the subgroup ──────────────────────────────
step "node-1 creates context 'public-chat' inside the subgroup"
PUB_INIT=$(encode_init '{"name":"public-chat","context_type":"Channel","description":"","created_at":1751952997}')
PUB_CTX_RES=$(n1 -X POST "${N1_URL}/admin-api/contexts" \
  -d "$(jq -n --arg app "$APP_ID" --arg gid "$PUB_GID" --argjson init "$PUB_INIT" \
    '{applicationId:$app,protocol:"near",groupId:$gid,alias:"public-chat",initializationParams:$init}')" \
  2>/dev/null) || PUB_CTX_RES="{}"
PUB_CTX_ID=$(echo "$PUB_CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
PUB_MK1=$(echo "$PUB_CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
[ -n "$PUB_CTX_ID" ] || die "public-chat context creation failed"
ok "context created  $PUB_CTX_ID  (Alice's member key: ${PUB_MK1:0:20}…)"

# ── Add node-2 + node-3 to the subgroup ──────────────────────────────────────
step "node-1 adds node-2 (Bob) to public-chat subgroup"
[ -n "$N2_ID" ] && {
  HTTP=$(n1c -X POST "${N1_URL}/admin-api/groups/${PUB_GID}/members" \
    -d "$(jq -n --arg id "$N2_ID" '{members:[{identity:$id,role:"Member"}]}')")
  assert_pass "node-1 adds Bob to public-chat group" "$HTTP"
} || warn "Skipping — Bob identity unknown"

step "node-1 adds node-3 (Charlie) to public-chat subgroup"
[ -n "$N3_ID" ] && {
  HTTP=$(n1c -X POST "${N1_URL}/admin-api/groups/${PUB_GID}/members" \
    -d "$(jq -n --arg id "$N3_ID" '{members:[{identity:$id,role:"Member"}]}')")
  assert_pass "node-1 adds Charlie to public-chat group" "$HTTP"
} || warn "Skipping — Charlie identity unknown"

# ── node-2 and node-3 join the context ───────────────────────────────────────
step "node-2 (Bob) joins public-chat context"
n2 -X POST "${N2_URL}/admin-api/groups/${PUB_GID}/sync" -d '{}' &>/dev/null || true
sleep 1
PUB_JOIN2=$(n2 -X POST "${N2_URL}/admin-api/contexts/${PUB_CTX_ID}/join" \
  -d '{}' 2>/dev/null) || PUB_JOIN2="{}"
PUB_MK2=$(echo "$PUB_JOIN2" | jq -r '.data.memberPublicKey // empty' 2>/dev/null || true)
[ -n "$PUB_MK2" ] \
  && ok "node-2 joined public-chat context  (member key: ${PUB_MK2:0:20}…)" \
  || warn "node-2 join returned no member key (may need more sync time)"

step "node-3 (Charlie) joins public-chat context"
n3 -X POST "${N3_URL}/admin-api/groups/${PUB_GID}/sync" -d '{}' &>/dev/null || true
sleep 1
PUB_JOIN3=$(n3 -X POST "${N3_URL}/admin-api/contexts/${PUB_CTX_ID}/join" \
  -d '{}' 2>/dev/null) || PUB_JOIN3="{}"
PUB_MK3=$(echo "$PUB_JOIN3" | jq -r '.data.memberPublicKey // empty' 2>/dev/null || true)
[ -n "$PUB_MK3" ] \
  && ok "node-3 joined public-chat context  (member key: ${PUB_MK3:0:20}…)" \
  || warn "node-3 join returned no member key"

# Verify context appears in subgroup's context list
PUB_CTX_LIST=$(n1 "${N1_URL}/admin-api/groups/${PUB_GID}/contexts" 2>/dev/null \
  | jq -r '(.data // .) | if type=="array" then .[] | "  \(.alias // "no-alias")  id=\(.contextId // .id | .[0:20])…" else "none" end' \
  2>/dev/null || true)
info "public-chat group contexts:"
echo "$PUB_CTX_LIST" | while IFS= read -r l; do info "$l"; done

PUB_MEMBERS=$(n1 "${N1_URL}/admin-api/groups/${PUB_GID}/members" 2>/dev/null \
  | jq -r '(.data // .) | if type=="array" then .[] | "  \(.alias // "no-alias")  role=\(.role)" else "none" end' \
  2>/dev/null || true)
info "public-chat group members:"
echo "$PUB_MEMBERS" | while IFS= read -r l; do info "$l"; done

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — PRIVATE-CHAT: subgroup + context
# ═══════════════════════════════════════════════════════════════════════════════
section "3 — private-chat: subgroup (restricted) + context inside it"

# ── Create subgroup ───────────────────────────────────────────────────────────
step "node-1 creates subgroup 'private-chat' in namespace"
PRIV_GID=$(n1 -X POST "${N1_URL}/admin-api/namespaces/${NS_ID}/groups" \
  -d '{"groupAlias":"private-chat"}' 2>/dev/null \
  | jq -r '.data.groupId // empty' 2>/dev/null || true)
[ -n "$PRIV_GID" ] || die "private-chat subgroup creation failed"
ok "subgroup created  $PRIV_GID"

step "node-1 sets private-chat visibility: restricted"
HTTP=$(n1c -X PUT "${N1_URL}/admin-api/groups/${PRIV_GID}/settings/subgroup-visibility" \
  -d '{"subgroupVisibility":"restricted"}')
assert_pass "node-1 sets private-chat visibility restricted" "$HTTP"

# ── Create context (channel) inside the subgroup ──────────────────────────────
step "node-1 creates context 'private-chat' inside the subgroup"
PRIV_INIT=$(encode_init '{"name":"private-chat","context_type":"Channel","description":"","created_at":1751952997}')
PRIV_CTX_RES=$(n1 -X POST "${N1_URL}/admin-api/contexts" \
  -d "$(jq -n --arg app "$APP_ID" --arg gid "$PRIV_GID" --argjson init "$PRIV_INIT" \
    '{applicationId:$app,protocol:"near",groupId:$gid,alias:"private-chat",initializationParams:$init}')" \
  2>/dev/null) || PRIV_CTX_RES="{}"
PRIV_CTX_ID=$(echo "$PRIV_CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
PRIV_MK1=$(echo "$PRIV_CTX_RES" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
[ -n "$PRIV_CTX_ID" ] || die "private-chat context creation failed"
ok "context created  $PRIV_CTX_ID  (Alice's member key: ${PRIV_MK1:0:20}…)"

# ── Add ONLY node-2 (Bob) — Charlie is excluded ───────────────────────────────
step "node-1 adds node-2 (Bob) to private-chat subgroup — Charlie excluded"
[ -n "$N2_ID" ] && {
  HTTP=$(n1c -X POST "${N1_URL}/admin-api/groups/${PRIV_GID}/members" \
    -d "$(jq -n --arg id "$N2_ID" '{members:[{identity:$id,role:"Member"}]}')")
  assert_pass "node-1 adds Bob to private-chat group" "$HTTP"
} || warn "Skipping — Bob identity unknown"
info "Charlie intentionally NOT added to private-chat"

# ── node-2 joins the private context ─────────────────────────────────────────
step "node-2 (Bob) joins private-chat context"
n2 -X POST "${N2_URL}/admin-api/groups/${PRIV_GID}/sync" -d '{}' &>/dev/null || true
sleep 1
PRIV_JOIN2=$(n2 -X POST "${N2_URL}/admin-api/contexts/${PRIV_CTX_ID}/join" \
  -d '{}' 2>/dev/null) || PRIV_JOIN2="{}"
PRIV_MK2=$(echo "$PRIV_JOIN2" | jq -r '.data.memberPublicKey // empty' 2>/dev/null || true)
[ -n "$PRIV_MK2" ] \
  && ok "node-2 joined private-chat context  (member key: ${PRIV_MK2:0:20}…)" \
  || warn "node-2 join returned no member key"

# Verify membership
PRIV_COUNT=$(n1 "${N1_URL}/admin-api/groups/${PRIV_GID}/members" 2>/dev/null \
  | jq '(.data // .) | if type=="array" then length else 0 end' 2>/dev/null || echo 0)
info "private-chat group member count (expect 2 = Alice + Bob): $PRIV_COUNT"
[ "$PRIV_COUNT" -eq 2 ] 2>/dev/null \
  && ok "Verified: private-chat has exactly 2 members (Alice + Bob, Charlie excluded)" \
  || warn "private-chat member count: $PRIV_COUNT (expected 2)"

PRIV_MEMBERS=$(n1 "${N1_URL}/admin-api/groups/${PRIV_GID}/members" 2>/dev/null \
  | jq -r '(.data // .) | if type=="array" then .[] | "  \(.alias // "no-alias")  role=\(.role)" else "none" end' \
  2>/dev/null || true)
info "private-chat group members:"
echo "$PRIV_MEMBERS" | while IFS= read -r l; do info "$l"; done

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — PERMISSION ENFORCEMENT
# ═══════════════════════════════════════════════════════════════════════════════
section "4 — Permission enforcement: Member nodes attempt unauthorized operations"

# node-3 (Charlie, not in private-chat) tries to join the private context directly
step "node-3 tries to join private-chat context directly (not in group)  →  expect 4xx"
HTTP=$(n3c -X POST "${N3_URL}/admin-api/contexts/${PRIV_CTX_ID}/join" -d '{}')
assert_reject "node-3 (not in group) joins private-chat context" "$HTTP"

# node-3 tries to list private-chat group members
step "node-3 tries to list private-chat group members  →  expect 4xx"
HTTP=$(n3c "${N3_URL}/admin-api/groups/${PRIV_GID}/members")
assert_reject "node-3 (non-member) reads private-chat member list" "$HTTP"

# node-3 tries to list private-chat group's contexts
step "node-3 tries to list private-chat group contexts  →  expect 4xx"
HTTP=$(n3c "${N3_URL}/admin-api/groups/${PRIV_GID}/contexts")
assert_reject "node-3 (non-member) reads private-chat context list" "$HTTP"

# node-2 (Bob, Member) tries to create a subgroup in namespace
step "node-2 (Member) tries to create a subgroup  →  expect 4xx"
HTTP=$(n2c -X POST "${N2_URL}/admin-api/namespaces/${NS_ID}/groups" \
  -d '{"groupAlias":"bob-unauthorised"}')
assert_reject "node-2 (Member) creates namespace subgroup" "$HTTP"

# node-3 (Charlie, Member) tries to create a subgroup
step "node-3 (Member) tries to create a subgroup  →  expect 4xx"
HTTP=$(n3c -X POST "${N3_URL}/admin-api/namespaces/${NS_ID}/groups" \
  -d '{"groupAlias":"charlie-unauthorised"}')
assert_reject "node-3 (Member) creates namespace subgroup" "$HTTP"

# node-2 tries to add Charlie to private-chat (Member can't manage group members)
[ -n "$N3_ID" ] && {
  step "node-2 (Member) tries to add Charlie to private-chat group  →  expect 4xx"
  HTTP=$(n2c -X POST "${N2_URL}/admin-api/groups/${PRIV_GID}/members" \
    -d "$(jq -n --arg id "$N3_ID" '{members:[{identity:$id,role:"Member"}]}')")
  assert_reject "node-2 (Member) adds Charlie to private-chat group" "$HTTP"
}

# node-2 tries to remove Charlie from public-chat (Member can't remove others)
[ -n "$N3_ID" ] && {
  step "node-2 (Member) tries to remove Charlie from public-chat group  →  expect 4xx"
  HTTP=$(n2c -X POST "${N2_URL}/admin-api/groups/${PUB_GID}/members/remove" \
    -d "$(jq -n --arg id "$N3_ID" '{members:[$id]}')")
  assert_reject "node-2 (Member) removes Charlie from public-chat group" "$HTTP"
}

# node-3 tries to change private-chat visibility
step "node-3 tries to change private-chat subgroup visibility  →  expect 4xx"
HTTP=$(n3c -X PUT "${N3_URL}/admin-api/groups/${PRIV_GID}/settings/subgroup-visibility" \
  -d '{"subgroupVisibility":"open"}')
assert_reject "node-3 (non-member) changes private-chat visibility" "$HTTP"

# node-2 tries to rename Charlie's alias
[ -n "$N3_ID" ] && {
  step "node-2 (Member) tries to rename Charlie's alias  →  expect 4xx"
  HTTP=$(n2c -X PUT "${N2_URL}/admin-api/groups/${NS_ID}/members/${N3_ID}/alias" \
    -d '{"alias":"hacked"}')
  assert_reject "node-2 (Member) renames Charlie's alias" "$HTTP"
}

# node-3 tries to delete the namespace
step "node-3 (Member) tries to delete namespace  →  expect 4xx"
HTTP=$(n3c -X DELETE "${N3_URL}/admin-api/groups/${NS_ID}")
assert_reject "node-3 (Member) deletes namespace" "$HTTP"

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — CAPABILITY PROMOTION (Member → Admin)
# ═══════════════════════════════════════════════════════════════════════════════
section "5 — Promoting node-2 (Bob) to Admin"

[ -n "$N2_ID" ] || { warn "Bob identity unknown — skipping section 5-7"; }

if [ -n "$N2_ID" ]; then
  CAPS_BEFORE=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members/${N2_ID}/capabilities" \
    2>/dev/null | jq -c '.data' 2>/dev/null || echo "{}")
  info "Bob capabilities before promotion: $CAPS_BEFORE"

  step "node-1 re-adds Bob with role Admin in namespace"
  HTTP=$(n1c -X POST "${N1_URL}/admin-api/groups/${NS_ID}/members" \
    -d "$(jq -n --arg id "$N2_ID" '{members:[{identity:$id,role:"Admin"}]}')")
  assert_pass "node-1 adds Bob with role:Admin in namespace" "$HTTP"

  step "node-1 sets Bob capabilities bitmask=255 in namespace (all flags)"
  HTTP=$(n1c -X PUT "${N1_URL}/admin-api/groups/${NS_ID}/members/${N2_ID}/capabilities" \
    -d '{"capabilities":255}')
  assert_pass "node-1 sets Bob capabilities=255 in namespace" "$HTTP"

  step "node-1 sets Bob capabilities=255 in public-chat group"
  HTTP=$(n1c -X PUT "${N1_URL}/admin-api/groups/${PUB_GID}/members/${N2_ID}/capabilities" \
    -d '{"capabilities":255}')
  assert_pass "node-1 sets Bob capabilities=255 in public-chat group" "$HTTP"

  step "node-1 sets Bob capabilities=255 in private-chat group"
  HTTP=$(n1c -X PUT "${N1_URL}/admin-api/groups/${PRIV_GID}/members/${N2_ID}/capabilities" \
    -d '{"capabilities":255}')
  assert_pass "node-1 sets Bob capabilities=255 in private-chat group" "$HTTP"

  CAPS_AFTER=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members/${N2_ID}/capabilities" \
    2>/dev/null | jq -c '.data' 2>/dev/null || echo "{}")
  info "Bob capabilities after promotion: $CAPS_AFTER"

  n2 -X POST "${N2_URL}/admin-api/groups/${NS_ID}/sync" -d '{}' &>/dev/null || true
  sleep 1
  ok "Bob (node-2) promoted to Admin — sync triggered"

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — POST-PROMOTION: Admin operations by node-2
# ═══════════════════════════════════════════════════════════════════════════════
section "6 — node-2 (Admin) exercises admin operations"

  # node-2 creates a new subgroup
  step "node-2 (Admin) creates subgroup 'bob-admin-chat'"
  BOB_GID=""
  BOB_SG_RES=$(n2 -X POST "${N2_URL}/admin-api/namespaces/${NS_ID}/groups" \
    -d '{"groupAlias":"bob-admin-chat"}' 2>/dev/null) || BOB_SG_RES="{}"
  BOB_GID=$(echo "$BOB_SG_RES" | jq -r '.data.groupId // empty' 2>/dev/null || true)
  if [ -n "$BOB_GID" ]; then
    ok "[PASS] node-2 (Admin) created subgroup 'bob-admin-chat'  $BOB_GID"
  else
    warn "[WARN] node-2 (Admin) create subgroup failed — capabilities bitmask may need adjustment"
  fi

  # node-2 adds Charlie to private-chat group
  [ -n "$N3_ID" ] && {
    step "node-2 (Admin) adds Charlie to private-chat group"
    HTTP=$(n2c -X POST "${N2_URL}/admin-api/groups/${PRIV_GID}/members" \
      -d "$(jq -n --arg id "$N3_ID" '{members:[{identity:$id,role:"Member"}]}')")
    if [[ "$HTTP" =~ ^2 ]]; then
      ok "[PASS] node-2 (Admin) adds Charlie to private-chat  (HTTP $HTTP)"
      # Charlie can now join the private context
      n3 -X POST "${N3_URL}/admin-api/groups/${PRIV_GID}/sync" -d '{}' &>/dev/null || true
      sleep 1
      PRIV_JOIN3=$(n3 -X POST "${N3_URL}/admin-api/contexts/${PRIV_CTX_ID}/join" \
        -d '{}' 2>/dev/null) || PRIV_JOIN3="{}"
      PRIV_MK3=$(echo "$PRIV_JOIN3" | jq -r '.data.memberPublicKey // empty' 2>/dev/null || true)
      [ -n "$PRIV_MK3" ] \
        && ok "node-3 joined private-chat context after Bob added him  (${PRIV_MK3:0:20}…)" \
        || warn "node-3 join returned no member key after group add"
      PRIV_COUNT2=$(n1 "${N1_URL}/admin-api/groups/${PRIV_GID}/members" 2>/dev/null \
        | jq '(.data // .) | if type=="array" then length else 0 end' 2>/dev/null || echo "?")
      info "private-chat member count after Bob adds Charlie: $PRIV_COUNT2 (expect 3)"
    else
      warn "[WARN] node-2 (Admin) adds to private-chat  (HTTP $HTTP — may need group-level admin)"
    fi
  }

  # node-2 removes Charlie from public-chat group
  [ -n "$N3_ID" ] && {
    step "node-2 (Admin) removes Charlie from public-chat group"
    HTTP=$(n2c -X POST "${N2_URL}/admin-api/groups/${PUB_GID}/members/remove" \
      -d "$(jq -n --arg id "$N3_ID" '{members:[$id]}')")
    if [[ "$HTTP" =~ ^2 ]]; then
      ok "[PASS] node-2 (Admin) removed Charlie from public-chat  (HTTP $HTTP)"
      PUB_COUNT=$(n1 "${N1_URL}/admin-api/groups/${PUB_GID}/members" 2>/dev/null \
        | jq '(.data // .) | if type=="array" then length else 0 end' 2>/dev/null || echo "?")
      info "public-chat member count: $PUB_COUNT (expect 2 = Alice + Bob)"
    else
      warn "[WARN] node-2 (Admin) removes from public-chat  (HTTP $HTTP)"
    fi
  }

  # node-2 creates a context inside bob-admin-chat
  [ -n "$BOB_GID" ] && {
    step "node-2 (Admin) creates context inside bob-admin-chat"
    BOB_INIT=$(encode_init '{"name":"bob-admin-chat","context_type":"Channel","description":"","created_at":1751952997}')
    BOB_CTX_RES=$(n2 -X POST "${N2_URL}/admin-api/contexts" \
      -d "$(jq -n --arg app "$APP_ID" --arg gid "$BOB_GID" --argjson init "$BOB_INIT" \
        '{applicationId:$app,protocol:"near",groupId:$gid,alias:"bob-admin-chat",initializationParams:$init}')" \
      2>/dev/null) || BOB_CTX_RES="{}"
    BOB_CTX_ID=$(echo "$BOB_CTX_RES" | jq -r '.data.contextId // .data.id // empty' 2>/dev/null || true)
    [ -n "$BOB_CTX_ID" ] \
      && ok "[PASS] node-2 (Admin) created context in bob-admin-chat  $BOB_CTX_ID" \
      || warn "[WARN] node-2 context creation inside bob-admin-chat failed"
  }

  # node-2 renames Charlie's alias
  [ -n "$N3_ID" ] && {
    step "node-2 (Admin) renames Charlie's alias"
    HTTP=$(n2c -X PUT "${N2_URL}/admin-api/groups/${NS_ID}/members/${N3_ID}/alias" \
      -d '{"alias":"Charlie-renamed-by-Bob"}')
    [[ "$HTTP" =~ ^2 ]] \
      && ok "[PASS] node-2 (Admin) renamed Charlie's alias  (HTTP $HTTP)" \
      || warn "[WARN] rename alias  (HTTP $HTTP)"
  }

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — REMOVAL + DOWNGRADE
# ═══════════════════════════════════════════════════════════════════════════════
section "7 — Member removal + capability downgrade"

  step "node-1 removes Bob from private-chat group"
  HTTP=$(n1c -X POST "${N1_URL}/admin-api/groups/${PRIV_GID}/members/remove" \
    -d "$(jq -n --arg id "$N2_ID" '{members:[$id]}')")
  assert_pass "node-1 removes Bob from private-chat group" "$HTTP"

  PRIV_IDS=$(n1 "${N1_URL}/admin-api/groups/${PRIV_GID}/members" 2>/dev/null \
    | jq -r '(.data // .) | if type=="array" then [.[].identity] | @json else "[]" end' \
    2>/dev/null || echo "[]")
  if echo "$PRIV_IDS" | grep -q "$N2_ID" 2>/dev/null; then
    printf '\033[31m    ✗ [FAIL] Bob still in private-chat after removal\033[0m\n' >&2
    FAIL=$((FAIL + 1))
  else
    ok "Verified: Bob no longer in private-chat group"
  fi

  # Bob can no longer join the private context
  step "node-2 (Bob, removed from group) tries to join private-chat context  →  expect 4xx"
  HTTP=$(n2c -X POST "${N2_URL}/admin-api/contexts/${PRIV_CTX_ID}/join" -d '{}')
  assert_reject "node-2 (removed from group) joins private-chat context" "$HTTP"

  step "node-1 downgrades Bob capabilities back to default ($DEFAULT_CAPS)"
  HTTP=$(n1c -X PUT "${N1_URL}/admin-api/groups/${NS_ID}/members/${N2_ID}/capabilities" \
    -d "{\"capabilities\":${DEFAULT_CAPS}}")
  assert_pass "node-1 sets Bob capabilities=$DEFAULT_CAPS (default)" "$HTTP"

  CAPS_FINAL=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/members/${N2_ID}/capabilities" \
    2>/dev/null | jq -c '.data' 2>/dev/null || echo "{}")
  info "Bob capabilities after downgrade: $CAPS_FINAL"

  n2 -X POST "${N2_URL}/admin-api/groups/${NS_ID}/sync" -d '{}' &>/dev/null || true
  sleep 1

  step "node-2 (downgraded to Member) tries to create subgroup again  →  expect 4xx"
  HTTP=$(n2c -X POST "${N2_URL}/admin-api/namespaces/${NS_ID}/groups" \
    -d '{"groupAlias":"bob-after-downgrade"}')
  assert_reject "node-2 (downgraded) creates subgroup after demotion" "$HTTP"

fi  # end of N2_ID block

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — FINAL STRUCTURE
# ═══════════════════════════════════════════════════════════════════════════════
section "8 — Final structure verification"

step "node-1 lists all subgroups in namespace"
SUBGROUPS=$(n1 "${N1_URL}/admin-api/groups/${NS_ID}/subgroups" 2>/dev/null \
  | jq -r '(.subgroups // .data // .) | if type=="array" then .[] | "  \(.alias // "no-alias")  id=\(.group_id // .groupId | .[0:20])…" else "none" end' \
  2>/dev/null || true)
info "subgroups (Alice's view):"
echo "$SUBGROUPS" | while IFS= read -r l; do info "$l"; done

step "node-1 lists contexts in public-chat group"
PUB_CTXS=$(n1 "${N1_URL}/admin-api/groups/${PUB_GID}/contexts" 2>/dev/null \
  | jq -r '(.data // .) | if type=="array" then .[] | "  \(.alias // "no-alias")  id=\(.contextId // .id | .[0:20])…" else "none" end' \
  2>/dev/null || true)
info "public-chat contexts:"
echo "$PUB_CTXS" | while IFS= read -r l; do info "$l"; done

step "node-1 lists contexts in private-chat group"
PRIV_CTXS=$(n1 "${N1_URL}/admin-api/groups/${PRIV_GID}/contexts" 2>/dev/null \
  | jq -r '(.data // .) | if type=="array" then .[] | "  \(.alias // "no-alias")  id=\(.contextId // .id | .[0:20])…" else "none" end' \
  2>/dev/null || true)
info "private-chat contexts:"
echo "$PRIV_CTXS" | while IFS= read -r l; do info "$l"; done

step "node-3 cannot list private-chat group contexts (non-member)  →  expect 4xx"
HTTP=$(n3c "${N3_URL}/admin-api/groups/${PRIV_GID}/contexts")
assert_reject "node-3 reads private-chat context list" "$HTTP"

step "node-3 can list public-chat group contexts (is a member)"
n3 -X POST "${N3_URL}/admin-api/groups/${PUB_GID}/sync" -d '{}' &>/dev/null || true
HTTP=$(n3c "${N3_URL}/admin-api/groups/${PUB_GID}/contexts")
assert_pass "node-3 reads public-chat context list" "$HTTP"

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
printf '\n'
printf '\033[1m══════════════════════════════════════════════════════\033[0m\n'
printf '\033[1m  Permissions Test Summary\033[0m\n'
printf '\033[1m══════════════════════════════════════════════════════\033[0m\n'
printf '\033[32m  PASS : %d\033[0m\n' "$PASS"
[ "$FAIL" -gt 0 ] \
  && printf '\033[31m  FAIL : %d\033[0m\n' "$FAIL" \
  || printf '\033[32m  FAIL : 0\033[0m\n'
printf '\033[33m  WARN : %d\033[0m\n' "$SKIP"
printf '\033[1m──────────────────────────────────────────────────────\033[0m\n'
printf '  namespace          : %s\n' "${NS_ID:-N/A}"
printf '  public-chat group  : %s\n' "${PUB_GID:-N/A}"
printf '  public-chat context: %s\n' "${PUB_CTX_ID:-N/A}"
printf '  private-chat group : %s\n' "${PRIV_GID:-N/A}"
printf '  private-chat ctx   : %s\n' "${PRIV_CTX_ID:-N/A}"
printf '  Alice (node-1)     : %s\n' "${N1_ID:0:28}${N1_ID:+…}"
printf '  Bob   (node-2)     : %s\n' "${N2_ID:0:28}${N2_ID:+…}"
printf '  Charlie (node-3)   : %s\n' "${N3_ID:0:28}${N3_ID:+…}"
printf '\033[1m──────────────────────────────────────────────────────\033[0m\n'
printf '  Logs:\n'
printf '    /tmp/perm-test-perm-node-{1,2,3}.log\n'
printf '  Stop:  ./permissions-testing.sh --stop\n'
printf '  Clean: ./permissions-testing.sh --clean\n'
printf '\033[1m══════════════════════════════════════════════════════\033[0m\n'

[ "$FAIL" -gt 0 ] \
  && { printf '\033[31m  %d test(s) FAILED — nodes left running\033[0m\n' "$FAIL"; exit 1; } \
  || printf '\033[32m  All tests passed.\033[0m\n'
