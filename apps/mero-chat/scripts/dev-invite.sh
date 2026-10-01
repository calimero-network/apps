#!/usr/bin/env bash
# scripts/dev-invite.sh — Invite node2 into node1's dev workspace.
#
# Run after dev-node.sh + dev-node2.sh. Reads tokens / IDs from
# app/.env.integration and performs the invite → join → sync → channel-join
# handshake so node2 lands directly inside node1's namespace and #general
# channel — no manual webapp clicks required.
#
# Usage:
#   ./scripts/dev-invite.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/app/.env.integration"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

[ -f "$ENV_FILE" ] || { red "$ENV_FILE not found — run dev-node.sh and dev-node2.sh first"; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

NODE_1_URL="${E2E_NODE_URL:-}"
NODE_2_URL="${E2E_NODE_URL_2:-}"
ACCESS_TOKEN_1="${E2E_ACCESS_TOKEN:-}"
ACCESS_TOKEN_2="${E2E_ACCESS_TOKEN_2:-}"
GROUP_ID="${E2E_GROUP_ID:-}"

for var in NODE_1_URL NODE_2_URL ACCESS_TOKEN_1 ACCESS_TOKEN_2 GROUP_ID; do
  [ -n "${!var:-}" ] || { red "$var missing in $ENV_FILE"; exit 1; }
done

# ── 1. Generate namespace invitation on node1 ────────────────────────────────

step "Generating namespace invitation on node1"
INVITE_RES=$(curl -sf -X POST "${NODE_1_URL}/admin-api/namespaces/${GROUP_ID}/invite" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_1}" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null) || INVITE_RES="{}"
INVITE_DATA=$(echo "$INVITE_RES" | jq '.data.invitation // empty' 2>/dev/null)
[ -n "$INVITE_DATA" ] && [ "$INVITE_DATA" != "null" ] \
  || { red "Invitation empty"; echo "$INVITE_RES" >&2; exit 1; }
green "Invitation generated"

# ── 2. Node2 joins the namespace ─────────────────────────────────────────────

step "Node2 joining namespace $GROUP_ID"
# Retry on "no mesh peers for namespace" — node2 needs time to discover node1
# on libp2p (mDNS/rendezvous) before the gossipsub mesh for this namespace
# topic exists. The server-side join waits ~10s for mesh peers internally,
# so each failed attempt is itself a backoff.
JOIN_BODY=$(jq -n --argjson inv "$INVITE_DATA" '{invitation: $inv}')
JOIN_OK=0
for i in $(seq 1 5); do
  JOIN_RES_FILE=$(mktemp)
  JOIN_HTTP=$(curl -sS -X POST "${NODE_2_URL}/admin-api/namespaces/${GROUP_ID}/join" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
    -H "Content-Type: application/json" \
    -d "$JOIN_BODY" -o "$JOIN_RES_FILE" -w "%{http_code}" 2>/dev/null || echo "000")
  if [ "$JOIN_HTTP" = "200" ] || [ "$JOIN_HTTP" = "201" ] || [ "$JOIN_HTTP" = "204" ]; then
    rm -f "$JOIN_RES_FILE"
    green "Joined namespace (attempt $i)"
    JOIN_OK=1
    break
  fi
  JOIN_ERR=$(jq -r '.error.message // .message // empty' "$JOIN_RES_FILE" 2>/dev/null || cat "$JOIN_RES_FILE")
  rm -f "$JOIN_RES_FILE"
  if echo "$JOIN_ERR" | grep -q "no mesh peers"; then
    [ "$i" -eq 1 ] && yellow "Waiting for node2 to peer with node1 over libp2p..."
    sleep 1
    continue
  fi
  red "Namespace join failed (HTTP $JOIN_HTTP): $JOIN_ERR"
  exit 1
done
[ "$JOIN_OK" -eq 1 ] || { red "Namespace join failed after 5 attempts: no mesh peers"; exit 1; }

# ── 3. Sync namespace to node2 ───────────────────────────────────────────────

step "Syncing namespace to node2"
curl -sf -X POST "${NODE_2_URL}/admin-api/groups/${GROUP_ID}/sync" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
  -H "Content-Type: application/json" -d '{}' &>/dev/null \
  && green "Sync triggered" || yellow "Sync failed (non-fatal)"

# ── 4. Node2 joins the #general context ──────────────────────────────────────

CONTEXT_ID="${E2E_CONTEXT_ID:-}"
MEMBER_KEY_2=""

if [ -n "$CONTEXT_ID" ]; then
  step "Node2 joining context $CONTEXT_ID"

  # Give node2 a moment to sync before joining
  sleep 2

  JOIN_CTX=$(curl -sf -X POST "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/join" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
    -H "Content-Type: application/json" -d '{}' 2>/dev/null) || JOIN_CTX="{}"
  MEMBER_KEY_2=$(echo "$JOIN_CTX" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)

  if [ -z "$MEMBER_KEY_2" ]; then
    MEMBER_KEY_2=$(curl -sf "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
      -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null \
      | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' \
      2>/dev/null || true)
  fi

  if [ -n "$MEMBER_KEY_2" ]; then
    green "Node2 member key: $MEMBER_KEY_2"
    sed -i.bak -e "s|^E2E_MEMBER_KEY_2=.*|E2E_MEMBER_KEY_2=${MEMBER_KEY_2}|" "$ENV_FILE" \
      && rm -f "${ENV_FILE}.bak"
    green "Updated $ENV_FILE with node2 member key"
  else
    yellow "Could not get node2 member key (2-node RPC tests will skip)"
  fi
else
  yellow "E2E_CONTEXT_ID not set in $ENV_FILE — skipping node2 context join"
fi

printf '\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Node2 invited into node1 workspace\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\n'
printf '  Workspace:  %s\n' "$GROUP_ID"
printf '  Both nodes are members — create channels and DMs from the app.\n'
printf '\n'
