#!/usr/bin/env bash
# scripts/record-demo.sh — film the app for the landing page.
#
# Boots two local nodes (A for "Maya", B for "Leo"), drives the app in the iOS
# Simulator through the recording UI tests, and captures each scene with
# `simctl io recordVideo`. While the room scene films, scripts/demo-peer.py
# brings Leo in from node B: he joins, walks a viewpoint around and builds, and
# it reaches the app over real peer-to-peer sync. Output (H.264, no audio, plus
# a poster frame each) lands in landing/public/media/.
#
# Usage:
#   MERO_BIN=/path/to/core-release/bin scripts/record-demo.sh
#
# Needs merod 0.12.0-rc.3 (on PATH or in $MERO_BIN), full Xcode, xcodegen and
# ffmpeg. Uses the "iPhone 18 Pro Max" simulator (override with SIM=...), ports
# 4301/4302 and 4311/4312, and node homes under $WORK (default /tmp/meroar-rec).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/app/MeroAR"
OUT="$ROOT/landing/public/media"
SIM="${SIM:-iPhone 18 Pro Max}"
WORK="${WORK:-/tmp/meroar-rec}"
PASS="calimero1234"
export PATH="${MERO_BIN:+$MERO_BIN:}$PATH"
mkdir -p "$WORK" "$OUT"

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

step "Nodes"
start_node node-a 4301
start_node node-b 4311

step "Contract bundle (this repo's contract: the registry's may predate room scans)"
(cd "$ROOT" && make logic-bundle >/dev/null)
BUNDLE="$ROOT/logic/res/mero-ar.mpk"

step "Build for testing"
cd "$APP_DIR"
xcodegen generate >/dev/null
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3 --operatorName "" >/dev/null
xcrun simctl uninstall "$SIM" network.calimero.meroar 2>/dev/null || true
DERIVED="$WORK/derived"
xcodebuild build-for-testing -project MeroAR.xcodeproj -scheme MeroAR -destination "platform=iOS Simulator,name=$SIM" \
  -derivedDataPath "$DERIVED" -quiet

# Seconds into a raw recording where the app first shows. The home screen is
# bright (mean luma ~120+), the launch screen flat black (brightest pixel ~21);
# the app is dark with highlights. Sampled every half second; two app-looking
# samples in a row, so the crossfade between them doesn't count.
app_start() {
  ffprobe -v error -f lavfi -i "movie=$1,fps=2,scale=160:-2,signalstats" \
    -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YHIGH -of csv=p=0 2>/dev/null |
    awk -F, '{ app = ($2 > 28 && $2 < 100 && $3 > 45) }
             app && prev { print t; found = 1; exit }
             { prev = app; t = $1 }
             END { if (!found) print 9 }'
}

scene() { # name test [extra env...]
  local name="$1" test="$2"; shift 2
  step "Scene: $name"
  local raw="$WORK/$name.mov"
  rm -f "$raw"
  xcrun simctl io "$SIM" recordVideo --codec=h264 --force "$raw" >/dev/null 2>&1 &
  local rec=$!
  sleep 1.5
  env TEST_RUNNER_MEROAR_RECORD=1 TEST_RUNNER_MEROAR_TEST_NODE=http://localhost:4301 \
    TEST_RUNNER_MEROAR_APP_BUNDLE="$BUNDLE" \
    TEST_RUNNER_MEROAR_TEST_USER=admin TEST_RUNNER_MEROAR_TEST_PASS="$PASS" "$@" \
    xcodebuild test-without-building -project MeroAR.xcodeproj -scheme MeroAR \
    -destination "platform=iOS Simulator,name=$SIM" -derivedDataPath "$DERIVED" \
    -only-testing:"MeroARUITests/MeroARUITests/$test" -quiet || echo "scene $name: test reported a failure" >&2
  kill -INT "$rec"; wait "$rec" 2>/dev/null || true
  # Trim the test runner's launch, scale to a web size, no audio, fast start.
  # Cut the launch off the front and the return to the home screen off the end.
  local raw_length start
  raw_length=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$raw")
  start=${TRIM:-$(app_start "$raw")}
  ffmpeg -y -loglevel error -ss "$start" -t "$(echo "$raw_length - $start - ${TAIL:-2}" | bc -l)" -i "$raw" -vf "scale=590:-2,fps=30" -c:v libx264 -profile:v high \
    -pix_fmt yuv420p -crf 30 -preset slow -an -movflags +faststart "$OUT/$name.mp4"
  # Poster: a frame 40% in, past the launch and before the last screen.
  local length
  length=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$name.mp4")
  ffmpeg -y -loglevel error -ss "$(echo "$length * ${POSTER_AT:-0.4}" | bc -l)" -i "$OUT/$name.mp4" -frames:v 1 \
    -q:v 4 "$OUT/$name.jpg"
  ls -lh "$OUT/$name.mp4" | awk '{print "   " $5, $9}'
}

