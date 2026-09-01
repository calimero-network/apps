#!/usr/bin/env bash
# scripts/dev-invite.sh — join node2 to node1's stream, then print the two
# browser URLs that open the app WEB-ONLY (no Tauri desktop shell involved).
#
# Both dev-node.sh and dev-node2.sh referenced this script and it did not exist,
# which is why the solo harness had never been run end to end.
#
# Why web-only works at all, in case you are wondering whether the desktop shell
# is load-bearing here:
#
#   - Node traffic is DIRECT. mero-js/mero-react talk to merod over plain
#     HTTP + SSE. Unlike mero-chat, this app never routes bytes through a Tauri
#     Rust proxy, so there is no binary-safety layer to lose.
#   - merod's CORS defaults to allow-any-origin, and dev-node*.sh additionally
#     force `allow_all_origins = true`, so a Vite origin can call the node.
#   - Auth is a normal token. dev-node*.sh already mints one per node from the
#     admin credentials; the desktop's only real job was handing that token to
#     the webview in a URL hash, which this script does instead.
#   - Approach 2 uses WebCodecs in the browser and approach 3 encodes in the WASM
#     app, so no native media bridge is needed either. (Mero Meet needed one —
#     it does native WebRTC with TURN. Nothing here uses WebRTC.)
#
# The one genuine desktop-only gap is camera permission in WKWebView, which is
# why measurement runs should use Chrome for now.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="app/.env.dev-call"

step()  { printf '\n\033[1;36m▶  %s\033[0m\n' "$1"; }
green() { printf '\033[32m  ✓  %s\033[0m\n' "$1"; }
red()   { printf '\033[31m  ✗  %s\033[0m\n' "$1"; }

