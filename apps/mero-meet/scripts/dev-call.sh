#!/usr/bin/env bash
# scripts/dev-call.sh — Open two browser profiles into the same room as two
# different peers, so a solo dev can place a real video call on one laptop.
#
# Reads app/.env.dev-call (written by dev-node*.sh + dev-invite.sh), builds the
# desktop-style auth hash for each node, and launches two isolated Chrome
# profiles with a FAKE camera/mic (no real webcam contention). Each profile is a
# separate node + identity, so peer A can call peer B.
#
# Prereqs:  ./scripts/dev-node.sh && ./scripts/dev-node2.sh && ./scripts/dev-invite.sh
#           make dev     # vite dev server must be running
#
# Usage:
#   ./scripts/dev-call.sh                 # both peers already in the room (call test)
#   ./scripts/dev-call.sh --web-invite    # peer B starts OUTSIDE the room, on the
#                                         #   Rooms page, so you can test the real
#                                         #   in-app invite → Join flow (peer A
#                                         #   clicks "Invite", peer B pastes it).
#   ./scripts/dev-call.sh --print         # just print the URLs (open them yourself)
#   (flags combine, e.g. --web-invite --print)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/app/.env.dev-call"

VITE_HOST="${DEV_VITE_HOST:-http://localhost}"
VITE_PORT="${DEV_VITE_PORT:-5173}"
BASE="${VITE_HOST}:${VITE_PORT}"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

PRINT_ONLY=false; WEB_INVITE=false
for arg in "$@"; do
  case "$arg" in
    --print)      PRINT_ONLY=true ;;
    --web-invite) WEB_INVITE=true ;;
  esac
done

[ -f "$ENV_FILE" ] || { red "$ENV_FILE not found — run the dev-node scripts first"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# Peer A is always fully inside the room. Peer B only needs a room identity in
# call-test mode; in --web-invite mode it starts on the Rooms page (no context).
NEED=(DEV_NODE_URL DEV_ACCESS_TOKEN DEV_REFRESH_TOKEN DEV_APP_ID DEV_CONTEXT_ID DEV_MEMBER_KEY \
      DEV_NODE_URL_2 DEV_ACCESS_TOKEN_2 DEV_REFRESH_TOKEN_2 DEV_APP_ID_2)
$WEB_INVITE || NEED+=(DEV_MEMBER_KEY_2)
for var in "${NEED[@]}"; do
  [ -n "${!var:-}" ] || { red "$var missing in $ENV_FILE — did the dev-node scripts complete?"; exit 1; }
done

# Build the desktop-style SSO hash. dev_mode=1 surfaces the WebRTC DevPanel.
# context_id + executor_public_key are optional: omit them and the app lands on
# the Rooms page (where an invite code can be pasted).
hash_for() { # node_url access refresh appid [ctx] [executor]
  local h="#node_url=$1&access_token=$2&refresh_token=$3&app-id=$4"
  [ -n "${5:-}" ] && h="${h}&context_id=$5"
  [ -n "${6:-}" ] && h="${h}&executor_public_key=$6"
  printf '%s&dev_mode=1' "$h"
}

URL_A="${BASE}/$(hash_for "$DEV_NODE_URL" "$DEV_ACCESS_TOKEN" "$DEV_REFRESH_TOKEN" "$DEV_APP_ID" "$DEV_CONTEXT_ID" "$DEV_MEMBER_KEY")"
if $WEB_INVITE; then
  URL_B="${BASE}/$(hash_for "$DEV_NODE_URL_2" "$DEV_ACCESS_TOKEN_2" "$DEV_REFRESH_TOKEN_2" "$DEV_APP_ID_2")"
else
  URL_B="${BASE}/$(hash_for "$DEV_NODE_URL_2" "$DEV_ACCESS_TOKEN_2" "$DEV_REFRESH_TOKEN_2" "$DEV_APP_ID_2" "$DEV_CONTEXT_ID" "$DEV_MEMBER_KEY_2")"
fi

if $PRINT_ONLY; then
  step "Peer A (node1, in room '${DEV_ROOM_NAME:-?}', identity ${DEV_MEMBER_KEY:0:8}…)"; printf '%s\n' "$URL_A"
  if $WEB_INVITE; then
    step "Peer B (node2, Rooms page — paste invite here)"; printf '%s\n' "$URL_B"
    printf '\nPeer A: open the room → Invite → copy code.  Peer B: paste into Join.\n'
  else
    step "Peer B (node2, in room, identity ${DEV_MEMBER_KEY_2:0:8}…)"; printf '%s\n' "$URL_B"
    printf '\nOpen each in a SEPARATE browser profile/window. Press Call in both.\n'
  fi
  exit 0
fi

CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { red "Chrome not found at: $CHROME (set CHROME_BIN). Or use: ./scripts/dev-call.sh --print"; exit 1; }

COMMON=(--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
        --no-first-run --no-default-browser-check --new-window)

step "Launching Peer A (node1)"
"$CHROME" --user-data-dir="/tmp/meet-dev-chrome-A" "${COMMON[@]}" "$URL_A" &>/dev/null &
green "Peer A window opening"

sleep 1
step "Launching Peer B (node2)"
"$CHROME" --user-data-dir="/tmp/meet-dev-chrome-B" "${COMMON[@]}" "$URL_B" &>/dev/null &
green "Peer B window opening"

if $WEB_INVITE; then
  printf '\n\033[1;32m  Two windows opened (web-invite test).\033[0m\n'
  printf '  Peer A (node1): enter the room → click \033[1mInvite\033[0m → copy the code.\n'
  printf '  Peer B (node2): on the Rooms page, paste the code into \033[1mJoin\033[0m.\n'
  printf '  Peer B should land in the same room — invitations work.\n\n'
else
  printf '\n\033[1;32m  Two peers opened in the same room.\033[0m\n'
  printf '  In EACH window: set a name → press Call. You should see two fake video tiles.\n\n'
fi
