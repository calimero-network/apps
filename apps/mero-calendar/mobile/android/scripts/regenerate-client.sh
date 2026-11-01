#!/usr/bin/env bash
# Regenerate the typed contract client (app/src/main/kotlin/network/calimero/calendar/generated)
# from the contract's ABI, after logic/res/abi.json changes. Needs a built @calimero/abi-codegen:
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${ABI_CODEGEN:?set ABI_CODEGEN to abi-codegen's dist/cli.js}"
abi="$here/../../logic/res/abi.json"

# The contract is a component now (calimero:abi, `abiVersion` 1 with camelCase
# methods); abi-codegen reads v1 ABIs only, and the native app still speaks the
# v1 contract through the v1 relay. See ../../README.md.
if grep -q '"abiVersion"' "$abi"; then
  echo "regenerate-client.sh: $abi is a component ABI; the native apps stay on the v1 contract (see mobile/README.md)" >&2
  exit 1
fi

node "$cli" \
  -i "$abi" \
  -o "$here/app/src/main/kotlin/network/calimero/calendar/generated" \
  --target kotlin \
  --package network.calimero.calendar.generated \
  --client-name CalendarClient
