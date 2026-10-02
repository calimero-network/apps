#!/usr/bin/env python3
"""The conformance rig's admin calls, one subcommand each.

Every call the rig makes against a node lives here rather than as curl lines in
the shell scripts, so a refusal prints the status and body instead of a bare
`curl: (22)`. Nothing here is a test: these calls set the rig up, the app's
matrix is what is under test.

  wait <url> [code]                 wait until GET <url> answers <code> (200)
  owner-login <state>               the owner's admin (root) token -> <state>/owner-root.json
  client-key <state>                an app token for the owner, scoped like a MultiContext
                                    login -> <state>/owner-app.json
  install <state> <node-url> <mpk>  install the bundle (dev) -> prints the application id
  identity <state> <node-url>       prints the node's identity JSON
  create-namespace <state> <app>    the owner founds a namespace -> prints its id
  relay-join <state> <ns>           TEE admission policy, relay fleet-join as RelayTee,
                                    relay caps 512, default caps 231
  invite <state> <ns> <out.json>    an invitation naming the relay as admitter
"""
import json
import sys
import time
import urllib.error
import urllib.request

ZERO48 = "0" * 96
# What mero-react's MultiContext mode asks for at login (MeroContext.tsx,
# getPermissionsForMode). The node token is minted with exactly these, so a
# route the app needs and this scope lacks shows up as the 403 an app would get.
MULTI_CONTEXT = [
    "context:create",
    "context:list",
    "context:execute",
    "context:subscribe",
    "application:list",
    "namespace",
    "group",
    "blob",
    "context:alias",
]


def fail(msg):
    print(f"rig.py: {msg}", file=sys.stderr)
    sys.exit(1)


def call(method, url, body=None, token=None, ok=(200, 201, 204)):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except urllib.error.URLError as e:
        fail(f"{method} {url}: {e.reason}")
    if status not in ok:
        fail(f"{method} {url} -> {status}: {raw[:600].decode(errors='replace')}")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw.decode(errors="replace")


def cfg(state):
    return json.load(open(f"{state}/config.json"))


def owner_token(state):
    return json.load(open(f"{state}/owner-root.json"))["access_token"]


def cmd_wait(url, code="200"):
    for _ in range(90):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if str(r.status) == code:
                    return
        except urllib.error.HTTPError as e:
            if str(e.code) == code:
                return
        except Exception:
            pass
        time.sleep(1)
    fail(f"{url} never answered {code}")


def cmd_owner_login(state):
    c = cfg(state)
    pw = open(f"{state}/owner-password").read().strip()
    body = {
        "auth_method": "user_password",
        "public_key": c["ownerUser"],
        "client_name": c["ownerUrl"],
        "timestamp": int(time.time()),
        "provider_data": {"username": c["ownerUser"], "password": pw},
    }
    d = call("POST", f"{c['ownerUrl']}/auth/token", body)["data"]
    json.dump({"access_token": d["access_token"], "refresh_token": d["refresh_token"]}, open(f"{state}/owner-root.json", "w"))


def cmd_client_key(state):
    c = cfg(state)
    body = {"permissions": MULTI_CONTEXT, "target_node_url": c["ownerUrl"]}
    d = call("POST", f"{c['ownerUrl']}/admin/client-key", body, token=owner_token(state))["data"]
    json.dump(
        {"access_token": d["access_token"], "refresh_token": d["refresh_token"], "permissions": MULTI_CONTEXT},
        open(f"{state}/owner-app.json", "w"),
    )


def cmd_install(state, node_url, mpk):
    c = cfg(state)
    token = owner_token(state) if node_url == c["ownerUrl"] else None
    d = call("POST", f"{node_url}/admin-api/install-dev-application", {"path": mpk}, token=token)
    print(d["data"]["applicationId"])


def cmd_identity(state, node_url):
    token = owner_token(state) if node_url == cfg(state)["ownerUrl"] else None
    print(json.dumps(call("GET", f"{node_url}/admin-api/identity", token=token)["data"]))


def cmd_create_namespace(state, app):
    c = cfg(state)
    d = call("POST", f"{c['ownerUrl']}/admin-api/namespaces", {"applicationId": app, "name": "conformance-rig"}, token=owner_token(state))
    print(d["data"]["namespaceId"])


def cmd_relay_join(state, ns):
    """chat-relay.sh, as a function. The relay must be a RelayTee BEFORE any
    invitation exists: an invited relay is a plain Member, is not seated in Open
    subgroups, and fleet-join does not upgrade it (CHAT-ACCOUNT-RUN.md)."""
    c = cfg(state)
    tok = owner_token(state)
    owner, relay = c["ownerUrl"], c["relayUrl"]
    policy = {
        "acceptMock": True,
        "allowedMrtd": [ZERO48],
        "allowedRtmr0": [],
        "allowedRtmr1": [ZERO48],
        "allowedRtmr2": [ZERO48],
        "allowedRtmr3": [ZERO48],
        "allowedTcbStatuses": [],
        "mode": "relay",
    }
    call("PUT", f"{owner}/admin-api/groups/{ns}/settings/tee-admission-policy", policy, token=tok)
    # The policy op has to reach the relay before it asks to be admitted under it.
    joined = None
    for attempt in range(12):
        time.sleep(4)
        joined = call("POST", f"{relay}/admin-api/tee/fleet-join", {"groupId": ns}, ok=range(100, 600))
        json.dump(joined, open(f"{state}/fleet-join-{ns[:8]}-{attempt}.json", "w"))
        if role_of(state, ns, c["relayAccount"]) == "RelayTee":
            break
    else:
        fail(f"relay never became a RelayTee in {ns}: last fleet-join answer {joined}")
    call("PUT", f"{owner}/admin-api/groups/{ns}/members/{c['relayAccount']}/capabilities", {"capabilities": 512}, token=tok)
    call("PUT", f"{owner}/admin-api/groups/{ns}/settings/default-capabilities", {"defaultCapabilities": 231}, token=tok)


def role_of(state, ns, account):
    c = cfg(state)
    d = call("GET", f"{c['ownerUrl']}/admin-api/groups/{ns}/members", token=owner_token(state), ok=range(100, 600))
    # `{"members": [...]}` on this route; `{"data": {"members": [...]}}` on others.
    body = d if isinstance(d, dict) else {}
    body = body.get("data", body) if isinstance(body.get("data"), (dict, list)) else body
    members = body.get("members", []) if isinstance(body, dict) else body
    for m in members or []:
        if str(m.get("identity", "")).lower() == account.lower():
            return m.get("role")
    return None


def cmd_invite(state, ns, out):
    c = cfg(state)
    d = call("POST", f"{c['ownerUrl']}/admin-api/namespaces/{ns}/invite", {"admitters": [c["relayAccount"]]}, token=owner_token(state))
    json.dump({"invitation": d["data"]["invitation"]}, open(out, "w"), separators=(",", ":"))


COMMANDS = {
    "wait": cmd_wait,
    "owner-login": cmd_owner_login,
    "client-key": cmd_client_key,
    "install": cmd_install,
    "identity": cmd_identity,
    "create-namespace": cmd_create_namespace,
    "relay-join": cmd_relay_join,
    "invite": cmd_invite,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        fail(__doc__)
    COMMANDS[sys.argv[1]](*sys.argv[2:])
