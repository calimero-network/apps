#!/usr/bin/env bash
# Regenerate the native contract clients from the two services' ABIs.
#
#   CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/codegen.sh
#
# CODEGEN is the built `@calimero/abi-codegen` CLI (mero-devtools-js). Each service gets its own
# client and its own Swift module / Kotlin package: both generated files declare a
# `ContextContractCalling`, which would collide in one module.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
logic="$here/../logic"
cli="${CODEGEN:?set CODEGEN to the abi-codegen dist/cli.js}"

lobby_abi="$logic/res/abi.json"
game_abi="$logic/crates/game/res/abi.json"

ios="$here/ios/BattleshipsCore/Sources"
node "$cli" -i "$lobby_abi" -o "$ios/LobbyGenerated" --target swift --client-name LobbyClient
node "$cli" -i "$game_abi" -o "$ios/GameGenerated" --target swift --client-name GameClient

kt="$here/android/app/src/main/kotlin/network/calimero/battleships/generated"
node "$cli" -i "$lobby_abi" -o "$kt/lobby" --target kotlin \
  --package network.calimero.battleships.generated.lobby --client-name LobbyClient
node "$cli" -i "$game_abi" -o "$kt/game" --target kotlin \
  --package network.calimero.battleships.generated.game --client-name GameClient
