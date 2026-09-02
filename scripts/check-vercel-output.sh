#!/usr/bin/env bash
# Assert every app's `vercel.json` names the directory its build really writes.
#
# A mismatch here is invisible in code review and produces a deploy that
# succeeds and then serves nothing — Vercel uploads an empty output directory
# without complaining. mero-sign shipped that way: its `vercel.json` pointed at
# `apps/mero-sign/build`, a path no build ever wrote.
#
#   scripts/check-vercel-output.sh          # assert against existing builds
#   scripts/check-vercel-output.sh --build  # build each app first (slow)
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=0
[[ "${1:-}" == "--build" ]] && BUILD=1

fail=0
for d in apps/*/app; do
  app="$(basename "$(dirname "$d")")"
  cfg="$d/vercel.json"

  if [[ ! -f "$cfg" ]]; then
    printf '  %-19s NO vercel.json\n' "$app"; fail=1; continue
  fi

  out="$(python3 -c "import json,sys; print(json.load(open('$cfg')).get('outputDirectory') or 'dist')")"

  # Every app routes client-side, so a missing SPA rewrite means any non-root
  # path 404s on direct load — including an invite deep link.
  has_spa="$(python3 -c "
import json
c=json.load(open('$cfg'))
print(any(r.get('destination')=='/index.html' for r in c.get('rewrites') or []))")"

  if (( BUILD )); then
    pnpm --filter "./$d" build >/tmp/vercel-check-$app.log 2>&1 || {
      printf '  %-19s BUILD FAILED (see /tmp/vercel-check-%s.log)\n' "$app" "$app"; fail=1; continue; }
  fi

  if [[ ! -f "$d/$out/index.html" ]]; then
    printf '  %-19s outputDirectory=%-6s but %s/index.html is MISSING\n' "$app" "$out" "$out"
    fail=1; continue
  fi

  n="$(find "$d/$out" -type f | wc -l | tr -d ' ')"
  printf '  %-19s outputDirectory=%-6s index.html ✓  %4s files  spa-rewrite=%s\n' \
    "$app" "$out" "$n" "$has_spa"
  [[ "$has_spa" == "True" ]] || { echo "      ^ missing SPA rewrite"; fail=1; }
done

exit $fail
