#!/usr/bin/env bash
# A fake call you can watch: four voices (macOS `say`) talk through a script on
# a stand-in Meet / Zoom / Teams page while the real extension records it,
# names each line and saves it to a local node. Then the saved meeting opens
# on the Sylence page. See extension/e2e/fake-call.spec.ts.
#
#   apps/mero-sylence/fake-call.sh                 # watch it on every platform, one after another
#   apps/mero-sylence/fake-call.sh zoom            # one: meet | meet-captions | zoom | teams
#   apps/mero-sylence/fake-call.sh all             # every platform, no windows; reports only
#
# Reports: apps/mero-sylence/extension/e2e/.fake-call/report-<platform>.md
# Needs macOS. Starts `pnpm dev:local mero-sylence` if no local node is up
# (merod from MEROD_BIN, PATH, or ~/Desktop/calimero/bin-rc38/bin).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLATFORM="${1:-meet,meet-captions,zoom,teams}"

[ "$(uname)" = "Darwin" ] || { echo "The fake call needs macOS (its voices come from \`say\`)." >&2; exit 1; }

if [ -d "$HOME/Desktop/calimero/bin-rc38/bin" ]; then
  export PATH="$HOME/Desktop/calimero/bin-rc38/bin:$PATH"
fi

cd "$ROOT"
# A checkout last installed before a dependency bump runs stale packages (e.g. an older
# mero-js without an export dev:local imports): match the lockfile first. Quick when it does.
echo "• installing dependencies (pnpm install)…"
pnpm install --frozen-lockfile --prefer-offline > /dev/null

started=""
if ! curl -sf -o /dev/null http://127.0.0.1:2501/health && ! curl -s -o /dev/null http://127.0.0.1:2501/; then
  echo "• starting the local nodes and the Sylence page (pnpm dev:local mero-sylence)…"
  # The log lives where dev:local keeps its state; on a fresh checkout that folder is not there yet.
  mkdir -p "$ROOT/.merod-local"
  pnpm dev:local mero-sylence > "$ROOT/.merod-local/fake-call-dev.log" 2>&1 &
  started=$!
  trap '[ -n "$started" ] && kill "$started" 2>/dev/null || true' EXIT
  for _ in $(seq 1 150); do
    curl -s -o /dev/null http://localhost:5173/ && break
    # dev:local stopped: say why now instead of waiting out the five minutes.
    if ! kill -0 "$started" 2>/dev/null; then
      echo "pnpm dev:local mero-sylence stopped. The end of .merod-local/fake-call-dev.log:" >&2
      tail -20 "$ROOT/.merod-local/fake-call-dev.log" >&2
      exit 1
    fi
    sleep 2
  done
  curl -s -o /dev/null http://localhost:5173/ || {
    echo "the local page did not come up in 5 minutes. The end of .merod-local/fake-call-dev.log:" >&2
    tail -20 "$ROOT/.merod-local/fake-call-dev.log" >&2
    exit 1
  }
fi

if [ "$PLATFORM" = "all" ]; then
  pnpm -F mero-sylence-extension e2e:call
else
  SYLENCE_CALL_PLATFORMS="$PLATFORM" pnpm -F mero-sylence-extension e2e:call:watch
fi

echo
echo "Reports: $HERE/extension/e2e/.fake-call/"
