#!/bin/sh
# merobox `target: local` step entry. Runs the financial driver under merobox's
# own Python (guaranteed to have merobox + calimero_client_py), falling back to
# python3. The workflow passes the context id as SPREADSHEET_CTX (env) and the
# node names as positional args.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
DRIVER="$HERE/lib/driver_financial.py"

# Prefer merobox's interpreter (from its console-script shebang); else python3.
PYBIN="python3"
MEROBOX_BIN="$(command -v merobox 2>/dev/null || true)"
if [ -n "$MEROBOX_BIN" ]; then
  CAND="$(sed -n '1s/^#!//p' "$MEROBOX_BIN" 2>/dev/null || true)"
  [ -x "$CAND" ] && PYBIN="$CAND"
fi

exec "$PYBIN" "$DRIVER" "$@"
