#!/usr/bin/env bash
# scripts/dev-invite-test.sh — Clean-slate harness for testing the IN-APP invite
# flow (the real "paste an invite code" path), end to end.
#
# Unlike `make dev-nodes`, this does NOT auto-join node2 into the room. It nukes
# both nodes, starts node1 (with a room) + node2 (fresh, no room), then opens two
# browser windows in --web-invite mode:
#   • Peer A (node1) — inside the room; click "Invite" to mint a code.
#   • Peer B (node2) — on the Rooms page; paste the code into "Join".
# If B lands in the same room, invitations work.
#
# Vite must be running in another terminal (`make dev`). Use --print to just show
# the URLs instead of launching Chrome.
#
# Usage:
#   ./scripts/dev-invite-test.sh           # nuke, start nodes, open both windows
#   ./scripts/dev-invite-test.sh --print   # nuke, start nodes, print the URLs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step()  { printf '\n\033[1;35m═══ %s\033[0m\n' "$*"; }
green() { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }

PRINT_FLAG=""
[ "${1:-}" = "--print" ] && PRINT_FLAG="--print"

step "1/3  Node1 (clean slate + room)"
bash "$SCRIPT_DIR/dev-node.sh"

step "2/3  Node2 (clean slate, NO room — invite target)"
bash "$SCRIPT_DIR/dev-node2.sh"

green "Skipping auto-invite — node2 stays outside the room so you can invite it via the UI."

step "3/3  Opening browser windows (web-invite mode)"
bash "$SCRIPT_DIR/dev-call.sh" --web-invite $PRINT_FLAG
