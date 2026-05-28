#!/usr/bin/env bash
# scripts/dev-node2.sh — Start a second local merod node for MeroDesign development.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NODE_NAME="merodesign-dev-2"
NODE_HOME="${MERODESIGN_DEV_NODE2_HOME:-$HOME/.calimero/merodesign-dev-2}"
NODE_PORT="${MERODESIGN_DEV2_PORT:-2431}"
NODE_P2P_PORT="${MERODESIGN_DEV2_P2P_PORT:-2531}"
NODE_URL="http://localhost:${NODE_PORT}"

NODE1_P2P_PORT="${MERODESIGN_DEV_P2P_PORT:-2530}"

green()  { printf '\033[32m  ✓  %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m  !  %s\033[0m\n' "$*"; }
red()    { printf '\033[31m  ✗  %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;36m▶  %s\033[0m\n' "$*"; }

pid_file() { echo "/tmp/merodesign-dev-node2.pid"; }

STOP=false; CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --stop)  STOP=true ;;
    --clean) STOP=true; CLEAN=true ;;
  esac
done

if $STOP; then
  step "Stopping dev node 2"
  pf=$(pid_file)
  if [ -f "$pf" ]; then
    pid=$(cat "$pf")
    kill "$pid" 2>/dev/null || true
    rm -f "$pf"
  fi
  pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
  $CLEAN && rm -rf "$NODE_HOME" && yellow "Removed $NODE_HOME" || true
  green "Done"
  exit 0
fi

step "Nuking existing node2"
pf=$(pid_file)
[ -f "$pf" ] && kill "$(cat "$pf")" 2>/dev/null || true
pkill -f "merod --node ${NODE_NAME}" 2>/dev/null || true
rm -rf "$NODE_HOME" "$pf" 2>/dev/null || true

step "Initialising node2"
merod --node "$NODE_NAME" --home "$NODE_HOME" init \
  --server-host 127.0.0.1 \
  --server-port "$NODE_PORT" \
  --swarm-port  "$NODE_P2P_PORT"

# Bootstrap node2 with node1's multiaddr so they can find each other
CONFIG_FILE="$NODE_HOME/${NODE_NAME}/config.toml"
if [ -f "$CONFIG_FILE" ]; then
  NODE1_ADDR="/ip4/127.0.0.1/tcp/${NODE1_P2P_PORT}"
  python3 - "$CONFIG_FILE" "$NODE1_ADDR" <<'PYEOF'
import sys, re
path, addr = sys.argv[1], sys.argv[2]
txt = open(path).read()
if 'nodes = [' in txt:
    txt = re.sub(r'(nodes\s*=\s*\[)[^\]]*\]',
                 f'\\1"{addr}"]', txt)
else:
    txt += f'\n[bootstrap]\nnodes = ["{addr}"]\n'
txt = re.sub(r'allow_all_origins\s*=\s*false', 'allow_all_origins = true', txt)
open(path, 'w').write(txt)
PYEOF
  green "Patched node1 bootstrap addr into node2 config"
fi

step "Starting node2"
merod --node "$NODE_NAME" --home "$NODE_HOME" run \
  > "/tmp/merodesign-dev-node2.log" 2>&1 &
echo $! > "$(pid_file)"
green "Node2 started (pid $!  logs: /tmp/merodesign-dev-node2.log)"
printf '  Node URL: http://localhost:%s\n' "$NODE_PORT"
