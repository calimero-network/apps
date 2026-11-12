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
  "mero-kombat|swift|apps/mero-kombat/mobile/ios/KombatCore/Sources/KombatCore/Generated|kombat|"
  "mero-kombat|kotlin|apps/mero-kombat/mobile/android/app/src/main/kotlin/network/calimero/kombat/generated|kombat|network.calimero.kombat.generated"
  "merraria|swift|apps/merraria/mobile/ios/MerrariaCore/Sources/MerrariaCore/Generated|merraria|"
  "merraria|kotlin|apps/merraria/mobile/android/app/src/main/kotlin/network/calimero/merraria/generated|merraria|network.calimero.merraria.generated"
  "mero-blocks|swift|apps/mero-blocks/mobile/ios/BlocksCore/Sources/BlocksCore/Generated|blocks|"
  "mero-blocks|kotlin|apps/mero-blocks/mobile/android/app/src/main/kotlin/network/calimero/blocks/generated|blocks|network.calimero.blocks.generated"
  "battleships|swift|apps/battleships/mobile/ios/BattleshipsCore/Sources/BattleshipsCore/Generated|battleships|"
  "battleships|kotlin|apps/battleships/mobile/android/app/src/main/kotlin/network/calimero/battleships/generated|battleships|network.calimero.battleships.generated"
  "mero-crm|swift|apps/mero-crm/mobile/ios/Core/Sources/CrmGenerated|crm|"
  "mero-crm|kotlin|apps/mero-crm/mobile/android/app/src/main/kotlin/network/calimero/crm/generated/client|crm|network.calimero.crm.generated.client"
  "mero-design|swift|apps/mero-design/mobile/ios/DesignCore/Sources/DesignCore/Generated|design|"
  "mero-design|kotlin|apps/mero-design/mobile/android/app/src/main/kotlin/network/calimero/design/generated/client|design|network.calimero.design.generated.client"
  "mero-models|swift|apps/mero-models/mobile/ios/ModelsCore/Sources/ModelsCore/Generated|models|"
  "mero-models|kotlin|apps/mero-models/mobile/android/app/src/main/kotlin/network/calimero/models/generated/client|models|network.calimero.models.generated.client"
  "mero-pass|swift|apps/mero-pass/mobile/ios/PassCore/Sources/PassGenerated|pass|"
  "mero-pass|kotlin|apps/mero-pass/mobile/android/app/src/main/kotlin/network/calimero/pass/generated/client|pass|network.calimero.pass.generated.client"
  "mero-pixart|swift|apps/mero-pixart/mobile/ios/PixartCore/Sources/PixartCore/Generated|pixart|"
  "mero-pixart|kotlin|apps/mero-pixart/mobile/android/app/src/main/kotlin/network/calimero/pixart/generated/client|pixart|network.calimero.pixart.generated.client"
  "mero-sign|swift|apps/mero-sign/mobile/ios/SignCore/Sources/SignCore/Generated|sign|"
  "mero-sign|kotlin|apps/mero-sign/mobile/android/app/src/main/kotlin/network/calimero/sign/generated/client|sign|network.calimero.sign.generated.client"
  "mero-updates|swift|apps/mero-updates/mobile/ios/Core/Sources/UpdatesCore/Generated|updates|"
  "mero-updates|kotlin|apps/mero-updates/mobile/android/app/src/main/kotlin/network/calimero/updates/generated/client|updates|network.calimero.updates.generated.client"
  "mero-vote|swift|apps/mero-vote/mobile/ios/VoteCore/Sources/VoteCore/Generated|vote|"
  "mero-vote|kotlin|apps/mero-vote/mobile/android/app/src/main/kotlin/network/calimero/vote/generated/client|vote|network.calimero.vote.generated.client"
  "mero-sheets|swift|apps/mero-sheets/mobile/ios/Core/Sources/SheetsCore/Generated|sheets|"
  "mero-sheets|kotlin|apps/mero-sheets/mobile/android/app/src/main/kotlin/network/calimero/sheets/generated/client|sheets|network.calimero.sheets.generated.client"
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
