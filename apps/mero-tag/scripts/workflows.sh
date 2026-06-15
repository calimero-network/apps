#!/usr/bin/env bash
# scripts/workflows.sh — run merobox WASM-logic workflows with cleanup.
#
# Boots a real merod node in Docker (via merobox), deploys the WASM, runs each
# workflow's call/assert steps, and tears the containers down afterwards
# (always, via trap). Requires Docker running + merobox installed.
#
# Usage: scripts/workflows.sh [workflow.yml ...]   (default: workflows/logic-test.yml)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOWS_DIR="$REPO_ROOT/workflows"

green() { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
red()   { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; }
step()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

command -v merobox >/dev/null 2>&1 || { red "merobox not found — pip install merobox"; exit 1; }
docker info >/dev/null 2>&1 || { red "Docker is not running — start Docker Desktop first"; exit 1; }

cleanup() {
  (cd "$WORKFLOWS_DIR" && merobox nuke --force >/dev/null 2>&1) || true
  ids=$(docker ps -aq --filter "name=calimero-node" 2>/dev/null)
  [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Ensure the WASM exists.
[ -f "$REPO_ROOT/logic/res/mero_tag.wasm" ] || (cd "$REPO_ROOT/logic" && bash build.sh)

FILES=("$@")
[ ${#FILES[@]} -eq 0 ] && FILES=("logic-test.yml")

FAIL=0
for f in "${FILES[@]}"; do
  step "Running workflow: $f"
  ( cd "$WORKFLOWS_DIR" && merobox bootstrap run "$f" )
  if [ $? -eq 0 ]; then green "$f passed"; else red "$f FAILED"; FAIL=1; fi
  (cd "$WORKFLOWS_DIR" && merobox nuke --force >/dev/null 2>&1) || true
done

exit $FAIL
