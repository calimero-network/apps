#!/usr/bin/env bash
# Build the web game (../app) and copy it into game/www, the bundle both native apps ship as
# local assets (iOS: a folder resource; Android: an assets source dir). Nothing is loaded from the
# network at runtime: the apps open game/www/index.html?host=native from the package.
# Commit the result after a change to the web app.
#
#   ./scripts/build-game.sh            (needs pnpm and the workspace installed: pnpm install)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$here/../app"
out="$here/game/www"

(cd "$app" && pnpm build)
rm -rf "$out"
mkdir -p "$out"
cp -R "$app/dist/." "$out/"
echo "game bundle: $(du -sh "$out" | cut -f1) in $out"
