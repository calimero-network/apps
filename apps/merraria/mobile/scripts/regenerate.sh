#!/usr/bin/env bash
# Regenerate the typed contract clients from the contract's ABI (logic/res/abi.json), for both
# native apps, with @calimero/abi-codegen (mero-devtools-js). Commit the result.
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate.sh
#
# Without ABI_CODEGEN it runs the published CLI through npx. `--transport-import` makes the
# generated clients take the SDKs' own `ContextContractCalling`, so
# `MerrariaClient(transport: contract.bound(to: contextId))` needs no adapter.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abi="$here/../logic/res/abi.json"

if [ -n "${ABI_CODEGEN:-}" ]; then
  codegen=(node "$ABI_CODEGEN")
else
  codegen=(npx --yes @calimero-network/abi-codegen)
fi

"${codegen[@]}" -i "$abi" -o "$here/ios/MerrariaCore/Sources/MerrariaCore/Generated" \
  --target swift --client-name MerrariaClient --transport-import MeroKit
"${codegen[@]}" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/merraria/generated" \
  --target kotlin --package network.calimero.merraria.generated --client-name MerrariaClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
