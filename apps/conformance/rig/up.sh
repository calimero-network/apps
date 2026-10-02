#!/bin/sh
# Bring up the conformance rig: an owner node, a mock-TEE relay with delegated
# access fleet-joined as a RelayTee into a namespace the owner founds, an
# ingress (mero-auth + Traefik) in front of the relay, a mock cloud, and two
# account credentials minted offline. Writes .state/run/rig.json for the runner.
#
# Every process it starts has its pid in .state/run/pids/, and down.sh kills
# exactly those. Nothing else on this machine is touched: the ports are this
# rig's own (configurable below), the nodes find each other by address rather
# than by mDNS, and they never dial the public boot node.
#
# Reuses poc/local-relay-rig (up-chat.sh, chat-relay.sh, ingress.sh,
# mock-cloud.py, mint-chat.mts) without merobox: two nodes are two `merod`
# processes, and owning their pids is what lets down.sh be exact.
#
# Inputs (env):
#   MEROD_BIN       merod built with --features merod/mock-attestation
#   MERO_AUTH_BIN   mero-auth from the same core
#   TRAEFIK_BIN     traefik (default: on PATH)
#   CORE            the core checkout (for apps/scaffolding-e2e/relay-ingress)
#   CONFORMANCE_MPK the scaffolding-e2e bundle (default .state/scaffolding-e2e.mpk)
#   CONFORMANCE_MPK_V2 the same app at --app-version 0.0.1, what the node run
#                   upgrades to (default .state/scaffolding-e2e-0.0.1.mpk)
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
APP_DIR=$(cd "${HERE}/../app" && pwd)
WS=$(cd "${HERE}/../../../.." && pwd)
STATE="${HERE}/.state"
RUN="${STATE}/run"

CORE="${CORE:-${WS}/core-routes}"
MEROD_BIN="${MEROD_BIN:-${CORE}/target/debug/merod}"
MERO_AUTH_BIN="${MERO_AUTH_BIN:-${CORE}/target/debug/mero-auth}"
TRAEFIK_BIN="${TRAEFIK_BIN:-traefik}"
MPK="${CONFORMANCE_MPK:-${STATE}/scaffolding-e2e.mpk}"
MPK_V2="${CONFORMANCE_MPK_V2:-${STATE}/scaffolding-e2e-0.0.1.mpk}"
INGRESS_TEMPLATES="${CORE}/apps/scaffolding-e2e/relay-ingress"

OWNER_RPC="${CONF_OWNER_RPC:-4910}"
RELAY_RPC="${CONF_RELAY_RPC:-4911}"
OWNER_SWARM="${CONF_OWNER_SWARM:-4930}"
RELAY_SWARM="${CONF_RELAY_SWARM:-4931}"
INGRESS_PORT="${CONF_INGRESS_PORT:-4980}"
AUTH_PORT="${CONF_AUTH_PORT:-4981}"
CLOUD_PORT="${CONF_CLOUD_PORT:-4999}"

OWNER_URL="http://127.0.0.1:${OWNER_RPC}"
RELAY_URL="http://127.0.0.1:${RELAY_RPC}"
INGRESS_URL="http://127.0.0.1:${INGRESS_PORT}"
AUTH_URL="http://127.0.0.1:${AUTH_PORT}"
CLOUD_URL="http://127.0.0.1:${CLOUD_PORT}"
RIG="python3 ${HERE}/rig.py"

fail() { echo "up.sh: $*" >&2; exit 1; }
step() { echo "--- $*"; }

[ -x "${MEROD_BIN}" ] || fail "no merod at ${MEROD_BIN} (set MEROD_BIN; build it with --features merod/mock-attestation)"
"${MEROD_BIN}" run --help 2>/dev/null | grep -q -- '--mock-tee' || fail "${MEROD_BIN} has no --mock-tee: build it with --features merod/mock-attestation"
[ -x "${MERO_AUTH_BIN}" ] || fail "no mero-auth at ${MERO_AUTH_BIN} (set MERO_AUTH_BIN)"
command -v "${TRAEFIK_BIN}" >/dev/null 2>&1 || fail "no traefik (set TRAEFIK_BIN)"
[ -f "${MPK}" ] || fail "no bundle at ${MPK} (set CONFORMANCE_MPK; build it with: cd <core>/apps/scaffolding-e2e && cargo mero bundle --dev --no-icon -o ${MPK})"
[ -f "${MPK_V2}" ] || fail "no 0.0.1 bundle at ${MPK_V2} (set CONFORMANCE_MPK_V2; build it with: cd <core>/apps/scaffolding-e2e && cargo mero bundle --dev --no-icon --app-version 0.0.1 -o ${MPK_V2})"
[ -f "${INGRESS_TEMPLATES}/routing.yml" ] || fail "no relay-ingress templates under ${INGRESS_TEMPLATES} (set CORE)"
[ -d "${APP_DIR}/node_modules/@calimero-network/mero-js" ] || fail "run pnpm install first: the account minting uses the app's mero-js"

