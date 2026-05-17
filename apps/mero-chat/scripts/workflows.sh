#!/usr/bin/env bash
# scripts/workflows.sh — Run merobox workflow tests with full cleanup.
#
# What this guarantees, every run, regardless of how the previous run exited
# (success, failure, Ctrl-C, kill -9):
#
#   1. Pre-flight: kill any host-side `merod` processes that bind the ports
#      merobox needs (curb-dev / curb-dev-2 from `make start`, etc.) — without
#      this, container init fails with "address already in use" on 2528.
#   2. Pre-flight: stop+nuke any merobox containers (running OR stopped) and
#      delete leftover `data/calimero-node-*` directories.
#   3. Run each workflow via merobox.
#   4. Post-run (always — via trap on EXIT): repeat step 1+2 so the next run
#      starts from a clean state and ports are free for `make start`.
#
# Usage: scripts/workflows.sh <yml> [<yml> ...]
#
# Exit code mirrors the first failing workflow.

set -u  # don't set -e — we want explicit error handling so cleanup always runs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOWS_DIR="$REPO_ROOT/workflows"

# Ports merobox uses for default 2/3-node setups. Anything bound here will
# break container init — kill the holder before starting.
PORTS_TO_FREE=(2428 2429 2430 2431 2432 2528 2529 2530 2531 2532)

# ── Colours ───────────────────────────────────────────────────────────────────
green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

# ── Cleanup ───────────────────────────────────────────────────────────────────
#
# Idempotent. Runs at start AND at exit. Safe to call multiple times.

cleanup() {
  local tag="${1:-cleanup}"
  step "$tag"

  # 1) Kill host merod processes holding the ports we need.
  #    Limit to processes whose command starts with `merod` so we don't hit
  #    unrelated services that happen to bind the same port.
  local pids=()
  for port in "${PORTS_TO_FREE[@]}"; do
    while IFS= read -r pid; do
      [ -n "$pid" ] && pids+=("$pid")
    done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null \
             | xargs -I{} sh -c 'ps -p {} -o command= 2>/dev/null | grep -q "^merod" && echo {}')
  done
  if [ "${#pids[@]}" -gt 0 ]; then
    # dedupe
    local unique
    unique=$(printf '%s\n' "${pids[@]}" | sort -u | tr '\n' ' ')
    yellow "Killing host merod PIDs: $unique"
    # shellcheck disable=SC2086
    kill -9 $unique 2>/dev/null || true
    sleep 0.5
  fi

  # 2) Stop and nuke any merobox-managed nodes.
  if command -v merobox >/dev/null 2>&1; then
    (cd "$WORKFLOWS_DIR" && merobox stop --all   >/dev/null 2>&1) || true
    (cd "$WORKFLOWS_DIR" && merobox nuke --force >/dev/null 2>&1) || true
  fi

  # 3) Remove any orphaned `calimero-node-*-init` containers (left when a
  #    container was created but failed to start).
  if command -v docker >/dev/null 2>&1; then
    local stale
    stale=$(docker ps -a --filter 'name=calimero-node-' -q 2>/dev/null)
    if [ -n "$stale" ]; then
      yellow "Removing stale Calimero docker containers"
      # shellcheck disable=SC2086
      docker rm -f $stale >/dev/null 2>&1 || true
    fi
  fi

  # 4) Delete leftover data directories. merobox writes to ./workflows/data on
  #    the host (bind-mounted into containers); these survive `nuke` if the
  #    container failed to start cleanly.
  if [ -d "$WORKFLOWS_DIR/data" ]; then
    rm -rf "$WORKFLOWS_DIR/data"
    yellow "Removed $WORKFLOWS_DIR/data"
  fi

  green "$tag complete"
}

# Always clean up on exit, no matter how we got there.
trap 'cleanup "Final cleanup"' EXIT

# ── Pre-flight ────────────────────────────────────────────────────────────────

if ! command -v merobox >/dev/null 2>&1; then
  red "merobox not found in PATH"
  echo "  Install it: https://calimero-network.github.io/docs/merobox/install"
  exit 1
fi

if [ "$#" -eq 0 ]; then
  red "Usage: $0 <yml> [<yml> ...]"
  exit 2
fi

cleanup "Pre-flight cleanup"

# ── Run workflows ─────────────────────────────────────────────────────────────

# Prefer native-binary mode when the Docker daemon isn't reachable. setup-nodes.sh
# already uses `--no-docker` for the same merobox; workflows can do the same.
MEROBOX_FLAGS=()
if ! docker info >/dev/null 2>&1; then
  yellow "Docker daemon unreachable — running merobox with --no-docker"
  MEROBOX_FLAGS+=(--no-docker)
fi

failed=0
for yml in "$@"; do
  rel="${yml#"$REPO_ROOT/"}"
  step "Running $rel"
  # `${arr[@]+"${arr[@]}"}` is the set -u-safe way to expand a possibly-empty
  # array on macOS bash 3.2 — plain `"${arr[@]}"` triggers "unbound variable".
  if ! (cd "$WORKFLOWS_DIR" && merobox bootstrap run ${MEROBOX_FLAGS[@]+"${MEROBOX_FLAGS[@]}"} "$(basename "$yml")"); then
    red "$rel failed"
    failed=1
    # Clean between workflows even on failure so the next one starts fresh
    # (cleanup() is idempotent; the trap will run it again on exit).
    cleanup "Mid-run cleanup after failure"
    break
  fi
  green "$rel passed"
  cleanup "Post-workflow cleanup"
done

if [ "$failed" -eq 0 ]; then
  echo
  green "All workflow tests passed"
fi

exit "$failed"
