# Case 02 — rc.35 non-admin context creation reveals exact error message.
#
# This case demonstrates *why* the merobox `non-admin-creates.yml`
# workflow fails on rc.35 — it captures the actual HTTP response body
# from `POST /admin-api/contexts` instead of merobox's generic
# "create_context failed" wrapper.
#
# Setup-nodes.sh has already added node-2 to node-1's namespace via the
# webapp/setup invitation flow. We try to have node-2 create a new
# context and assert the response body reveals one of the two known
# rc.35 failure modes.

if [ -z "${E2E_GROUP_ID:-}" ] || [ -z "${E2E_NODE_URL_2:-}" ]; then
  red "missing E2E env (group_id / node-2 URL)"
  ASSERT_FAIL=$((ASSERT_FAIL+1))
  return
fi

# Find an application_id node-2 has installed locally.
apps_n2=$(GET_RAW "$NODE_2_URL" "/admin-api/applications" "$AUTH_TOKEN_N2")
app_id=$(echo "$apps_n2" | jq -r '.data.apps[0].id // empty' 2>/dev/null)

if [ -z "$app_id" ]; then
  yellow "node-2 has no application installed — skipping case"
  return
fi

# Build init params for a context_type=Channel, name=rc35-probe.
init_json='{"name":"rc35-probe","context_type":"Channel","description":"probing rc.35 non-admin gate","created_at":1751956000,"creator_username":""}'
init_bytes=$(printf '%s' "$init_json" | python3 -c "import sys; d=sys.stdin.buffer.read(); print('['+','.join(str(b) for b in d)+']')")

body=$(jq -n \
  --arg appId "$app_id" \
  --arg groupId "$E2E_GROUP_ID" \
  --argjson initParams "$init_bytes" \
  '{applicationId: $appId, protocol: "near", groupId: $groupId, alias: "rc35-probe", initializationParams: $initParams}')

# POST to node-2 (non-admin from namespace's POV) and capture the raw response
# WITH the HTTP status code on a separate line so we can reason about both.
http_status=$(curl -s -o /tmp/rc35-probe.body -w "%{http_code}" \
  -X POST "${NODE_2_URL}/admin-api/contexts" \
  -H "Authorization: Bearer ${AUTH_TOKEN_N2}" \
  -H "Content-Type: application/json" \
  -d "$body")
response_body=$(cat /tmp/rc35-probe.body)

if [ "$http_status" = "200" ] || [ "$http_status" = "201" ]; then
  yellow "Non-admin context creation SUCCEEDED on node-2 (HTTP $http_status) — newer merod or caps were granted?"
  green "PASS: success path"
  ASSERT_PASS=$((ASSERT_PASS+1))
  return
fi

# What we actually see on rc.35 + setup-nodes.sh's namespace (where
# defaultCapabilities aren't explicitly granted): server rejects the
# request with a permission error citing CAN_CREATE_CONTEXT.
# This is DIFFERENT from the merobox `non-admin-creates.yml` failure
# (which sets caps=15 and runs into the 'application not found' /
# governance-propagation bug instead). Both are real rc.35 gaps.
echo "  HTTP $http_status — body: $response_body" | head -c 400
echo
assert_contains "$response_body" "CAN_CREATE_CONTEXT" \
  "non-admin context creation rejected with capability error (rc.35 default-cap gap)"
