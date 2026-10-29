#!/usr/bin/env bash
# Check out the Calimero Kotlin SDK at the commit pinned in ../kotlin-sdk.ref, into ../.sdk/kotlin-sdk.
#
# settings.gradle.kts includes that checkout as a composite build (the delegated-execution layer
# the app uses is not in a published SDK release yet). Idempotent: an existing checkout already at
# the pinned commit is left alone; one at another commit is moved to it.
#
#   ./scripts/fetch-sdk.sh                 # the pinned commit
#   KOTLIN_SDK_REPO=git@github.com:me/kotlin-sdk.git ./scripts/fetch-sdk.sh   # a fork
#
# To use a checkout you already have instead, skip this and pass -PmeroKotlinSdkDir=/path
# (or set MERO_KOTLIN_SDK_DIR).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ref="$(tr -d '[:space:]' < "$here/kotlin-sdk.ref")"
repo="${KOTLIN_SDK_REPO:-https://github.com/calimero-network/kotlin-sdk.git}"
dest="$here/.sdk/kotlin-sdk"

if ! [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
  echo "kotlin-sdk.ref must hold a full 40-character commit SHA, got '$ref'" >&2
  exit 1
fi

if [ -d "$dest/.git" ] && [ "$(git -C "$dest" rev-parse HEAD 2>/dev/null || true)" = "$ref" ]; then
  echo "kotlin-sdk already at $ref ($dest)"
  exit 0
fi

mkdir -p "$dest"
if [ ! -d "$dest/.git" ]; then
  git -C "$dest" init -q
  git -C "$dest" remote add origin "$repo"
else
  git -C "$dest" remote set-url origin "$repo"
fi

# GitHub serves any reachable commit by SHA, so one shallow fetch is enough.
git -C "$dest" fetch -q --depth 1 origin "$ref"
git -C "$dest" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
echo "kotlin-sdk checked out at $(git -C "$dest" rev-parse HEAD) ($dest)"
