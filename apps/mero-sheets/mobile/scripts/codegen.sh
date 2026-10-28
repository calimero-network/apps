#!/usr/bin/env bash
# Regenerate the typed contract clients from the contract's ABI (../logic/res/abi.json):
#   ios/Core/Sources/SheetsCore/Generated/SheetsClient.swift
#   android/app/src/main/kotlin/network/calimero/sheets/generated/SheetsClient.kt
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/codegen.sh
#
# ABI_CODEGEN is the built CLI of @calimero/abi-codegen (mero-devtools-js) with the swift and
# kotlin targets. Never edit the generated files by hand; change the contract and regenerate.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${ABI_CODEGEN:?set ABI_CODEGEN to the abi-codegen cli.js}"
abi="$here/../logic/res/abi.json"

node "$cli" -i "$abi" -o "$here/ios/Core/Sources/SheetsCore/Generated" \
  --target swift --client-name SheetsClient --transport-import MeroKit
node "$cli" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/sheets/generated" \
  --target kotlin --package network.calimero.sheets.generated --client-name SheetsClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
