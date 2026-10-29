#!/usr/bin/env bash
# Regenerate the native contract clients from the contract's ABI
# (../logic/res/abi.json) with calimero-abi-codegen's swift and kotlin targets.
# Run after the contract changes, then commit the two generated files.
#
#   ./scripts/regenerate-clients.sh
#   ABI_CODEGEN="node /path/to/abi-codegen/dist/cli.js" ./scripts/regenerate-clients.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abi="$here/../logic/res/abi.json"
codegen="${ABI_CODEGEN:-calimero-abi-codegen}"

# shellcheck disable=SC2086 # ABI_CODEGEN may be a command with arguments
$codegen -i "$abi" -o "$here/ios/Core/Sources/CrmGenerated" \
  --target swift --client-name CrmClient
# shellcheck disable=SC2086
$codegen -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/crm/generated" \
  --target kotlin --package network.calimero.crm.generated --client-name CrmClient
