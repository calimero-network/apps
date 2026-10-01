# Case 01 — namespace membership cross-node visibility.
#
# Setup-nodes.sh has already invited node-2 into node-1's namespace.
# Verify both nodes see each other in the namespace member list.

if [ -z "${E2E_GROUP_ID:-}" ]; then
  red "E2E_GROUP_ID empty — setup-nodes.sh hasn't created a namespace"
  ASSERT_FAIL=$((ASSERT_FAIL+1))
  return
fi

# Node 1's view of namespace members.
members_n1=$(GET "$NODE_1_URL" "/admin-api/groups/${E2E_GROUP_ID}/members" "$AUTH_TOKEN_N1") \
  || { red "node-1 GET members failed"; ASSERT_FAIL=$((ASSERT_FAIL+1)); return; }

# Node 2's view of namespace members.
members_n2=$(GET "$NODE_2_URL" "/admin-api/groups/${E2E_GROUP_ID}/members" "$AUTH_TOKEN_N2") \
  || { red "node-2 GET members failed"; ASSERT_FAIL=$((ASSERT_FAIL+1)); return; }

# Both nodes should report at least 2 members.
# Response shape is `{ members: [...], selfIdentity: "…" }` — see
# mero-js PR #20 / fix(hooks):read-members-field. Old `.data` is gone.
n1_count=$(echo "$members_n1" | jq -r '.members | length // 0' 2>/dev/null || echo 0)
n2_count=$(echo "$members_n2" | jq -r '.members | length // 0' 2>/dev/null || echo 0)

assert_eq "true" "$([ "$n1_count" -ge 2 ] && echo true || echo false)" \
  "node-1 sees ≥2 members in namespace (got $n1_count)"
assert_eq "true" "$([ "$n2_count" -ge 2 ] && echo true || echo false)" \
  "node-2 sees ≥2 members in namespace (got $n2_count)"

# Cross-check: each side's identity should appear in the other's list.
mk1="${E2E_MEMBER_KEY:-}"
mk2="${E2E_MEMBER_KEY_2:-}"
if [ -n "$mk1" ]; then
  assert_contains "$members_n2" "$mk1" "node-2 sees node-1's identity"
fi
if [ -n "$mk2" ]; then
  assert_contains "$members_n1" "$mk2" "node-1 sees node-2's identity"
fi
