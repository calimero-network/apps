#!/usr/bin/env python3
"""Render core's relay-ingress templates for the conformance rig.

Copied in intent from poc/local-relay-rig/ingress.sh, which does the same with
inline heredocs. Three changes to core's `apps/scaffolding-e2e/relay-ingress`:

  * the relay's public attestation route (mero-tee's `node-api-tee` router): a
    client learns the relay's node key from a quote before it can log in, so it
    cannot sit behind `auth-node`;
  * CORS on the entrypoint, before any router, so a browser's preflight is
    answered before forwardAuth would refuse it (mero-tee's relay routing allows
    any origin; so does this);
  * the public rate limit raised: the matrix makes far more calls a second than
    a person does, and every rig tab shares one IP. A 429 here would be the rig
    failing, not the code under test.

Usage: patch-ingress.py <template dir> <work dir> <relay url> <auth url> <ingress port> <relay node key>
"""
import sys

src, work, relay_url, auth_url, port, node_key = sys.argv[1:7]

routing = open(f"{src}/routing.yml").read()
routing = routing.replace("@RELAY_URL@", relay_url).replace("@AUTH_URL@", auth_url)
router = """    node-api-tee:
      rule: "(Path(`/admin-api/tee/info`) && (Method(`GET`) || Method(`HEAD`) || Method(`OPTIONS`))) || (Path(`/admin-api/tee/attest`) && (Method(`POST`) || Method(`OPTIONS`)))"
      entryPoints: [web]
      service: node-core
      middlewares: [rate-limit-public]
      priority: 99

"""
anchor = "  services:"
assert anchor in routing, "no services table in routing.yml"
routing = routing.replace(anchor, router + anchor, 1)
for old, new in (("average: 20", "average: 400"), ("burst: 40", "burst: 800"), ("average: 100", "average: 400"), ("burst: 200", "burst: 800")):
    assert old in routing, f"rate limit {old!r} not in routing.yml"
    routing = routing.replace(old, new)
routing += """
    cors:
      headers:
        accessControlAllowMethods: GET,OPTIONS,PUT,POST,DELETE
        accessControlAllowHeaders: "*"
        accessControlAllowOriginList: "*"
        accessControlMaxAge: 100
        addVaryHeader: true
        accessControlExposeHeaders: X-Auth-Error
"""
open(f"{work}/routing.yml", "w").write(routing)

traefik = open(f"{src}/traefik.yml").read()
traefik = (
    traefik.replace("@INGRESS_PORT@", port)
    .replace("@ROUTING_FILE@", f"{work}/routing.yml")
    .replace("@LOG_FILE@", f"{work}/traefik.log")
)
needle = "        - strip-proxy-identity@file"
assert needle in traefik, "no strip-proxy-identity middleware on the entrypoint"
traefik = traefik.replace(needle, "        - cors@file\n" + needle, 1)
traefik += """
accessLog:
  filePath: "%s/access.log"
""" % work
open(f"{work}/traefik.yml", "w").write(traefik)

auth = f"""listen_addr = "{auth_url.removeprefix('http://')}"

[jwt]
issuer = "conformance-rig"

[storage]
type = "rocksdb"
path = "{work}/auth_db"

[providers]
account_proof = true

[account_proof]
node_key = "{node_key}"
allowed_audiences = []
"""
open(f"{work}/auth.toml", "w").write(auth)
