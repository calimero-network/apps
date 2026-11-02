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

# The contract is a component now (calimero:abi, `abiVersion` 1 with camelCase
# methods); abi-codegen reads v1 ABIs only, and the native apps still speak the
# v1 contract through the v1 relay. See ../README.md.
if grep -q '"abiVersion"' "$abi"; then
  echo "regenerate-client.sh: $abi is a component ABI; the native apps stay on the v1 contract (see mobile/README.md)" >&2
  exit 1
fi

"${codegen[@]}" -i "$abi" -o "$here/ios/ModelsCore/Sources/ModelsCore/Generated" \
  --target swift --client-name ModelsClient --transport-import MeroKit
"${codegen[@]}" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/models/generated" \
  --target kotlin --package network.calimero.models.generated --client-name ModelsClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
