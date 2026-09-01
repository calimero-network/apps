#!/bin/bash
# Open the locally running kv-store with a session already seeded.
#   ./open-app.sh          -> the context picker (namespaces card)
#   ./open-app.sh panel    -> straight into the KV panel
set -euo pipefail
STATE="$(dirname "$0")/app/.playwright-data/state.json"
[ -f "$STATE" ] || { echo "no local node — start it with: npx tsx app/e2e/run-local.ts"; exit 1; }
read -r AT RT NU AI CI <<<"$(python3 -c "
import json,sys,urllib.parse as u
s=json.load(open('$STATE'))
print(s['accessToken'],s['refreshToken'],u.quote(s['nodeUrl'],safe=''),s['applicationId'],s['contextId'])
")"
Q="access_token=$AT&refresh_token=$RT&node_url=$NU&application_id=$AI"
[ "${1:-}" = "panel" ] && Q="$Q&context_id=$CI"
open "http://localhost:5173/#$Q"
