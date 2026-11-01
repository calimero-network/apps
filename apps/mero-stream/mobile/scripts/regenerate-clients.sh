#!/usr/bin/env bash
# Regenerate the native contract clients from the contract's ABI
# (../logic/res/abi.json) with calimero-abi-codegen's swift and kotlin targets.
# Both use the SDKs' own ContextContractCalling (--transport-import), so
# `StreamClient(transport: contract.bound(to: contextId))` needs no adapter.
# Run after the contract changes, then commit the two generated files.
#
#   ./scripts/regenerate-clients.sh
#   ABI_CODEGEN="node /path/to/abi-codegen/dist/cli.js" ./scripts/regenerate-clients.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
abi="$here/../logic/res/abi.json"
codegen="${ABI_CODEGEN:-calimero-abi-codegen}"

# The contract is a component now (calimero:abi, `abiVersion` 1 with camelCase
# methods); abi-codegen reads v1 ABIs only, and the native apps still speak the
# v1 contract through the v1 relay. See ../README.md.
if grep -q '"abiVersion"' "$abi"; then
  echo "regenerate-clients.sh: $abi is a component ABI; the native apps stay on the v1 contract (see mobile/README.md)" >&2
  exit 1
fi

# shellcheck disable=SC2086 # ABI_CODEGEN may be a command with arguments
$codegen -i "$abi" -o "$here/ios/Core/Sources/StreamCore/Generated" \
  --target swift --client-name StreamClient --transport-import MeroKit
# shellcheck disable=SC2086
$codegen -i "$abi" -o "$here/android/app/src/main/kotlin/network/calimero/stream/generated" \
  --target kotlin --package network.calimero.stream.generated --client-name StreamClient \
  --transport-import com.calimero.mero.app.ContextContractCalling
