#!/usr/bin/env bash
# Invite node2 into node1's workspace (run after both nodes are up).
set -euo pipefail

NODE1_URL="${MERODESIGN_NODE1_URL:-http://localhost:2430}"
NODE2_URL="${MERODESIGN_NODE2_URL:-http://localhost:2431}"
ADMIN_USER="${E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${E2E_ADMIN_PASS:-calimero1234}"

green() { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
red()   { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()  { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

auth() {
  local url="$1"
  curl -sf -X POST "${url}/auth/token" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg u "$ADMIN_USER" --arg p "$ADMIN_PASS" \
      '{auth_method:"user_password",public_key:$u,client_name:"dev-invite.sh",timestamp:0,permissions:[],provider_data:{username:$u,password:$p}}')" \
    | jq -r '.data.access_token // empty'
}

step "Authenticating both nodes"
TOKEN1=$(auth "$NODE1_URL") || { red "Node1 auth failed"; exit 1; }
TOKEN2=$(auth "$NODE2_URL") || { red "Node2 auth failed"; exit 1; }
green "Both nodes authenticated"

step "Finding namespace on node1"
NS_ID=$(curl -sf "${NODE1_URL}/admin-api/namespaces" \
  -H "Authorization: Bearer ${TOKEN1}" \
  | jq -r '.data.namespaces[0].namespaceId // .data.groups[0].groupId // empty')
[ -n "$NS_ID" ] || { red "No namespace found on node1"; exit 1; }
green "Namespace: $NS_ID"

step "Creating invitation"
INV=$(curl -sf -X POST "${NODE1_URL}/admin-api/namespaces/${NS_ID}/invitations" \
  -H "Authorization: Bearer ${TOKEN1}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.data.invitation // .data // empty')
[ -n "$INV" ] || { red "Could not create invitation"; exit 1; }
green "Invitation created"

step "Node2 joining namespace"
curl -sf -X POST "${NODE2_URL}/admin-api/groups/join" \
  -H "Authorization: Bearer ${TOKEN2}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg inv "$INV" '{invitation: $inv}')" &>/dev/null
green "Node2 joined workspace"
