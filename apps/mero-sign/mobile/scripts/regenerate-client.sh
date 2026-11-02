#!/usr/bin/env bash
# Regenerate the typed contract client for both apps from the contract's ABI
# (apps/mero-sign/logic/res/abi.json), with mero-devtools-js's abi-codegen. Both
# use the SDK's own ContextContractCalling (`--transport-import`), so the client
# takes `contract.bound(...)` directly.
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
#
# Commit the two generated files. Never edit them by hand.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${ABI_CODEGEN:?set ABI_CODEGEN to the abi-codegen dist/cli.js}"
abi="$here/../logic/res/abi.json"

# The contract is a component now (calimero:abi, `abiVersion` 1 with camelCase
# methods); abi-codegen reads v1 ABIs only, and the native apps still speak the
# v1 contract through the v1 relay. See ../README.md.
if grep -q '"abiVersion"' "$abi"; then
  echo "regenerate-client.sh: $abi is a component ABI; the native apps stay on the v1 contract (see mobile/README.md)" >&2
  exit 1
fi

node "$cli" -i "$abi" -o "$here/ios/SignCore/Sources/SignCore/Generated" \
  --target swift --client-name SignClient --transport-import MeroKit
node "$cli" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/sign/generated" \
  --target kotlin --package network.calimero.sign.generated --client-name SignClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
