#!/usr/bin/env bash
# Render coturn/turnserver.runtime.conf from the committed template + .env, then
# you `docker compose up -d`. The runtime file holds secrets and is gitignored;
# the template (coturn/turnserver.conf) stays clean. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "missing .env — copy .env.example to .env and fill it in"; exit 1; }
set -a; . ./.env; set +a

for v in TURN_DOMAIN TURN_SECRET PUBLIC_IP PRIVATE_IP; do
  [ -n "${!v:-}" ] || { echo "missing $v in .env"; exit 1; }
done

sed \
  -e "s|REPLACE_PUBLIC_IP|${PUBLIC_IP}|g" \
  -e "s|REPLACE_PRIVATE_IP|${PRIVATE_IP}|g" \
  -e "s|REPLACE_TURN_SECRET|${TURN_SECRET}|g" \
  -e "s|REPLACE_TURN_DOMAIN|${TURN_DOMAIN}|g" \
  coturn/turnserver.conf > coturn/turnserver.runtime.conf

echo "rendered coturn/turnserver.runtime.conf. now run: docker compose up -d"