# A previous run of THIS rig is stopped first (by its recorded pids only).
"${HERE}/down.sh" >/dev/null 2>&1 || true

for p in "${OWNER_RPC}" "${RELAY_RPC}" "${OWNER_SWARM}" "${RELAY_SWARM}" "${INGRESS_PORT}" "${AUTH_PORT}" "${CLOUD_PORT}"; do
    if lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1; then
        fail "port ${p} is taken by a process this rig did not start; pick other ports with CONF_*"
    fi
done

rm -rf "${RUN}"
mkdir -p "${RUN}/pids" "${RUN}/logs" "${RUN}/ingress"

start() { # <name> <log> <cmd...>
    _name="$1"; _log="$2"; shift 2
    nohup "$@" > "${_log}" 2>&1 &
    echo $! > "${RUN}/pids/${_name}.pid"
}

step "nodes: init"
python3 -c "import secrets; print(secrets.token_urlsafe(24))" > "${RUN}/owner-password"
"${MEROD_BIN}" --home "${RUN}/nodes" --node conf-owner init \
    --server-host 127.0.0.1 --server-port "${OWNER_RPC}" \
    --swarm-host 127.0.0.1 --swarm-port "${OWNER_SWARM}" \
    --auth-mode embedded --admin-user conformance --admin-password-file "${RUN}/owner-password" \
    > "${RUN}/logs/owner-init.log" 2>&1 || fail "owner init failed: see ${RUN}/logs/owner-init.log"
python3 "${HERE}/configure-node.py" "${RUN}/nodes/conf-owner/config.toml"
OWNER_PEER=$(sed -n 's/^peer_id = "\(.*\)"$/\1/p' "${RUN}/nodes/conf-owner/config.toml")
[ -n "${OWNER_PEER}" ] || fail "no peer id in the owner's config"

"${MEROD_BIN}" --home "${RUN}/nodes" --node conf-relay init \
    --server-host 127.0.0.1 --server-port "${RELAY_RPC}" \
    --swarm-host 127.0.0.1 --swarm-port "${RELAY_SWARM}" \
    --delegated-access --proxy-identity \
    > "${RUN}/logs/relay-init.log" 2>&1 || fail "relay init failed: see ${RUN}/logs/relay-init.log"
python3 "${HERE}/configure-node.py" "${RUN}/nodes/conf-relay/config.toml" "/ip4/127.0.0.1/tcp/${OWNER_SWARM}/p2p/${OWNER_PEER}"

step "nodes: run (owner ${OWNER_URL}, relay ${RELAY_URL} with --mock-tee)"
start owner "${RUN}/logs/owner.log" "${MEROD_BIN}" --home "${RUN}/nodes" --node conf-owner run
start relay "${RUN}/logs/relay.log" "${MEROD_BIN}" --home "${RUN}/nodes" --node conf-relay run --mock-tee
${RIG} wait "${OWNER_URL}/admin-api/health"
${RIG} wait "${RELAY_URL}/admin-api/health"

printf '{"ownerUrl":"%s","relayUrl":"%s","ownerUser":"conformance"}\n' "${OWNER_URL}" "${RELAY_URL}" > "${RUN}/config.json"

step "owner: admin login and an app token (MultiContext scope)"
${RIG} owner-login "${RUN}"
${RIG} client-key "${RUN}"

step "both: install scaffolding-e2e"
OWNER_APP=$(${RIG} install "${RUN}" "${OWNER_URL}" "${MPK}")
RELAY_APP=$(${RIG} install "${RUN}" "${RELAY_URL}" "${MPK}")
[ "${OWNER_APP}" = "${RELAY_APP}" ] || fail "the bundle installed as ${OWNER_APP} on the owner and ${RELAY_APP} on the relay"
APP_ID="${OWNER_APP}"

