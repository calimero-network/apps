#!/usr/bin/env bash
# Regenerate apps/*/logic/workflows/cloud-v2/ from the v1 workflows beside them,
# with merobox's converter (`merobox cloud port`, merobox branch release-v2).
set -euo pipefail
cd "$(dirname "$0")/.."
map=$(mktemp)
python3 scripts/cloud-v2-wasm-map.py > "$map"
port=3000
for dir in apps/*/logic/workflows; do
  mapfile -t files < <(find "$dir" -maxdepth 2 -name '*.yml' -not -path '*/cloud-v2/*' | sort)
  [ "${#files[@]}" -eq 0 ] && continue
  merobox cloud port "${files[@]}" --wasm-map "$map" --out-dir "$dir/cloud-v2" --base-port "$port" >/dev/null
  port=$((port + 10 * ${#files[@]}))
done
rm -f "$map"
echo "ported into apps/*/logic/workflows/cloud-v2/"
