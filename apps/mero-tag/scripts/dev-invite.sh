#!/usr/bin/env bash
# scripts/dev-invite.sh — Invite node2 into node1's tracking space.
#
# Run after dev-node.sh + dev-node2.sh. Reads tokens/IDs from
# app/.env.integration and performs invite → join → sync → context-join so
# node2 lands inside node1's space with no manual clicks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/app/.env.integration"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

[ -f "$ENV_FILE" ] || { red "$ENV_FILE not found — run make node + node2 first"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

NODE_1_URL="${E2E_NODE_URL:-}"
NODE_2_URL="${E2E_NODE_URL_2:-}"
ACCESS_TOKEN_1="${E2E_ACCESS_TOKEN:-}"
ACCESS_TOKEN_2="${E2E_ACCESS_TOKEN_2:-}"
GROUP_ID="${E2E_GROUP_ID:-}"
CONTEXT_ID="${E2E_CONTEXT_ID:-}"

for var in NODE_1_URL NODE_2_URL ACCESS_TOKEN_1 ACCESS_TOKEN_2 GROUP_ID; do
  [ -n "${!var:-}" ] || { red "$var missing in $ENV_FILE"; exit 1; }
done

step "Generating namespace invitation on node1"
INVITE_RES=$(curl -sf -X POST "${NODE_1_URL}/admin-api/namespaces/${GROUP_ID}/invite" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_1}" -H "Content-Type: application/json" -d '{}' 2>/dev/null) || INVITE_RES="{}"
INVITE_DATA=$(echo "$INVITE_RES" | jq '.data.invitation // empty' 2>/dev/null)
[ -n "$INVITE_DATA" ] && [ "$INVITE_DATA" != "null" ] || { red "Invitation empty"; echo "$INVITE_RES" >&2; exit 1; }
green "Invitation generated"

step "Node2 joining namespace $GROUP_ID"
JOIN_BODY=$(jq -n --argjson inv "$INVITE_DATA" '{invitation: $inv}')
JOIN_OK=0
for i in $(seq 1 5); do
  F=$(mktemp)
  CODE=$(curl -sS -X POST "${NODE_2_URL}/admin-api/namespaces/${GROUP_ID}/join" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" -H "Content-Type: application/json" \
    -d "$JOIN_BODY" -o "$F" -w "%{http_code}" 2>/dev/null || echo "000")
  case "$CODE" in
    200|201|204) rm -f "$F"; green "Joined namespace (attempt $i)"; JOIN_OK=1; break ;;
  esac
  ERR=$(jq -r '.error.message // .message // empty' "$F" 2>/dev/null || cat "$F"); rm -f "$F"
  if echo "$ERR" | grep -q "no mesh peers"; then
    [ "$i" -eq 1 ] && yellow "Waiting for node2 to peer with node1..."; sleep 2; continue
  fi
  red "Namespace join failed (HTTP $CODE): $ERR"; exit 1
done
[ "$JOIN_OK" -eq 1 ] || { red "Join failed after 5 attempts (check bootstrap)"; exit 1; }

step "Syncing namespace to node2"
curl -sf -X POST "${NODE_2_URL}/admin-api/groups/${GROUP_ID}/sync" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_2}" -H "Content-Type: application/json" -d '{}' &>/dev/null \
  && green "Sync triggered" || yellow "Sync failed (non-fatal)"

if [ -n "$CONTEXT_ID" ]; then
  step "Node2 joining tracking-space context $CONTEXT_ID"
  sleep 2
  JOIN_CTX=$(curl -sf -X POST "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/join" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" -H "Content-Type: application/json" -d '{}' 2>/dev/null) || JOIN_CTX="{}"
  MEMBER_KEY_2=$(echo "$JOIN_CTX" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
  if [ -z "$MEMBER_KEY_2" ]; then
    MEMBER_KEY_2=$(curl -sf "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' 2>/dev/null || true)
  fi
  if [ -n "$MEMBER_KEY_2" ]; then
    green "Node2 member key: $MEMBER_KEY_2"
    grep -q '^E2E_MEMBER_KEY_2=' "$ENV_FILE" || printf 'E2E_MEMBER_KEY_2=\n' >> "$ENV_FILE"
    sed -i.bak -e "s|^E2E_MEMBER_KEY_2=.*|E2E_MEMBER_KEY_2=${MEMBER_KEY_2}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    yellow "Could not get node2 member key"
  fi
else
  yellow "E2E_CONTEXT_ID not set — skipping context join"
fi

printf '\n\033[1;32m  Node2 invited into node1 space\033[0m\n'
printf '  Space:    %s\n' "$GROUP_ID"
[ -n "${CONTEXT_ID:-}" ] && printf '  Context:  %s\n' "$CONTEXT_ID"
printf '  Both nodes now share the same tracking space.\n\n'
