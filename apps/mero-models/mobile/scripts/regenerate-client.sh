#!/usr/bin/env bash
# Regenerate the typed contract client for both apps from the contract's ABI
# (../logic/res/abi.json). Never hand-edit the generated files; run this after
# the contract changes and commit the result.
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
#
# ABI_CODEGEN defaults to `npx @calimero-network/abi-codegen` (it needs the
# `swift`/`kotlin` targets and `--transport-import`).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abi="$here/../logic/res/abi.json"
if [ -n "${ABI_CODEGEN:-}" ]; then
  codegen=(node "$ABI_CODEGEN")
else
  codegen=(npx --yes @calimero-network/abi-codegen)
fi

"${codegen[@]}" -i "$abi" -o "$here/ios/ModelsCore/Sources/ModelsCore/Generated" \
  --target swift --client-name ModelsClient --transport-import MeroKit
"${codegen[@]}" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/models/generated" \
  --target kotlin --package network.calimero.models.generated --client-name ModelsClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
