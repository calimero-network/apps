#!/usr/bin/env bash
# Build the game page both native apps bundle (../game/assets/game: index.html + game.js) from the
# web app's engine, with the web app's own Vite and three.js. Commit the result: the iOS and
# Android builds copy it as it is, and nothing is fetched at run time.
#
#   ./scripts/build-game.sh            # install the web app's dependencies, build, run the page tests
#   ./scripts/build-game.sh --check    # CI: fail if the committed bundle differs from a fresh build
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$here/../../.." && pwd)"

(cd "$repo" && pnpm install --filter mero-blocks --frozen-lockfile)
node "$here/game/build.mjs"
(cd "$here/game" && "$here/../app/node_modules/.bin/vitest" run --root . --environment jsdom)

if [ "${1:-}" = "--check" ]; then
  if ! git -C "$repo" diff --exit-code --stat -- apps/mero-blocks/mobile/game/assets; then
    echo "The committed game bundle is stale: run apps/mero-blocks/mobile/scripts/build-game.sh and commit it." >&2
    exit 1
  fi
fi
