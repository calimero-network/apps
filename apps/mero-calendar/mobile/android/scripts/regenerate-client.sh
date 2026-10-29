#!/usr/bin/env bash
# Regenerate the typed contract client (app/src/main/kotlin/network/calimero/calendar/generated)
# from the contract's ABI, after logic/res/abi.json changes. Needs a built @calimero/abi-codegen:
#
#   ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${ABI_CODEGEN:?set ABI_CODEGEN to abi-codegen's dist/cli.js}"
node "$cli" \
  -i "$here/../../logic/res/abi.json" \
  -o "$here/app/src/main/kotlin/network/calimero/calendar/generated" \
  --target kotlin \
  --package network.calimero.calendar.generated \
  --client-name CalendarClient