[ -f "$ENV_FILE" ] || { red "$ENV_FILE missing — run scripts/dev-node.sh && scripts/dev-node2.sh first"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

for v in DEV_NODE_URL DEV_ACCESS_TOKEN DEV_NAMESPACE_ID DEV_CONTEXT_ID \
         DEV_NODE_URL_2 DEV_ACCESS_TOKEN_2; do
  [ -n "${!v:-}" ] || { red "$v is empty in $ENV_FILE"; exit 1; }
done

A1=(-H "Authorization: Bearer ${DEV_ACCESS_TOKEN}")
A2=(-H "Authorization: Bearer ${DEV_ACCESS_TOKEN_2}")
JSON=(-H "Content-Type: application/json")

# ── node2 identity ────────────────────────────────────────────────────────────
step "Generating node2 identity"
IDENT=$(curl -sf -X POST "${DEV_NODE_URL_2}/admin-api/identity/context" "${A2[@]}" "${JSON[@]}" -d '{}' 2>/dev/null) || IDENT="{}"
NODE2_PK=$(echo "$IDENT" | jq -r '(.data // .) | (.publicKey // .public_key // empty)')
[ -n "$NODE2_PK" ] || { red "Could not create node2 identity"; echo "$IDENT" >&2; exit 1; }
green "node2 identity: $NODE2_PK"

# ── invite + join namespace ───────────────────────────────────────────────────
# The invitation is an OPEN one (SignedGroupOpenInvitation): the request carries
# no invitee key, and anyone holding the result can join. Do NOT send
# inviteePublicKey here — it is silently ignored and misleads the next reader.
step "node1 invites node2 to the namespace"
INV=$(curl -s -X POST "${DEV_NODE_URL}/admin-api/groups/${DEV_NAMESPACE_ID}/invite" "${A1[@]}" "${JSON[@]}" \
  -d '{}') || INV="{}"
# Unwrap until we reach the object that actually carries inviter_signature — the
# join endpoint wants the invitation OBJECT, not a JSON string of it.
INVITATION=$(echo "$INV" | jq -c '
  def unwrap: if type=="object" and has("invitation") and (has("inviter_signature")|not)
              then .invitation | unwrap else . end;
  (.data // .) | unwrap' 2>/dev/null)
echo "$INVITATION" | jq -e 'has("inviter_signature")' >/dev/null 2>&1 \
  || { red "Invitation failed (no inviter_signature)"; echo "$INV" | head -c 500 >&2; exit 1; }
green "invitation minted"

step "node2 joins the namespace"
JOIN=$(curl -s -X POST "${DEV_NODE_URL_2}/admin-api/groups/join" "${A2[@]}" "${JSON[@]}" \
  -d "$(jq -n --argjson inv "$INVITATION" '{invitation:$inv}')") || JOIN="{}"
# Check for a real success field, not merely "parses as JSON" — an error body is
# valid JSON too, which is how this failed silently the first time.
echo "$JOIN" | jq -e '(.data.groupId // .data.group_id) != null' >/dev/null 2>&1 \
  && green "namespace joined: $(echo "$JOIN" | jq -r '.data.memberIdentity // .data.member_identity // "?"')" \
  || { red "Namespace join failed"; echo "$JOIN" | head -c 500 >&2; exit 1; }

# Namespace auto_join should pull node2 into the context; give it a moment and
# then confirm rather than assume.
step "Waiting for node2 to hold the stream context"
NODE2_MEMBER=""
for _ in $(seq 1 30); do
  OWNED=$(curl -sf "${DEV_NODE_URL_2}/admin-api/contexts/${DEV_CONTEXT_ID}/identities-owned" "${A2[@]}" 2>/dev/null || echo '{}')
  NODE2_MEMBER=$(echo "$OWNED" | jq -r '(.data // .) | if type=="array" then (.[0] // empty) else (.identities[0] // .items[0] // empty) end' 2>/dev/null || true)
  [ -n "$NODE2_MEMBER" ] && [ "$NODE2_MEMBER" != "null" ] && break
  sleep 2
done

if [ -z "$NODE2_MEMBER" ] || [ "$NODE2_MEMBER" = "null" ]; then
  # Fall back to an explicit context join if auto_join did not carry it.
  step "auto_join did not land it — joining the context explicitly"
  CJ=$(curl -sf -X POST "${DEV_NODE_URL_2}/admin-api/contexts/${DEV_CONTEXT_ID}/join" "${A2[@]}" "${JSON[@]}" \
    -d "$(jq -n --arg pk "$NODE2_PK" '{inviteePublicKey:$pk}')" 2>/dev/null) || CJ="{}"
  NODE2_MEMBER=$(echo "$CJ" | jq -r '(.data // .) | (.memberPublicKey // .member_public_key // empty)')
fi
[ -n "$NODE2_MEMBER" ] && [ "$NODE2_MEMBER" != "null" ] || { red "node2 never joined the context"; exit 1; }
green "node2 member key: $NODE2_MEMBER"

# Persist for the load generator and for re-runs.
python3 - "$ENV_FILE" "$NODE2_MEMBER" <<'PYEOF'
import sys
path, member = sys.argv[1], sys.argv[2]
lines = [l for l in open(path).read().splitlines() if not l.startswith("DEV_MEMBER_KEY_2=")]
lines.append(f"DEV_MEMBER_KEY_2={member}")
open(path, "w").write("\n".join(lines) + "\n")
PYEOF
green "wrote DEV_MEMBER_KEY_2 to $ENV_FILE"

# ── the browser URLs ──────────────────────────────────────────────────────────
# The same hash shape tauri-app's openAppFrontend builds. `dev_mode=1` surfaces
# the diagnostics panels. APP_ENABLED accepts this in a Vite dev build (see
# lib/tauri.ts hasDevSession) — which is what makes the desktop shell optional.
VITE="${VITE_URL:-http://localhost:5173}"
mkhash() {
  printf '#node_url=%s&access_token=%s&refresh_token=%s&app-id=%s&context_id=%s&executor_public_key=%s&dev_mode=1' \
    "$1" "$2" "$3" "$4" "$DEV_CONTEXT_ID" "$5"
}
URL1="${VITE}/live$(mkhash "$DEV_NODE_URL"   "$DEV_ACCESS_TOKEN"   "$DEV_REFRESH_TOKEN"   "$DEV_APP_ID"   "$DEV_MEMBER_KEY")"
URL2="${VITE}/live$(mkhash "$DEV_NODE_URL_2" "$DEV_ACCESS_TOKEN_2" "$DEV_REFRESH_TOKEN_2" "$DEV_APP_ID_2" "$NODE2_MEMBER")"

{
  echo "$URL1"
  echo
  echo "$URL2"
} > /tmp/mero-stream-dev-urls.txt

printf '\n\033[1;32m  Both nodes joined to context %s\033[0m\n\n' "$DEV_CONTEXT_ID"
cat <<EOF
  Start the dev server:   make dev

  Then open these in TWO separate browser profiles (or a normal + incognito
  window). Chrome or Edge — Safari/WKWebView needs 16.4+ for WebCodecs.

  SENDER   (node1)
$URL1

  RECEIVER (node2)
$URL2

  Swap /live -> /stream for the approach-3 (64x48 in-WASM codec) route.
  Also saved to /tmp/mero-stream-dev-urls.txt

  Load generator against this context:
    python3 scripts/load-curve.py \\
      --node-url $DEV_NODE_URL --context-id $DEV_CONTEXT_ID \\
      --executor-key $DEV_MEMBER_KEY \\
      --peer-url $DEV_NODE_URL_2 --peer-executor-key $NODE2_MEMBER \\
      --out load-curve.csv
EOF
