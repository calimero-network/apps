#!/bin/sh
# merobox `target: local` step entry. Runs the amortization driver under merobox's
# own Python (has merobox + calimero_client_py), falling back to python3.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$HERE/lib/driver_amortization.py"

PYBIN="python3"
MEROBOX_BIN="$(command -v merobox 2>/dev/null || true)"
if [ -n "$MEROBOX_BIN" ]; then
  CAND="$(sed -n '1s/^#!//p' "$MEROBOX_BIN" 2>/dev/null || true)"
  [ -x "$CAND" ] && PYBIN="$CAND"
fi

exec "$PYBIN" "$DRIVER" "$@"
