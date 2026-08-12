#!/usr/bin/env bash
# scripts/integration-test.sh — end-to-end contract test against a real node.
#
# Brings up node1 (via dev-node.sh), deploys the WASM, drives the scene-graph
# contract over JSON-RPC `execute`, asserts behavior, then tears down.
#
# Run with:  make logic-e2e   (opt-in; heavier than `cargo test`).

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

step "Starting node + deploying contract"
bash "$SCRIPT_DIR/dev-node.sh" >/dev/null 2>&1 || { red "dev-node.sh failed"; exit 1; }
[ -f "$ENV_FILE" ] || { red "no .env.integration"; exit 1; }
set -a; . "$ENV_FILE"; set +a
CTX="$E2E_CONTEXT_ID"; URL="$E2E_NODE_URL"; TOK="$E2E_ACCESS_TOKEN"
# Since core rc.20 the contract attributes every write to the signing identity,
# so calls must name one: without `executorPublicKey` the node picks the
# context's default identity and the assertions below can't check attribution.
MEMBER="${E2E_MEMBER_KEY:-}"
[ -n "$CTX" ] || { red "no context id"; exit 1; }
green "node up, context $CTX"

call() {
  curl -sf -X POST "$URL/jsonrpc" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"execute\",\"params\":{\"contextId\":\"$CTX\",\"method\":\"$1\",\"argsJson\":$2,\"executorPublicKey\":\"$MEMBER\"}}" \
    | jq -c '.result.output'
}
assert_eq()  { [ "$2" = "$3" ] && green "$1" || red "$1 (got '$2', want '$3')"; }
# Numeric compare (tolerates 5 vs 5.0 float formatting from jq/serde_json).
assert_num() { awk -v a="$2" -v b="$3" 'BEGIN{exit !(a==b)}' && green "$1" || red "$1 (got '$2', want '$3')"; }

# `createdBy` is a deliberate lie: the contract must replace it with the signer.
CUBE='{"object":{"id":"o1","data":{"kind":"cube"},"transform":{"position":{"x":1,"y":0.5,"z":-2},"rotation":{"x":0,"y":0,"z":0,"w":1},"scale":{"x":1,"y":1,"z":1}},"color":"3A86FF","lockedBy":null,"createdBy":"spoofed","createdAt":1000,"updatedAt":1000,"version":0}}'
MV='{"id":"o1","transform":{"position":{"x":%s,"y":1,"z":-3},"rotation":{"x":0,"y":0,"z":0,"w":1},"scale":{"x":1,"y":1,"z":1}},"updated_at":%s}'

[ -n "$MEMBER" ] || { red "no member public key in .env.integration"; exit 1; }

step "Room starts empty, creator is admin"
assert_eq "objectCount=0" "$(call get_room '{}' | jq -r '.objectCount')" "0"
assert_eq "my_role=admin" "$(call my_role '{}' | jq -r '.')" "admin"
assert_eq "can_edit=true" "$(call can_edit '{}' | jq -r '.')" "true"

step "add_object cube (attribution comes from the signer)"
assert_eq "returns id" "$(call add_object "$CUBE" | jq -r '.')" "o1"
assert_eq "createdBy=signer" "$(call get_object '{"id":"o1"}' | jq -r '.createdBy')" "$MEMBER"

step "update_transform moves the object"
call update_transform "$(printf "$MV" 5 2000)" >/dev/null
assert_num "position.x=5" "$(call get_object '{"id":"o1"}' | jq -r '.transform.position.x')" "5"

step "lock is taken in the caller's own name"
call lock_object '{"id":"o1"}' >/dev/null
assert_eq "lockedBy=signer" "$(call get_object '{"id":"o1"}' | jq -r '.lockedBy')" "$MEMBER"

step "lock holder can still move it"
call update_transform "$(printf "$MV" 7 4000)" >/dev/null
assert_num "position.x=7" "$(call get_object '{"id":"o1"}' | jq -r '.transform.position.x')" "7"

step "colour honours the same lock"
call update_color '{"id":"o1","color":"FF00AA","updated_at":4500}' >/dev/null
assert_eq "color=FF00AA" "$(call get_object '{"id":"o1"}' | jq -r '.color')" "FF00AA"

step "unlock then edit again"
call unlock_object '{"id":"o1"}' >/dev/null
assert_eq "lockedBy=null" "$(call get_object '{"id":"o1"}' | jq -r '.lockedBy')" "null"
call update_transform "$(printf "$MV" 9 5000)" >/dev/null
assert_num "position.x=9" "$(call get_object '{"id":"o1"}' | jq -r '.transform.position.x')" "9"

step "presence + comment are keyed to the signer"
call update_presence '{"camera_position":{"x":0,"y":1.6,"z":0},"camera_rotation":{"x":0,"y":0,"z":0,"w":1},"updated_at":6000}' >/dev/null
assert_eq "presence count=1" "$(call get_presence '{}' | jq -r 'length')" "1"
assert_eq "presence identity=signer" "$(call get_presence '{}' | jq -r '.[0].identity')" "$MEMBER"
call add_comment '{"id":"c1","text":"note","position":{"x":0,"y":0,"z":0},"created_at":7000}' >/dev/null
assert_eq "comment text" "$(call get_comments '{}' | jq -r '.[0].text')" "note"
assert_eq "comment author=signer" "$(call get_comments '{}' | jq -r '.[0].author')" "$MEMBER"

step "owner-gated rename"
call rename_room '{"name":"Renamed Studio"}' >/dev/null
assert_eq "room name" "$(call get_room '{}' | jq -r '.name')" "Renamed Studio"
assert_eq "owner=signer" "$(call get_room '{}' | jq -r '.owner')" "$MEMBER"

step "delete_object"
call delete_object '{"id":"o1"}' >/dev/null
assert_eq "objectCount=0" "$(call get_room '{}' | jq -r '.objectCount')" "0"

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32m  ✅ integration: %d passed\033[0m\n\n' "$PASS"; exit 0
else
  printf '\033[1;31m  ❌ integration: %d passed, %d failed\033[0m\n\n' "$PASS" "$FAIL"; exit 1
fi
