#!/usr/bin/env bash
# Regenerate the typed contract clients from the contract's ABI (logic/res/abi.json), for both
# native apps, with @calimero/abi-codegen (mero-devtools-js). Commit the result.
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate.sh
#
# Without ABI_CODEGEN it runs the published CLI through npx (it needs a release with the Swift and
# Kotlin targets and --transport-import). The clients use the SDKs' own ContextContractCalling, so
# `BlocksClient(transport: contract.bound(to: contextId))` needs no adapter.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abi="$here/../logic/res/abi.json"

if [ -n "${ABI_CODEGEN:-}" ]; then
  codegen=(node "$ABI_CODEGEN")
else
  codegen=(npx --yes @calimero-network/abi-codegen)
fi

"${codegen[@]}" -i "$abi" -o "$here/ios/BlocksCore/Sources/BlocksCore/Generated" \
  --target swift --client-name BlocksClient --transport-import MeroKit
"${codegen[@]}" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/blocks/generated" \
  --target kotlin --package network.calimero.blocks.generated --client-name BlocksClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
