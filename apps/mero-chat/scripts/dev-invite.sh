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
CONTEXT_ID="${E2E_CONTEXT_ID:-}"

for var in NODE_1_URL NODE_2_URL ACCESS_TOKEN_1 ACCESS_TOKEN_2 GROUP_ID CONTEXT_ID; do
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

# ── 3b. Discover the #general subgroup (1-group-per-context model) ───────────
# Each channel = its own open subgroup under the namespace with one context
# inside. Default namespace caps grant CAN_CREATE_SUBGROUP / DELETE / VISIBILITY
# (rc.37) so node2 can also create its own channels after this.

step "Discovering #general subgroup on node1"
SUBGROUPS_JSON=$(curl -sf "${NODE_1_URL}/admin-api/groups/${GROUP_ID}/subgroups" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_1}" 2>/dev/null) || SUBGROUPS_JSON='{"subgroups":[]}'

GENERAL_SG_ID=$(echo "$SUBGROUPS_JSON" \
  | jq -r '(.subgroups // []) | map(select(.alias=="general")) | .[0].groupId // empty')

[ -n "$GENERAL_SG_ID" ] && green "general subgroup : $GENERAL_SG_ID" || yellow "general subgroup not found (non-fatal)"

# ── 4. Wait for #general context to surface on node2, then join it ───────────

step "Waiting for #general to appear on node2"
GENERAL_PARENT="${GENERAL_SG_ID:-$GROUP_ID}"
for i in $(seq 1 30); do
  CTXS_2=$(curl -sf "${NODE_2_URL}/admin-api/groups/${GENERAL_PARENT}/contexts" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null) || CTXS_2="{}"
  if echo "$CTXS_2" | jq -e \
      --arg id "$CONTEXT_ID" \
      '(.data // .) | if type=="array" then .[] | select(.contextId==$id or .id==$id) else empty end' \
      >/dev/null 2>&1; then
    green "Channel visible on node2 (attempt $i)"
    break
  fi
  [ "$i" -eq 30 ] && yellow "Context not visible after 60s — proceeding anyway"
  sleep 2
done

step "Node2 joining #general channel"
JOIN_CTX=$(curl -sf -X POST "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/join" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_2}" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null) || JOIN_CTX="{}"
MEMBER_KEY_2=$(echo "$JOIN_CTX" | jq -r '.data.memberPublicKey // .data.member_public_key // empty' 2>/dev/null || true)
if [ -z "$MEMBER_KEY_2" ]; then
  MEMBER_KEY_2=$(curl -sf "${NODE_2_URL}/admin-api/contexts/${CONTEXT_ID}/identities-owned" \
    -H "Authorization: Bearer ${ACCESS_TOKEN_2}" 2>/dev/null \
    | jq -r '(.data // .) | if type=="array" then .[0] else (.identities[0] // .items[0]) end' 2>/dev/null || true)
fi
[ -n "$MEMBER_KEY_2" ] && green "Joined channel (identity: $MEMBER_KEY_2)" \
  || yellow "Could not resolve node2 member key (non-fatal)"

# ── 5. Persist node2 member key to .env.integration ──────────────────────────

if [ -n "$MEMBER_KEY_2" ]; then
  sed -i.bak "s|^E2E_MEMBER_KEY_2=.*|E2E_MEMBER_KEY_2=${MEMBER_KEY_2}|" "$ENV_FILE" \
    && rm -f "${ENV_FILE}.bak"
  green "Updated $ENV_FILE"
fi

# ── 6. Write dev-overlay.json so node-2's webapp can show the workspace alias.
# Without this, the namespace alias ("Dev Workspace") set on node-1 doesn't
# propagate via rc.35 governance — node-2's webapp would otherwise show
# "Workspace {short-id}". main.tsx fetches this on boot in dev mode and
# seeds localStorage. Best-effort: pull alias from node-1 directly.
ALIAS_FROM_N1=$(curl -sf "${NODE_1_URL}/admin-api/namespaces" \
  -H "Authorization: Bearer ${ACCESS_TOKEN_1:-}" 2>/dev/null \
  | jq -r --arg id "$GROUP_ID" \
      '(.data // [])[] | select(.namespaceId==$id) | .alias // empty' \
      2>/dev/null || true)

if [ -n "$ALIAS_FROM_N1" ]; then
  OVERLAY="$REPO_ROOT/app/public/dev-overlay.json"
  jq -n \
    --arg ns "$GROUP_ID" \
    --arg alias "$ALIAS_FROM_N1" \
    --arg ctx "$CONTEXT_ID" \
    --arg member "$MEMBER_KEY_2" \
    --arg general "$GENERAL_SG_ID" \
    '{
      "namespace_id": $ns,
      "namespace_alias": $alias,
      "general_context_id": $ctx,
      "general_subgroup_id": $general,
      "node_2_member_key": $member,
      "_note": "written by dev-invite.sh; main.tsx seeds localStorage from this in dev mode"
    }' > "$OVERLAY"
  green "Wrote $OVERLAY (alias: $ALIAS_FROM_N1)"
else
  yellow "Could not fetch namespace alias from node-1 (non-fatal — webapp will fall back to 'Workspace {id-slice}')"
fi

printf '\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Node2 invited into node1 workspace\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════\033[0m\n'
printf '\n'
printf '  Workspace:  %s\n' "$GROUP_ID"
printf '  Channel:    %s  (#general)\n' "$CONTEXT_ID"
printf '\n'
