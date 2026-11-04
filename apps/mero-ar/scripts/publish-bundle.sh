#!/usr/bin/env bash
# Publish a .mpk to the App Registry. Vercel caps a request body at 4.5 MB, so
# the archive goes straight to storage and the push request carries only its name.
set -euo pipefail

mpk=${1:?usage: publish-bundle.sh <path.mpk>}
: "${CALIMERO_API_KEY:?CALIMERO_API_KEY is not set}"
: "${CALIMERO_REGISTRY_URL:?CALIMERO_REGISTRY_URL is not set}"
api="${CALIMERO_REGISTRY_URL%/}/api/v2/bundles"
auth=(-H "Authorization: Bearer $CALIMERO_API_KEY")

grant=$(curl --fail-with-body -sS -X POST "${auth[@]}" "$api/upload-url")
url=$(jq -er .url <<<"$grant")
object=$(jq -er .object <<<"$grant")

mapfile -t headers < <(jq -r '.headers | to_entries[] | "\(.key): \(.value)"' <<<"$grant")
put=()
for h in "${headers[@]}"; do put+=(-H "$h"); done

echo "Uploading $mpk as $object"
curl --fail-with-body -sS -X PUT "${put[@]}" --upload-file "$mpk" "$url"

tar -xzOf "$mpk" manifest.json |
  jq -c --arg object "$object" '. + {_upload: {object: $object}}' |
  curl --fail-with-body -sS -X POST "${auth[@]}" -H "Content-Type: application/json" \
    --data-binary @- "$api/push"
echo
echo "Published $object"
