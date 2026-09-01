#!/usr/bin/env bash
# scripts/dev-invite.sh — Make node2 a member of node1's room.
#
# Reads app/.env.dev-call, generates a namespace invitation on node1, joins it
# from node2, syncs, then joins the room context — so node2 has its own member
# identity in the same room. Writes node2's identity back to the env file.
#
# Run after dev-node.sh + dev-node2.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/app/.env.dev-call"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

[ -f "$ENV_FILE" ] || { red "$ENV_FILE not found — run dev-node.sh + dev-node2.sh first"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

for var in DEV_NODE_URL DEV_NODE_URL_2 DEV_ACCESS_TOKEN DEV_ACCESS_TOKEN_2 DEV_NAMESPACE_ID DEV_CONTEXT_ID; do
  [ -n "${!var:-}" ] || { red "$var missing in $ENV_FILE"; exit 1; }
done

N1="$DEV_NODE_URL"; N2="$DEV_NODE_URL_2"
T1="$DEV_ACCESS_TOKEN"; T2="$DEV_ACCESS_TOKEN_2"
NS="$DEV_NAMESPACE_ID"; CTX="$DEV_CONTEXT_ID"

# ── 1. Invitation on node1 ────────────────────────────────────────────────────
step "Generating namespace invitation on node1"
INVITE_RES=$(curl -sf -X POST "${N1}/admin-api/namespaces/${NS}/invite" \
  -H "Authorization: Bearer ${T1}" -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null) || INVITE_RES="{}"
INVITE_DATA=$(echo "$INVITE_RES" | jq '.data.invitation // empty')
[ -n "$INVITE_DATA" ] && [ "$INVITE_DATA" != "null" ] \
  || { red "Invitation empty"; echo "$INVITE_RES" >&2; exit 1; }
green "Invitation generated"

# ── 2. Node2 joins the namespace (retry: mesh peers take a moment) ────────────
step "Node2 joining namespace $NS"
JOIN_BODY=$(jq -n --argjson inv "$INVITE_DATA" '{invitation: $inv}')
JOIN_OK=0
for i in $(seq 1 8); do
  RESP_FILE=$(mktemp)
  CODE=$(curl -sS -X POST "${N2}/admin-api/namespaces/${NS}/join" \
    -H "Authorization: Bearer ${T2}" -H "Content-Type: application/json" \
    -d "$JOIN_BODY" -o "$RESP_FILE" -w "%{http_code}" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ] || [ "$CODE" = "204" ]; then
    rm -f "$RESP_FILE"; green "Joined namespace (attempt $i)"; JOIN_OK=1; break
  fi
  ERR=$(jq -r '.error.message // .message // empty' "$RESP_FILE" 2>/dev/null || cat "$RESP_FILE")
  rm -f "$RESP_FILE"
  if echo "$ERR" | grep -q "no mesh peers"; then
    [ "$i" -eq 1 ] && yellow "Waiting for node2 to peer with node1 over libp2p..."
    sleep 1; continue
  fi
  red "Namespace join failed (HTTP $CODE): $ERR"; exit 1
done
[ "$JOIN_OK" -eq 1 ] || { red "Namespace join failed after 8 attempts (no mesh peers)"; exit 1; }

# ── 3. Sync ───────────────────────────────────────────────────────────────────
step "Syncing namespace to node2"
curl -sf -X POST "${N2}/admin-api/groups/${NS}/sync" \
  -H "Authorization: Bearer ${T2}" -H "Content-Type: application/json" -d '{}' &>/dev/null \
  && green "Sync triggered" || yellow "Sync failed (non-fatal)"

# ── 4. Node2 joins the room context ───────────────────────────────────────────
step "Node2 joining room context $CTX"
sleep 2
JOIN_CTX=$(curl -sf -X POST "${N2}/admin-api/contexts/${CTX}/join" \
  -H "Authorization: Bearer ${T2}" -H "Content-Type: application/json" -d '{}' 2>/dev/null) || JOIN_CTX="{}"
MEMBER_KEY_2=$(echo "$JOIN_CTX" | jq -r '.data.memberPublicKey // .data.member_public_key // empty')
if [ -z "$MEMBER_KEY_2" ]; then
  for _ in $(seq 1 10); do
    MEMBER_KEY_2=$(curl -sf "${N2}/admin-api/contexts/${CTX}/identities-owned" \
      -H "Authorization: Bearer ${T2}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' 2>/dev/null || true)
    [ -n "$MEMBER_KEY_2" ] && [ "$MEMBER_KEY_2" != "null" ] && break
    sleep 1
  done
fi
[ -n "$MEMBER_KEY_2" ] && [ "$MEMBER_KEY_2" != "null" ] \
  || { red "Could not get node2 member key (context may still be syncing)"; exit 1; }
green "Node2 identity: $MEMBER_KEY_2"

sed -i.bak -e "s|^DEV_MEMBER_KEY_2=.*|DEV_MEMBER_KEY_2=${MEMBER_KEY_2}|" "$ENV_FILE" \
  && rm -f "${ENV_FILE}.bak"
green "Updated $ENV_FILE"

printf '\n\033[1;32m  Both nodes are members of the room.\033[0m\n'
printf '  Next:  \033[36mmake dev   # vite\033[0m  +  \033[36m./scripts/dev-call.sh\033[0m\n\n'
