#!/usr/bin/env bash
# Fail if the .mpk in dist/ was built against an older SDK than this tree pins.
#
# WHY THIS EXISTS — a stale bundle fails SILENTLY, and nothing else catches it.
#
# `dist/` is gitignored, so a .mpk built months ago survives every pull, every
# rebase and every dependency bump. Installing one is not refused: the node
# checks `minRuntimeVersion` as a FLOOR (bundle too NEW for the node is an
# error), so a bundle built against an OLDER core installs happily onto a newer
# node and runs. It then misbehaves without erroring anywhere.
#
# Observed, on a bundle built at rc.28 installed onto an rc.38 node: `init`'s
# writer-set seeding produced EMPTY sets. `AccessControl::new_admin_caller()`,
# `Ownable::new_owned_by_caller()` and `SharedStorage::new(…)` all stored
# nothing, so `acl_admins` was `[]`, `owned_owner` was `null`, and every gated
# write came back `Executor is not authorised for this operation` — including
# for the account that created the context. No install error, no link error, no
# log line. Rebuilt from the same source, all of it passed.
#
# The comparison is against the TREE's declared min-runtime-version, not against
# the node: a bundle built at the pinned version and run on a newer node is
# legitimate and must stay quiet.
set -euo pipefail
cd "$(dirname "$0")"

PINNED=$(sed -n 's/^min-runtime-version *= *"\(.*\)"/\1/p' Cargo.toml | head -1)
[ -n "$PINNED" ] || { echo "check-bundle-fresh: no min-runtime-version in Cargo.toml"; exit 1; }

shopt -s nullglob
# Bundles land in the WORKSPACE dist/ (cargo mero resolves the workspace root),
# with logic/dist/ kept as a fallback for a bundle built under the old layout.
mpks=(../../../dist/com.calimero.scaffolding-e2e*.mpk dist/com.calimero.scaffolding-e2e*.mpk)
if [ ${#mpks[@]} -eq 0 ]; then
  echo "check-bundle-fresh: no bundle found — nothing to check (build with ./build.sh && cargo mero bundle --dev)"
  exit 0
fi

fail=0
for mpk in "${mpks[@]}"; do
  # An .mpk is a GZIPPED TAR, not a zip — `unzip` fails on it, and failing
  # quietly here would turn this guard into a check that always passes.
  built=$(tar xOf "$mpk" manifest.json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("minRuntimeVersion",""))' 2>/dev/null || true)
  if [ -z "$built" ]; then
    echo "✗ $mpk — no minRuntimeVersion in its manifest; cannot tell what it was built against"
    fail=1
  elif [ "$built" != "$PINNED" ]; then
    echo "✗ $(basename "$mpk") was built against $built, but this tree pins $PINNED."
    echo "  It will install and run anyway, and misbehave silently. Rebuild:"
    echo "      cd logic && ./build.sh && cargo mero bundle --dev"
    fail=1
  else
    echo "✓ $(basename "$mpk") built against $built (matches the pin)"
  fi
done
exit $fail
