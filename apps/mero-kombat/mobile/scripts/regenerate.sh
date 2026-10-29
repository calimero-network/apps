#!/usr/bin/env bash
# Regenerate the typed contract clients from the contract's ABI (logic/res/abi.json), for both
# native apps, with @calimero-network/abi-codegen (mero-devtools-js). Commit the result.
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate.sh
#
# Without ABI_CODEGEN it runs the published CLI through npx (it needs a build with the Swift and
# Kotlin targets and --transport-import). The generated clients take the SDKs' own
# ContextContractCalling, so `KombatClient(transport: contract.bound(to: contextId))` needs no adapter.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abi="$here/../logic/res/abi.json"

if [ -n "${ABI_CODEGEN:-}" ]; then
  codegen=(node "$ABI_CODEGEN")
else
  codegen=(npx --yes @calimero-network/abi-codegen)
fi

"${codegen[@]}" -i "$abi" -o "$here/ios/KombatCore/Sources/KombatCore/Generated" \
  --target swift --client-name KombatClient --transport-import MeroKit
"${codegen[@]}" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/kombat/generated" \
  --target kotlin --package network.calimero.kombat.generated --client-name KombatClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
