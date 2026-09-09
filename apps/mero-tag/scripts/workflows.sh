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

# Ensure the signed dev BUNDLE exists — the scenarios install `.mpk`, not a raw
# `.wasm`, because merod refuses the latter on the dev install from 0.11.0-rc.32
# ("not a signed application bundle"). `--dev` uses the well-known development
# key: a local node accepts it, the registry refuses it.
#
# NOT build-bundle.sh, which hand-rolls the manifest, pins minRuntimeVersion to
# 0.1.0, emits no ABI, and signs only if a sibling core checkout happens to be
# present — leaving an UNSIGNED bundle the node rejects wherever that checkout
# is missing, CI included.
BUNDLE="$REPO_ROOT/logic/dist/mero-tag-dev.mpk"
if [ ! -s "$BUNDLE" ]; then
  step "Building signed dev bundle"
  ( cd "$REPO_ROOT/logic" && cargo mero bundle --dev --no-icon --app-version 0.0.1 --output dist/mero-tag-dev.mpk ) \
    || { red "cargo mero bundle failed — is cargo-mero installed?"; exit 1; }
fi

FILES=("$@")
[ ${#FILES[@]} -eq 0 ] && FILES=("logic-test.yml")

FAIL=0
for f in "${FILES[@]}"; do
  step "Running workflow: $f"
  # MEROD_LOG sets RUST_LOG for the merod nodes merobox boots; it has to go on
  # the CLI, because `bootstrap run --log-level` defaults to "debug" and so
  # merobox's `log_level:` workflow-YAML fallback is never reached. Defaults to
  # info here and locally; CI raises it to debug on a debug re-run.
  ( cd "$WORKFLOWS_DIR" && merobox bootstrap run --log-level "${MEROD_LOG:-info}" "$f" )
  if [ $? -eq 0 ]; then green "$f passed"; else red "$f FAILED"; FAIL=1; fi
  (cd "$WORKFLOWS_DIR" && merobox nuke --force >/dev/null 2>&1) || true
done

exit $FAIL
