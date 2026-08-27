#!/usr/bin/env bash
# Rasterizes res/icon.svg -> res/icon-512.png, the icon logic/Cargo.toml embeds
# into the bundle manifest.
#
# Both outputs are committed, so this only needs running when res/icon.svg
# changes — CI never calls it. Kept as a script rather than a README paragraph so
# the PNG is reproducible instead of being a binary nobody can regenerate.
set -euo pipefail

cd "$(dirname "$0")"

SRC=res/icon.svg
OUT=res/icon-512.png

if command -v rsvg-convert >/dev/null 2>&1; then
    # Preferred: exact size, no thumbnail cache in the way. `brew install librsvg`
    # or `apt-get install librsvg2-bin`.
    rsvg-convert --width 512 --height 512 "$SRC" -o "$OUT"
elif command -v qlmanage >/dev/null 2>&1; then
    # macOS fallback, no install needed. It insists on naming the output after
    # the input and writing into a directory, so render to a temp dir and move.
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    qlmanage -t -s 512 -o "$tmp" "$SRC" >/dev/null 2>&1
    mv "$tmp/$(basename "$SRC").png" "$OUT"
else
    echo "ERROR: need rsvg-convert (brew/apt install librsvg) or macOS qlmanage" >&2
    exit 1
fi

echo "Wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
