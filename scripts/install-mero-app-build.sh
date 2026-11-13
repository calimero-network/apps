#!/usr/bin/env bash
# Puts core's `mero-app-build` on PATH at the ref below: the tool whose
# `codegen` writes an app's typed client (`apps/<app>/app/src/generated/`) from
# its committed ABI. `pnpm -F <app> codegen` runs it; CI's frontend job runs
# every app's `codegen` and fails when the committed client differs.
#
#   scripts/install-mero-app-build.sh          # into ~/.cargo/bin (cargo's default)
#   MERO_APP_BUILD_ROOT=/opt/mab scripts/install-mero-app-build.sh
#
# The ref is the generator's, not the SDK's: it can run ahead of
# `component-core-tag`. It is a tag (`1.0.0-rc.18`) or a full commit sha of
# core; a sha is installed with `--rev`, anything else with `--tag`.
#
# Now the 1.0.0-rc.23 tag, which `component-core-tag` and
# scripts/mobile-codegen.sh also name: it has core#5027 (1.0.0-rc.21:
# `#[abi(plain)]`'s `u64_number` / `i64_number` / `byte_list`,
# `#[serde(default)]` fields optional, unset optionals left out,
# `--kotlin-serialization-plugin`), on top of core#5011, core#5005 and
# core#5007.
#
# Moving it changes what every generated client looks like, so regenerate them
# all in the same PR (`pnpm -r codegen`). Once `component-core-tag` reaches
# it, keep the two equal.
#
# Installs only when the binary under the root was not built from this ref
# (a stamp file beside it), so a cached root costs nothing.
set -euo pipefail

REF="${MERO_APP_BUILD_REF:-${MERO_APP_BUILD_TAG:-1.0.0-rc.23}}"
ROOT="${MERO_APP_BUILD_ROOT:-${CARGO_HOME:-$HOME/.cargo}}"
STAMP="$ROOT/.mero-app-build-tag"

if [[ "$REF" =~ ^[0-9a-f]{40}$ ]]; then
  SOURCE=(--rev "$REF")
else
  SOURCE=(--tag "$REF")
fi

if [ -x "$ROOT/bin/mero-app-build" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$REF" ]; then
  echo "mero-app-build $REF already in $ROOT/bin"
  exit 0
fi

cargo install --locked --force --root "$ROOT" \
  --git https://github.com/calimero-network/core "${SOURCE[@]}" \
  calimero-app-build
echo "$REF" > "$STAMP"
echo "mero-app-build $REF installed in $ROOT/bin"
