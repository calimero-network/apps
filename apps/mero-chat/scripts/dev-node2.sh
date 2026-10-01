#!/usr/bin/env bash
# scripts/dev-node2.sh — start the SECOND dev node.
#
# Kept as an entry point (the Makefile and docs reference it), but the
# implementation lives in dev-node.sh: the two scripts were ~250 lines of
# near-duplicate that had to be fixed twice and drifted when they weren't.
#
# Equivalent to: ./scripts/dev-node.sh --secondary
# All flags (--stop, --clean, --help) pass straight through.

set -euo pipefail

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-node.sh" --secondary "$@"