scene clip-signin testRecordSignIn TEST_RUNNER_MEROAR_TEST_ROOM=Studio

step "Find the room"
ROOM=$(python3 - <<'EOF'
import json, time, urllib.request
def req(m, p, body=None, tok=None):
    r = urllib.request.Request("http://localhost:4301" + p, method=m,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json", **({"authorization": "Bearer " + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
tok = req("POST", "/auth/token", {"auth_method": "user_password", "public_key": "admin", "client_name": "rec",
    "permissions": ["admin"], "timestamp": int(time.time()),
    "provider_data": {"username": "admin", "password": "calimero1234"}})["data"]["access_token"]
apps = {a["id"] for a in req("GET", "/admin-api/applications", tok=tok)["data"]["apps"] if a.get("package") == "com.calimero.mero-ar"}
ctxs = [c["id"] for c in req("GET", "/admin-api/contexts", tok=tok)["data"]["contexts"] if c["applicationId"] in apps]
def room(ctx):
    res = req("POST", "/jsonrpc", {"jsonrpc": "2.0", "id": 1, "method": "execute",
        "params": {"contextId": ctx, "method": "get_room", "argsJson": {}}}, tok)
    return (res.get("result") or {}).get("output") or {}
# The newest empty "Studio": the one the sign-in scene just made.
studios = [c for c in ctxs if room(c).get("name") == "Studio" and room(c).get("objectCount") == 0]
print(studios[-1] if studios else "")
EOF
)
[ -n "$ROOM" ] || { echo "no room on node A" >&2; exit 1; }
echo "   room $ROOM"

python3 "$ROOT/scripts/demo-peer.py" --a http://localhost:4301 --b http://localhost:4311 --context "$ROOM" \
  --bundle "$BUNDLE" --name Leo --delay 24 >"$WORK/peer.log" 2>&1 &
PEER=$!
scene clip-room testRecordRoom TEST_RUNNER_MEROAR_ROOM="$ROOM" TEST_RUNNER_MEROAR_TAP_OBJECT="${TAP_OBJECT:-0.775,0.535}"
wait "$PEER" 2>/dev/null || true

scene clip-invite testRecordInvite TEST_RUNNER_MEROAR_ROOM="$ROOM"

step "A fresh room for the 3D room scene"
SCAN_ROOM=$(python3 "$ROOT/scripts/demo-peer.py" --a http://localhost:4301 --b http://localhost:4311 \
  --context new --bundle "$BUNDLE" --create-room "Living room")
echo "   room $SCAN_ROOM"
python3 "$ROOT/scripts/demo-peer.py" --a http://localhost:4301 --b http://localhost:4311 --context "$SCAN_ROOM" \
  --bundle "$BUNDLE" --name Leo --delay 30 --scale 3 >"$WORK/peer-scan.log" 2>&1 &
PEER=$!
scene clip-scan testRecordRoomScan TEST_RUNNER_MEROAR_ROOM="$SCAN_ROOM"
wait "$PEER" 2>/dev/null || true

xcrun simctl status_bar "$SIM" clear >/dev/null || true
step "Done: $OUT"
echo "Stop the nodes with: kill \$(cat $WORK/node-a.pid $WORK/node-b.pid)"
