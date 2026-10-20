#!/usr/bin/env bash
# scripts/e2e-room-scan.sh — the shared 3D room, end to end, on two nodes.
#
#   1. Boots node A ("Maya") and node B ("Leo") and builds this repo's contract.
#   2. Drives the app in the iOS Simulator (testSampleRoomAddAndMoveItems):
#      node sign-in → new room → the sample room → two items → drag one.
#   3. Checks node B: it joins the room and must hold the same room scan, be
#      able to download the room model blob through the room's context, and
#      see both items at the positions node A has.
#
# Usage: MERO_BIN=/path/to/merod-rc89/bin scripts/e2e-room-scan.sh
# Needs merod 0.11.0-rc.89, cargo-mero, full Xcode, xcodegen. Uses the
# "iPhone 18 Pro Max" simulator (SIM=...), ports 4301/4302 and 4311/4312.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM="${SIM:-iPhone 18 Pro Max}"
WORK="${WORK:-$ROOT/.e2e-room}"
PASS="calimero1234"
export PATH="${MERO_BIN:+$MERO_BIN:}$PATH"
mkdir -p "$WORK"

step() { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

# Fresh nodes every run: both must install the exact bundle this run builds
# (`cargo mero bundle` re-signs, so an older node's release would differ).
start_node() { # name port
  local home="$WORK/$1" port="$2"
  if [ -f "$WORK/$1.pid" ]; then
    kill "$(cat "$WORK/$1.pid")" 2>/dev/null || true
    for _ in $(seq 1 20); do lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.5; done
  fi
  if curl -sf "localhost:$port/admin-api/health" >/dev/null 2>&1; then
    echo "port $port is taken by a node this script didn't start; stop it first" >&2; exit 1
  fi
  rm -rf "$home"
  printf '%s' "$PASS" | merod --home "$home" --node app init --server-port "$port" --swarm-port $((port + 1)) \
    --auth-mode embedded --auth-storage persistent --admin-user admin --admin-password-stdin >/dev/null
  merod --home "$home" --node app run >"$WORK/$1.log" 2>&1 &
  echo $! >"$WORK/$1.pid"
  for _ in $(seq 1 40); do curl -sf "localhost:$port/admin-api/health" >/dev/null 2>&1 && return; sleep 1; done
  echo "node $1 did not start" >&2; exit 1
}

step "Contract bundle"
(cd "$ROOT" && make logic-bundle >/dev/null)
BUNDLE="$ROOT/logic/res/mero-ar.mpk"

step "Nodes"
start_node node-a 4301
start_node node-b 4311

step "App: sample room, two items, a drag"
cd "$ROOT/app/MeroAR"
xcodegen generate >/dev/null
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
env TEST_RUNNER_MEROAR_TEST_NODE=http://localhost:4301 TEST_RUNNER_MEROAR_TEST_USER=admin \
  TEST_RUNNER_MEROAR_TEST_PASS="$PASS" TEST_RUNNER_MEROAR_APP_BUNDLE="$BUNDLE" \
  xcodebuild test -project MeroAR.xcodeproj -scheme MeroAR -destination "platform=iOS Simulator,name=$SIM" \
  -only-testing:MeroARUITests/MeroARUITests/testSampleRoomAddAndMoveItems -quiet

step "Find the room"
ROOM=$(python3 - <<'EOF'
import json, time, urllib.request
def req(m, p, body=None, tok=None):
    r = urllib.request.Request("http://localhost:4301" + p, method=m,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json", **({"authorization": "Bearer " + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
tok = req("POST", "/auth/token", {"auth_method": "user_password", "public_key": "admin", "client_name": "e2e",
    "permissions": ["admin"], "timestamp": int(time.time()),
    "provider_data": {"username": "admin", "password": "calimero1234"}})["data"]["access_token"]
apps = {a["id"] for a in req("GET", "/admin-api/applications", tok=tok)["data"]["apps"] if a.get("package") == "com.calimero.mero-ar"}
def scan(ctx):
    res = req("POST", "/jsonrpc", {"jsonrpc": "2.0", "id": 1, "method": "execute",
        "params": {"contextId": ctx, "method": "get_room_scan", "argsJson": {}}}, tok)
    return (res.get("result") or {}).get("output")
rooms = [c["id"] for c in req("GET", "/admin-api/contexts", tok=tok)["data"]["contexts"] if c["applicationId"] in apps]
print(next((c for c in reversed(rooms) if scan(c)), ""))
EOF
)
[ -n "$ROOM" ] || { echo "no room with a scan on node A" >&2; exit 1; }
echo "   room $ROOM"

step "Leo's node sees the room and the items"
python3 "$ROOT/scripts/demo-peer.py" --a http://localhost:4301 --b http://localhost:4311 \
  --context "$ROOM" --bundle "$BUNDLE" --verify-room

echo "Stop the nodes with: kill \$(cat $WORK/node-a.pid $WORK/node-b.pid)"
