#!/usr/bin/env bash
# Puts core's `mero-app-build` on PATH at the tag below: the tool whose
# `codegen` writes an app's typed client (`apps/<app>/app/src/generated/`) from
# its committed ABI. `pnpm -F <app> codegen` runs it; CI's frontend job runs
# every app's `codegen` and fails when the committed client differs.
#
#   scripts/install-mero-app-build.sh          # into ~/.cargo/bin (cargo's default)
#   MERO_APP_BUILD_ROOT=/opt/mab scripts/install-mero-app-build.sh
#
# The tag is the generator's, not the SDK's: it can run ahead of
# `component-core-tag` (1.0.0-rc.18 has the AppTransport/`after`/`confirm`
# client of core#4992 and the typed records of core#4997; earlier tags write a
# client over the retired `CalimeroClient.call`). Moving it changes what every
# generated client looks like, so regenerate them all in the same PR
# (`pnpm -r codegen`). Once `component-core-tag` reaches it, keep the two equal.
#
# Installs only when the binary under the root was not built from this tag
# (a stamp file beside it), so a cached root costs nothing.
set -euo pipefail

TAG="${MERO_APP_BUILD_TAG:-1.0.0-rc.18}"
ROOT="${MERO_APP_BUILD_ROOT:-${CARGO_HOME:-$HOME/.cargo}}"
STAMP="$ROOT/.mero-app-build-tag"

if [ -x "$ROOT/bin/mero-app-build" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TAG" ]; then
  echo "mero-app-build $TAG already in $ROOT/bin"
  exit 0
fi

cargo install --locked --force --root "$ROOT" \
  --git https://github.com/calimero-network/core --tag "$TAG" \
  calimero-app-build
echo "$TAG" > "$STAMP"
echo "mero-app-build $TAG installed in $ROOT/bin"
