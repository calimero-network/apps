#!/usr/bin/env bash
# scripts/integration/lib.sh — common helpers for the shell integration
# driver. Sourced by the orchestrator and each case in `cases/*.sh`.
#
# Why a shell driver in addition to merobox? merobox swallows admin-API
# error bodies in a generic "X failed" wrapper, which makes rc.35
# governance-propagation bugs hard to diagnose. curl-direct gives us
# the exact HTTP status + JSON-RPC error.message so we can tell whether
# we're looking at a real bug, a missing wait, or an arg-shape mismatch.

# ── Colours ───────────────────────────────────────────────────────────────
green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

# ── Auth ──────────────────────────────────────────────────────────────────
# Authenticate against a node's embedded auth service. Sets globals:
#   AUTH_TOKEN_<NODE>, REFRESH_TOKEN_<NODE>
# Args: $1 = node URL, $2 = bash var prefix (e.g. "N1")
auth_node() {
  local url="$1" prefix="$2"
  local res
  res=$(curl -sf -X POST "${url}/auth/token" \
    -H "Content-Type: application/json" \
    -d '{"auth_method":"user_password","public_key":"admin","client_name":"integration.sh","timestamp":0,"permissions":[],"provider_data":{"username":"admin","password":"calimero1234"}}' \
    2>/dev/null) || return 1
  local access; access=$(echo "$res" | jq -r '.data.access_token // empty')
  local refresh; refresh=$(echo "$res" | jq -r '.data.refresh_token // empty')
  [ -n "$access" ] || return 1
  eval "AUTH_TOKEN_${prefix}=\"\$access\""
  eval "REFRESH_TOKEN_${prefix}=\"\$refresh\""
  return 0
}

# ── HTTP helpers ──────────────────────────────────────────────────────────
# All four return the FULL HTTP response body on stdout. Caller pipes to jq.
# Exit code mirrors curl's (non-zero on transport failure or HTTP 4xx/5xx).

GET() {
  # GET <node_url> <path> <token>
  curl -sf -X GET "${1}${2}" \
    -H "Authorization: Bearer ${3}"
}

GET_RAW() {
  # GET that returns the body even on 4xx/5xx (so we can read error.message)
  curl -s -X GET "${1}${2}" \
    -H "Authorization: Bearer ${3}"
}

POST() {
  # POST <node_url> <path> <token> <json_body>
  curl -sf -X POST "${1}${2}" \
    -H "Authorization: Bearer ${3}" \
    -H "Content-Type: application/json" \
    -d "${4}"
}

POST_RAW() {
  curl -s -X POST "${1}${2}" \
    -H "Authorization: Bearer ${3}" \
    -H "Content-Type: application/json" \
    -d "${4}"
}

PUT() {
  curl -sf -X PUT "${1}${2}" \
    -H "Authorization: Bearer ${3}" \
    -H "Content-Type: application/json" \
    -d "${4}"
}

# ── Assertions ────────────────────────────────────────────────────────────
# Each assertion increments the global PASS or FAIL counter and prints
# a single PASS/FAIL line.

ASSERT_PASS=0
ASSERT_FAIL=0

assert_eq() {
  # assert_eq <expected> <actual> <description>
  if [ "$1" = "$2" ]; then
    green "PASS: $3"
    ASSERT_PASS=$((ASSERT_PASS+1))
  else
    red "FAIL: $3 — expected '$1' got '$2'"
    ASSERT_FAIL=$((ASSERT_FAIL+1))
  fi
}

assert_contains() {
  # assert_contains <haystack> <needle> <description>
  if echo "$1" | grep -qF "$2"; then
    green "PASS: $3"
    ASSERT_PASS=$((ASSERT_PASS+1))
  else
    red "FAIL: $3 — '$2' not found"
    ASSERT_FAIL=$((ASSERT_FAIL+1))
  fi
}

assert_not_contains() {
  if echo "$1" | grep -qF "$2"; then
    red "FAIL: $3 — '$2' should NOT be present"
    ASSERT_FAIL=$((ASSERT_FAIL+1))
  else
    green "PASS: $3"
    ASSERT_PASS=$((ASSERT_PASS+1))
  fi
}

assert_http_status() {
  # assert_http_status <expected_code> <method> <url> <token> [<body>] <description>
  # Useful for negative tests like "this 403s for non-members".
  local expected="$1" method="$2" url="$3" token="$4"
  local body desc
  if [ "$#" -ge 6 ]; then
    body="$5"; desc="$6"
  else
    body=""; desc="$5"
  fi
  local actual
  if [ -n "$body" ]; then
    actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d "$body")
  else
    actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer ${token}")
  fi
  if [ "$actual" = "$expected" ]; then
    green "PASS: $desc (HTTP $actual)"
    ASSERT_PASS=$((ASSERT_PASS+1))
  else
    red "FAIL: $desc — expected HTTP $expected, got $actual"
    ASSERT_FAIL=$((ASSERT_FAIL+1))
  fi
}

# ── Wait helpers ──────────────────────────────────────────────────────────
wait_for_node_ready() {
  # wait_for_node_ready <url>
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -sf "${url}/admin-api/health" &>/dev/null; then return 0; fi
    sleep 1
  done
  red "Node $url did not become healthy in 60s"
  return 1
}
