#!/usr/bin/env bash
#
# Boot the delegated relay the native apps' live tests run against, and write
# what they need to know into .relay.env:
#
#   MERO_E2E_RELAY_URL   the relay, on loopback (the SDKs accept its mock quote only there)
#   MERO_E2E_APP_ID      mero-chat's application id as installed on it
#   MERO_E2E_RELAY_ACCOUNT  the relay's own account (the executor a founding warrant names)
#
# Usage:
#   MEROD_BIN=/path/to/merod ./run-relay.sh      # start (idempotent: nukes and re-boots)
#   ./run-relay.sh --stop                         # stop it and remove its data
#
# MEROD_BIN must be a merod built with `--features mock-attestation` from a core
# that serves `/admit` without a credential (calimero-network/core#4611). No
# release carries both yet; CORE_REF below is the commit CI builds. Build it with:
#
#   git clone https://github.com/calimero-network/core && cd core && git checkout "$CORE_REF"
#   cargo build -p merod --features mock-attestation
#
# The chat bundle is res/com.calimero.chat.mpk. Without one it is built from
# ../../logic with cargo-mero (the version the workspace pins, see
# .github/actions/install-cargo-mero), dev-signed, which a node accepts with
# `dev: true` and the registry refuses.

set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)

# The core commit the live tests are pinned to: the release commit of the core
# tag the workspace pins, which carries core#4611. CI (build-merod-mock-tee)
# builds and caches merod per this value. It moves with the workspace's core pin,
# because a bundle built against a release refuses to install on an older
# runtime; core's fleet-bump rewrites it with the other pins on every release.
CORE_REF=bd82bae8d68c896a23cae127c38ce12023f227af
export CORE_REF

ENV_FILE="$HERE/.relay.env"
RELAY_URL="http://127.0.0.1:2528"

stop() {
  local pattern="merod --home $HERE/data/"
  pkill -f "$pattern" 2>/dev/null || true
  # pkill only signals. A merod still flushing its store races the rm below
  # ("Directory not empty"), so wait for it to exit, and kill it if it won't.
  for _ in $(seq 1 50); do
    pgrep -f "$pattern" >/dev/null || break
    sleep 0.2
  done
  pkill -9 -f "$pattern" 2>/dev/null || true
  rm -rf "$HERE/data" "$ENV_FILE"
}

if [ "${1:-}" = "--stop" ]; then
  stop
  echo "relay stopped"
  exit 0
fi

: "${MEROD_BIN:?set MEROD_BIN to a merod built with --features mock-attestation (see the header)}"
[ -x "$MEROD_BIN" ] || { echo "MEROD_BIN=$MEROD_BIN is not an executable" >&2; exit 1; }
command -v merobox >/dev/null || { echo "merobox is not installed (pip install merobox)" >&2; exit 1; }

if [ ! -f res/com.calimero.chat.mpk ]; then
  echo "building the mero-chat bundle"
  mkdir -p res
  (cd ../../../.. && cargo mero bundle \
    --manifest-path apps/mero-chat/logic/Cargo.toml \
    --dev --app-version 0.0.0 \
    --output "$HERE/res/com.calimero.chat.mpk")
fi

stop

# Embedded auth refuses to initialise a node with no admin account; the
# workflow's login step uses these.
export MERO_AUTH_ADMIN_USER=dev
export MERO_AUTH_ADMIN_PASSWORD=dev-password

LOG="$HERE/merobox-run.log"
if ! merobox bootstrap run relay.yml --no-docker --binary-path "$MEROD_BIN" >"$LOG" 2>&1; then
  tail -40 "$LOG" >&2
  echo "merobox could not boot the relay; full output in $LOG" >&2
  exit 1
fi

APP_ID=$(tr -d '\n' <"$LOG" | grep -oE "'applicationId': *'[0-9a-f]{64}'" | grep -oE '[0-9a-f]{64}' | head -1)
[ -n "$APP_ID" ] || { echo "no applicationId in $LOG" >&2; exit 1; }

# The two things every live test leans on, checked here so a broken rig fails as
# a broken rig and not as a failing app test.
curl -sf -o /dev/null "$RELAY_URL/auth/challenge" ||
  { echo "the relay does not serve /auth/challenge: device-key login is off" >&2; exit 1; }
curl -sf -o /dev/null -X POST -H 'content-type: application/json' \
  -d "{\"nonce\":\"$(printf '%064d' 0)\",\"bindNodeKey\":true}" "$RELAY_URL/admin-api/tee/attest" ||
  { echo "the relay gives no quote: it is not running with --mock-tee" >&2; exit 1; }

# The relay's own account: the executor a founding warrant names, which the
# Cloud manager reports in the app. Learnt here once, with the operator login,
# so no test spends its own timeout on a node that is still settling after boot.
learn_relay_account() {
  local body token
  body=$(printf '{"auth_method":"user_password","public_key":"%s","client_name":"mero-chat-live-rig","permissions":[],"timestamp":%s,"provider_data":{"username":"%s","password":"%s"}}' \
    "$MERO_AUTH_ADMIN_USER" "$(date +%s)" "$MERO_AUTH_ADMIN_USER" "$MERO_AUTH_ADMIN_PASSWORD")
  token=$(curl -sf --max-time 30 -X POST -H 'content-type: application/json' -d "$body" "$RELAY_URL/auth/token" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])') || return 1
  curl -sf --max-time 30 -H "authorization: Bearer $token" "$RELAY_URL/admin-api/identity" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["accountId"].lower())'
}
RELAY_ACCOUNT=""
for attempt in 1 2 3 4 5; do
  RELAY_ACCOUNT=$(learn_relay_account) && [ -n "$RELAY_ACCOUNT" ] && break
  RELAY_ACCOUNT=""
  echo "operator login to the relay failed (attempt $attempt), retrying" >&2
  sleep 3
done
[ -n "$RELAY_ACCOUNT" ] || { echo "could not learn the relay's account with the operator login" >&2; exit 1; }

cat >"$ENV_FILE" <<EOF
MERO_E2E_RELAY_URL=$RELAY_URL
MERO_E2E_APP_ID=$APP_ID
MERO_E2E_RELAY_ACCOUNT=$RELAY_ACCOUNT
EOF
echo "relay up at $RELAY_URL, mero-chat $APP_ID, relay account $RELAY_ACCOUNT"
echo "wrote $ENV_FILE"
