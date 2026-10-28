#!/usr/bin/env bash
# Regenerate the typed contract clients from the contract's ABI (../logic/res/abi.json):
#   ios/Core/Sources/IssueTrackerCore/Generated/IssueTrackerClient.swift
#   android/app/src/main/kotlin/network/calimero/issues/generated/IssueTrackerClient.kt
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/codegen.sh
#
# ABI_CODEGEN is the built CLI of @calimero/abi-codegen (mero-devtools-js) with the swift and
# kotlin targets. Never edit the generated files by hand; change the contract and regenerate.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${ABI_CODEGEN:?set ABI_CODEGEN to the abi-codegen cli.js}"
abi="$here/../logic/res/abi.json"

node "$cli" -i "$abi" -o "$here/ios/Core/Sources/IssueTrackerCore/Generated" \
  --target swift --client-name IssueTrackerClient
node "$cli" -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/issues/generated" \
  --target kotlin --package network.calimero.issues.generated --client-name IssueTrackerClient