${RIG} identity "${RUN}" "${OWNER_URL}" > "${RUN}/owner-identity.json"
${RIG} identity "${RUN}" "${RELAY_URL}" > "${RUN}/relay-identity.json"
RELAY_KEY=$(python3 -c "import json;print(json.load(open('${RUN}/relay-identity.json'))['publicKey'])")
RELAY_ACCOUNT=$(python3 -c "import json;print(json.load(open('${RUN}/relay-identity.json'))['accountId'])")
OWNER_ACCOUNT=$(python3 -c "import json;print(json.load(open('${RUN}/owner-identity.json'))['accountId'])")
printf '{"ownerUrl":"%s","relayUrl":"%s","ownerUser":"conformance","relayAccount":"%s"}\n' "${OWNER_URL}" "${RELAY_URL}" "${RELAY_ACCOUNT}" > "${RUN}/config.json"

step "owner founds the rig namespace; the relay fleet-joins it as a RelayTee"
NS=$(${RIG} create-namespace "${RUN}" "${APP_ID}")
${RIG} relay-join "${RUN}" "${NS}"
${RIG} invite "${RUN}" "${NS}" "${RUN}/invite-a.json"
${RIG} invite "${RUN}" "${NS}" "${RUN}/invite-b.json"

step "accounts: mint A and B offline"
(cd "${APP_DIR}" && node scripts/mint-account.mjs) > "${RUN}/account-a.json"
(cd "${APP_DIR}" && node scripts/mint-account.mjs) > "${RUN}/account-b.json"

step "ingress: mero-auth ${AUTH_URL} + traefik ${INGRESS_URL} -> relay"
python3 "${HERE}/patch-ingress.py" "${INGRESS_TEMPLATES}" "${RUN}/ingress" "${RELAY_URL}" "${AUTH_URL}" "${INGRESS_PORT}" "${RELAY_KEY}"
start mero-auth "${RUN}/logs/mero-auth.log" "${MERO_AUTH_BIN}" --config "${RUN}/ingress/auth.toml"
${RIG} wait "${AUTH_URL}/auth/providers"
start traefik "${RUN}/logs/traefik.log" "${TRAEFIK_BIN}" --configFile="${RUN}/ingress/traefik.yml"
${RIG} wait "${INGRESS_URL}/admin-api/health"

step "mock cloud ${CLOUD_URL}"
start mock-cloud "${RUN}/logs/mock-cloud.log" python3 "${HERE}/mock-cloud.py" "${CLOUD_PORT}" "${INGRESS_URL}" "${RELAY_ACCOUNT}"
${RIG} wait "${CLOUD_URL}/api/cloud/accounts/00/relays"

python3 - "${RUN}" <<EOF
import json, sys
run = sys.argv[1]
j = lambda n: json.load(open(f"{run}/{n}"))
json.dump({
    "ownerUrl": "${OWNER_URL}",
    "relayUrl": "${RELAY_URL}",
    "ingressUrl": "${INGRESS_URL}",
    "cloudUrl": "${CLOUD_URL}",
    "applicationId": "${APP_ID}",
    "packageName": "com.calimero.scaffolding-e2e",
    "packageVersion": "0.0.0",
    "mpkV2": "${MPK_V2}",
    "namespaceId": "${NS}",
    "ownerAccount": "${OWNER_ACCOUNT}",
    "relayAccount": "${RELAY_ACCOUNT}",
    "relayKey": "${RELAY_KEY}",
    "ownerToken": j("owner-app.json"),
    "accounts": {"a": j("account-a.json"), "b": j("account-b.json")},
    "invitations": {"a": j("invite-a.json")["invitation"], "b": j("invite-b.json")["invitation"]},
}, open(f"{run}/rig.json", "w"), indent=2)
EOF
echo "=== conformance rig is up: owner ${OWNER_URL}, relay ingress ${INGRESS_URL}, cloud ${CLOUD_URL}, app ${APP_ID}, namespace ${NS} ==="
echo "=== state: ${RUN}/rig.json; stop with ${HERE}/down.sh ==="
