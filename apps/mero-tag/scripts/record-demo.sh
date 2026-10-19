#!/usr/bin/env bash
#
# record-demo.sh — film the landing page's screen recordings from the real app.
#
# Needs: a node on $NODE (default http://localhost:4201, admin dev/dev-password)
# with the demo space from `scripts/demo-seed.py setup`, full Xcode, xcodegen
# and ffmpeg. It runs DemoRecordingTests one at a time on one simulator,
# records each with `simctl io recordVideo`, keeps the friends moving with the
# seeder, and writes H.264 mp4s plus poster JPEGs to landing/public/media/.
#
#   scripts/record-demo.sh <context-id> [--device "iPhone Air"]

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
CTX="${1:?usage: scripts/record-demo.sh <context-id> [--device NAME]}"
DEVICE="iPhone Air"
[ "${2:-}" = "--device" ] && DEVICE="${3:?}"
NODE="${NODE:-http://localhost:4201}"
OUT="$ROOT/landing/public/media"
WORK="$(mktemp -d)"
mkdir -p "$OUT"

xcrun simctl boot "$DEVICE" 2>/dev/null || true
xcrun simctl bootstatus "$DEVICE" -b >/dev/null
xcrun simctl status_bar "$DEVICE" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 >/dev/null 2>&1 || true
xcrun simctl location "$DEVICE" set 37.7955,-122.3937

(cd app/MeroTag && xcodegen generate >/dev/null)
xcodebuild build-for-testing -project app/MeroTag/MeroTag.xcodeproj -scheme MeroTag \
  -destination "platform=iOS Simulator,name=$DEVICE" -derivedDataPath "$WORK/dd" -quiet

record() {  # record <test> <name>
  local test="$1" name="$2"
  xcrun simctl privacy "$DEVICE" grant location-always network.calimero.merotag 2>/dev/null || true
  python3 scripts/demo-seed.py move --node "$NODE" --context "$CTX" --seconds 120 &
  local seeder=$!
  xcrun simctl io "$DEVICE" recordVideo --codec h264 --force "$WORK/$name.mov" &
  local rec=$!
  sleep 1
  TEST_RUNNER_DEMO_RECORD=1 TEST_RUNNER_DEMO_MARKS="$WORK" TEST_RUNNER_MEROTAG_NODE="$NODE" \
    TEST_RUNNER_MEROTAG_SPACE="$CTX" \
    xcodebuild test-without-building -project app/MeroTag/MeroTag.xcodeproj -scheme MeroTag \
    -destination "platform=iOS Simulator,name=$DEVICE" -derivedDataPath "$WORK/dd" \
    -only-testing:"MeroTagUITests/DemoRecordingTests/$test" -quiet || true
  local stopped; stopped=$(python3 -c 'import time; print(time.time())')
  kill -INT "$rec"; wait "$rec" 2>/dev/null || true
  kill "$seeder" 2>/dev/null || true
  # The test noted when the flow began and ended; keep only that. recordVideo
  # starts writing a moment after it is launched, so the video's own start is
  # taken as "stopped minus its duration".
  local length from to
  length=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/$name.mov")
  from=$(python3 -c "print(max(0, $(cat "$WORK/$test.start") - ($stopped - $length)))")
  to=$(python3 -c "print($(cat "$WORK/$test.end") - ($stopped - $length) - 1.5)")
  # Portrait, 720 wide, 30 fps, no audio: small enough for the web.
  ffmpeg -y -loglevel error -ss "$from" -to "$to" -i "$WORK/$name.mov" -an -vf "scale=720:-2,fps=30" \
    -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart "$OUT/$name.mp4"
  ffmpeg -y -loglevel error -i "$OUT/$name.mp4" -vf "select=eq(n\\,45)" -frames:v 1 -q:v 4 "$OUT/$name.jpg"
  echo "$name: $(du -h "$OUT/$name.mp4" | cut -f1)"
}

rm -f "$OUT"/*.png
record test1SignIn signin
record test2LiveMap live-map
record test3ShareThisPhone share
record test4InvitePeople invite
rm -rf "$WORK"
