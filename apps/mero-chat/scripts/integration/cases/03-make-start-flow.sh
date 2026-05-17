# Case 03 — full make-start dev flow: bidirectional WASM messaging.
#
# Most useful regression test for the dev experience the user actually
# uses (`make start`). Verifies that:
#   - both nodes see the same namespace + general channel
#   - alice can post and bob receives via CRDT sync
#   - bob can post and alice receives
#   - get_messages from each node returns BOTH messages
#
# This is the same scenario as merobox's `e2e-v2.yml` but via shell
# against whichever flow brought the nodes up. Independent verification
# (different code paths than merobox) — if both pass, we're confident
# the rc.35 baseline isn't broken.

if [ -z "${E2E_GROUP_ID:-}" ] \
   || [ -z "${E2E_CONTEXT_ID:-}" ] \
   || [ -z "${E2E_MEMBER_KEY:-}" ] \
   || [ -z "${E2E_MEMBER_KEY_2:-}" ]; then
  red "missing E2E env (group/context/member-key)"
  ASSERT_FAIL=$((ASSERT_FAIL+1))
  return
fi

# Helper: send a message via JSON-RPC `execute`.
rpc_send_message() {
  local url="$1" token="$2" ctx="$3" exec_pk="$4" text="$5" ts="$6" sender="$7"
  curl -s -X POST "${url}/jsonrpc" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg ctx "$ctx" \
      --arg exec "$exec_pk" \
      --arg msg "$text" \
      --arg sender "$sender" \
      --argjson ts "$ts" \
      '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "execute",
        "params": {
          "contextId": $ctx,
          "method": "send_message",
          "argsJson": {
            "message": $msg,
            "mentions": [],
            "mentions_usernames": [],
            "parent_message": null,
            "timestamp": $ts,
            "sender_username": $sender,
            "files": null,
            "images": null
          },
          "executorPublicKey": $exec
        }
      }')"
}

rpc_get_messages() {
  local url="$1" token="$2" ctx="$3" exec_pk="$4"
  curl -s -X POST "${url}/jsonrpc" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg ctx "$ctx" \
      --arg exec "$exec_pk" \
      '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "execute",
        "params": {
          "contextId": $ctx,
          "method": "get_messages",
          "argsJson": { "start_position": 0, "limit": 50, "thread_parent_id": null },
          "executorPublicKey": $exec
        }
      }')"
}

# ── Send from each side ──────────────────────────────────────────────────
ts1=$(date +%s)
ts2=$((ts1+1))
ALICE_MSG="alice-shell-driver-$ts1"
BOB_MSG="bob-shell-driver-$ts2"

resp_send_a=$(rpc_send_message "$NODE_1_URL" "$AUTH_TOKEN_N1" \
  "$E2E_CONTEXT_ID" "$E2E_MEMBER_KEY" "$ALICE_MSG" "$ts1" "Alice")
err_a=$(echo "$resp_send_a" | jq -r '.error.message // empty' 2>/dev/null)
if [ -n "$err_a" ]; then
  red "alice send_message failed: $err_a"
  ASSERT_FAIL=$((ASSERT_FAIL+1))
  return
fi

resp_send_b=$(rpc_send_message "$NODE_2_URL" "$AUTH_TOKEN_N2" \
  "$E2E_CONTEXT_ID" "$E2E_MEMBER_KEY_2" "$BOB_MSG" "$ts2" "Bob")
err_b=$(echo "$resp_send_b" | jq -r '.error.message // empty' 2>/dev/null)
if [ -n "$err_b" ]; then
  red "bob send_message failed: $err_b"
  ASSERT_FAIL=$((ASSERT_FAIL+1))
  return
fi

# ── Wait for CRDT sync ───────────────────────────────────────────────────
# Poll up to 20s for both messages to land on both nodes.
deadline=$(( $(date +%s) + 20 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  msgs_n1=$(rpc_get_messages "$NODE_1_URL" "$AUTH_TOKEN_N1" \
    "$E2E_CONTEXT_ID" "$E2E_MEMBER_KEY")
  msgs_n2=$(rpc_get_messages "$NODE_2_URL" "$AUTH_TOKEN_N2" \
    "$E2E_CONTEXT_ID" "$E2E_MEMBER_KEY_2")
  if echo "$msgs_n1" | grep -qF "$BOB_MSG" && \
     echo "$msgs_n2" | grep -qF "$ALICE_MSG"; then
    break
  fi
  sleep 1
done

# ── Cross-node assertions ────────────────────────────────────────────────
assert_contains "$msgs_n1" "$ALICE_MSG" "node-1 sees alice's own message"
assert_contains "$msgs_n1" "$BOB_MSG"   "node-1 sees bob's message (CRDT sync n2→n1)"
assert_contains "$msgs_n2" "$ALICE_MSG" "node-2 sees alice's message (CRDT sync n1→n2)"
assert_contains "$msgs_n2" "$BOB_MSG"   "node-2 sees bob's own message"
