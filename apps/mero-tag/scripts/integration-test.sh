#!/usr/bin/env bash
# scripts/integration-test.sh — end-to-end contract test against a real node.
#
# Brings up node1 (via dev-node.sh), deploys the WASM, then drives the contract
# over JSON-RPC `execute` and asserts behavior. Tears the node down at the end.
#
# Run with:  make logic-e2e   (or: bash scripts/integration-test.sh)
#
# This is heavier than `cargo test` (it builds WASM + runs merod) — it's opt-in,
# not part of `make test`.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/app/.env.integration"

PASS=0; FAIL=0
green() { printf '\033[32m  ✓ %s\033[0m\n' "$*"; PASS=$((PASS+1)); }
red()   { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; FAIL=$((FAIL+1)); }
step()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

cleanup() { bash "$SCRIPT_DIR/dev-node.sh" --clean >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── Bring up node + deploy ──────────────────────────────────────────────────
step "Starting node + deploying contract"
bash "$SCRIPT_DIR/dev-node.sh" >/dev/null 2>&1 || { red "dev-node.sh failed"; exit 1; }
[ -f "$ENV_FILE" ] || { red "no .env.integration"; exit 1; }
set -a; . "$ENV_FILE"; set +a
CTX="$E2E_CONTEXT_ID"; URL="$E2E_NODE_URL"; TOK="$E2E_ACCESS_TOKEN"
[ -n "$CTX" ] || { red "no context id"; exit 1; }
green "node up, context $CTX"

# call <method> <argsJson> → prints .result.output (compact)
call() {
  curl -sf -X POST "$URL/jsonrpc" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"execute\",\"params\":{\"contextId\":\"$CTX\",\"method\":\"$1\",\"argsJson\":$2}}" \
    | jq -c '.result.output'
}
assert_eq()       { [ "$2" = "$3" ] && green "$1" || red "$1 (got '$2', want '$3')"; }
assert_contains() { echo "$2" | grep -q "$3" && green "$1" || red "$1 (got '$2')"; }

# ── Assertions ──────────────────────────────────────────────────────────────
step "Space starts empty"
assert_eq "trackerCount=0" "$(call get_space '{}' | jq -r '.trackerCount')" "0"

step "create_tracker"
assert_eq "returns id" "$(call create_tracker '{"id":"t1","name":"Phone","owner_id":"admin","created_at":1000}' | jq -r '.')" "t1"

step "update_location → get_trackers reflects latest"
call update_location '{"tracker_id":"t1","latitude":40.1,"longitude":-74.2,"altitude":10,"speed":1.5,"heading":90,"battery":88,"timestamp":2000}' >/dev/null
assert_eq "battery=88"      "$(call get_trackers '{}' | jq -r '.[0].latest.battery')" "88"
assert_eq "ts=2000"         "$(call get_trackers '{}' | jq -r '.[0].latest.timestamp')" "2000"

step "out-of-order update is rejected (stale timestamp)"
call update_location '{"tracker_id":"t1","latitude":0,"longitude":0,"altitude":0,"speed":0,"heading":0,"battery":1,"timestamp":1500}' >/dev/null
assert_eq "battery still 88" "$(call get_trackers '{}' | jq -r '.[0].latest.battery')" "88"

step "history accumulates"
HCOUNT="$(call get_history '{"tracker_id":"t1","since":0}' | jq -r 'length')"
[ "$HCOUNT" -ge 1 ] && green "history has $HCOUNT sample(s)" || red "history empty"

step "share_tracker adds a viewer"
call share_tracker '{"tracker_id":"t1","user_id":"bob","updated_at":3000}' >/dev/null
assert_contains "viewers contains bob" "$(call get_trackers '{}' | jq -c '.[0].viewers')" "bob"

step "geofence create + list"
call create_geofence '{"id":"g1","name":"Home","center_lat":40.1,"center_lng":-74.2,"radius":100,"created_by":"admin","created_at":4000}' >/dev/null
assert_eq "geofence name" "$(call get_geofences '{}' | jq -r '.[0].name')" "Home"

step "delete_tracker removes it"
call delete_tracker '{"id":"t1"}' >/dev/null
assert_eq "trackerCount=0" "$(call get_space '{}' | jq -r '.trackerCount')" "0"

# ── Summary ─────────────────────────────────────────────────────────────────
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32m  ✅ integration: %d passed\033[0m\n\n' "$PASS"; exit 0
else
  printf '\033[1;31m  ❌ integration: %d passed, %d failed\033[0m\n\n' "$PASS" "$FAIL"; exit 1
fi
