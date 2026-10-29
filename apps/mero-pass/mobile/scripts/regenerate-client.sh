#!/usr/bin/env bash
# Regenerate the typed contract client for both apps from the contract's ABI
# (apps/mero-pass/logic/res/abi.json), with mero-devtools-js's abi-codegen.
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
#
# Commit the two generated files. Never edit them by hand.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${ABI_CODEGEN:?set ABI_CODEGEN to the abi-codegen dist/cli.js}"
abi="$here/../logic/res/abi.json"

node "$cli" -i "$abi" -o "$here/ios/PassCore/Sources/PassGenerated" \
  --target swift --client-name PassClient
node "$cli" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/pass/generated" \
  --target kotlin --package network.calimero.pass.generated --client-name PassClient
