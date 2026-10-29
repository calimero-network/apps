#!/usr/bin/env bash
# Build the game-only web page (web/: the web app's engine + the native bridge) and copy it into
# both native apps, where it ships as local assets (nothing is fetched at runtime). Commit the result.
#
#   pnpm install            # once, at the repo root
#   ./scripts/build-web.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$here/../../.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

cd "$repo"
pnpm -F mero-kombat exec tsc -p "$here/web/tsconfig.json"
KOMBAT_GAME_OUT="$out" pnpm -F mero-kombat exec vite build -c "$here/web/vite.config.mjs"

for dest in "$here/ios/Resources/Game" "$here/android/app/src/main/assets/game"; do
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "$out/index.html" "$out/game.js" "$dest/"
done
echo "game bundle: $(wc -c < "$out/game.js") bytes → ios/Resources/Game, android/app/src/main/assets/game"
