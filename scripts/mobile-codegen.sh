#!/usr/bin/env bash
# Writes each native app's typed contract client from its committed ABI
# (`apps/<app>/logic/res/abi.json`) with core's `mero-app-build codegen`:
# `<Name>Client.swift` over swift-sdk's MeroKit for iOS, `<Name>Client.kt` over
# kotlin-sdk's mero-core for Android. `--check` (CI: .github/workflows/mobile-clients.yml)
# regenerates them and fails when a committed client differs or is missing.
#
#   scripts/mobile-codegen.sh            # regenerate every client below
#   scripts/mobile-codegen.sh --check    # regenerate, then fail on any difference
#   scripts/mobile-codegen.sh --install  # put the pinned generator in $MERO_APP_BUILD_ROOT/bin first
#
# The generator is core at REV below: the Swift and Kotlin targets are on core
# master ahead of a release (they ship in 1.0.0-rc.19). Once a tag has them,
# pin it here and in scripts/install-mero-app-build.sh, and keep the two equal.
# Moving REV changes what every client looks like, so regenerate them all in
# the same PR.
#
# The web apps' clients are the frontend job's (`pnpm -r codegen`, ci.yml).
set -euo pipefail

REV=3f2bc52b0a4bf1f422c6579bf5350a347f33f9ef
ROOT="${MERO_APP_BUILD_ROOT:-${CARGO_HOME:-$HOME/.cargo}}"

# app | lang | output directory | client name | Kotlin package
CLIENTS=(
  "mero-chess|swift|apps/mero-chess/mobile/ios/ChessCore/Sources/ChessCore/Generated|mero-chess|"
  "mero-chess|kotlin|apps/mero-chess/mobile/android/app/src/main/kotlin/network/calimero/chess/generated|mero-chess|network.calimero.chess.generated"
)

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

check=false
for arg in "$@"; do
  case "$arg" in
    --check) check=true ;;
    --install)
      stamp="$ROOT/.mero-app-build-rev"
      if [ -x "$ROOT/bin/mero-app-build" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$REV" ]; then
        echo "mero-app-build $REV already in $ROOT/bin"
      else
        cargo install --locked --force --root "$ROOT" \
          --git https://github.com/calimero-network/core --rev "$REV" \
          calimero-app-build
        echo "$REV" > "$stamp"
      fi
      export PATH="$ROOT/bin:$PATH"
      ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v mero-app-build >/dev/null || { echo "mero-app-build is not on PATH (run with --install)" >&2; exit 1; }

outs=()
for entry in "${CLIENTS[@]}"; do
  IFS='|' read -r app lang out name package <<<"$entry"
  args=(codegen --abi "apps/$app/logic/res/abi.json" --lang "$lang" --name "$name" --no-openapi -o "$out")
  [ -n "$package" ] && args+=(--package "$package")
  mero-app-build "${args[@]}"
  outs+=("$out")
done

if $check; then
  # Untracked output is invisible to `git diff`, so an uncommitted client would pass.
  git add --intent-to-add -- "${outs[@]}"
  if ! git diff --quiet -- "${outs[@]}"; then
    echo "::error::a generated mobile client is stale. Run 'scripts/mobile-codegen.sh --install' and commit."
    git --no-pager diff --stat -- "${outs[@]}"
    git --no-pager diff -- "${outs[@]}" | head -200
    exit 1
  fi
  echo "generated mobile clients match the committed ABIs"
fi
