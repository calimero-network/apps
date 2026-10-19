#!/usr/bin/env python3
"""Seed a Mero Tag demo space on a local node, then keep friends moving.

    python3 scripts/demo-seed.py setup --node http://localhost:4201
    python3 scripts/demo-seed.py move  --node http://localhost:4201 --context <id> --seconds 120

`setup` installs com.calimero.mero-tag from the app registry (if the node does
not have it), creates a "Weekend crew" space, and adds three friends with
trackers near San Francisco's waterfront. It prints the context id.
`move` walks them along short routes, sending a position every 2 s and marking
them online, so the app's map shows live movement — what the landing page's
recordings are made from. Only for demos: the friends are fake members written
straight into the contract by the node's admin.
"""
import argparse
import json
import math
import sys
import time
import urllib.request

PACKAGE = "com.calimero.mero-tag"
REGISTRY = "https://apps.calimero.network"

FRIENDS = [
    # name, member id, route: list of (lat, lng)
    ("Ana", "a1" * 32, [(37.8080, -122.4177), (37.8065, -122.4105), (37.8030, -122.4040), (37.7996, -122.3980)]),
    ("Luka", "b2" * 32, [(37.7879, -122.4075), (37.7890, -122.4010), (37.7920, -122.3960), (37.7950, -122.3940)]),
    ("Mia", "c3" * 32, [(37.8024, -122.4058), (37.8026, -122.4056), (37.8023, -122.4059), (37.8025, -122.4057)]),
]


class Node:
    def __init__(self, url, user, password):
        self.url = url.rstrip("/")
        body = {
            "auth_method": "user_password", "public_key": user, "client_name": "mero-tag-demo",
            "permissions": ["admin"], "timestamp": int(time.time()),
            "provider_data": {"username": user, "password": password},
        }
        self.token = self.request("POST", "/auth/token", body, auth=False)["data"]["access_token"]

    def request(self, method, path, body=None, auth=True):
        headers = {"content-type": "application/json"}
        if auth:
            headers["authorization"] = "Bearer " + self.token
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)

    def call(self, context, method, args):
        out = self.request("POST", "/jsonrpc", {
            "jsonrpc": "2.0", "id": 1, "method": "execute",
            "params": {"contextId": context, "method": method, "argsJson": args},
        })
        if "error" in out:
            raise RuntimeError(f"{method}: {out['error']}")
        return (out.get("result") or {}).get("output")


def now_ms():
    return int(time.time() * 1000)


def setup(node, name):
    apps = node.request("GET", "/admin-api/applications")["data"]["apps"]
    app = next((a for a in apps if a.get("package") == PACKAGE), None)
    if app:
        app_id = app["id"]
    else:
        with urllib.request.urlopen(f"{REGISTRY}/api/v2/bundles?package={PACKAGE}") as resp:
            version = json.load(resp)[0]["appVersion"]
        app_id = node.request("POST", "/admin-api/install-application",
                              {"package": PACKAGE, "version": version})["data"]["applicationId"]
    ns = node.request("POST", "/admin-api/namespaces", {"applicationId": app_id, "name": name})["data"]["namespaceId"]
    params = list(json.dumps({"name": name}).encode())
    ctx = node.request("POST", "/admin-api/contexts", {
        "applicationId": app_id, "groupId": ns, "initializationParams": params, "name": name,
    })["data"]["contextId"]
    for friend, member, route in FRIENDS:
        node.call(ctx, "join", {"member_id": member, "username": friend, "timestamp": now_ms()})
        tracker = f"demo-{friend.lower()}"
        node.call(ctx, "create_tracker", {"id": tracker, "name": friend, "owner_id": member, "created_at": now_ms()})
        lat, lng = route[0]
        node.call(ctx, "update_location", location(tracker, lat, lng, 0, 0, 80))
    return ctx


def location(tracker, lat, lng, speed, heading, battery):
    return {"tracker_id": tracker, "latitude": lat, "longitude": lng, "altitude": 10.0, "speed": speed,
            "heading": heading, "battery": battery, "timestamp": now_ms()}


def share_with(node, ctx, member):
    for friend, _, _ in FRIENDS:
        node.call(ctx, "share_tracker", {"tracker_id": f"demo-{friend.lower()}", "user_id": member,
                                         "updated_at": now_ms()})


def move(node, ctx, seconds):
    start = time.time()
    while time.time() - start < seconds:
        t = (time.time() - start) / max(seconds, 1)
        for i, (friend, member, route) in enumerate(FRIENDS):
            leg = min(int(t * (len(route) - 1)), len(route) - 2)
            frac = t * (len(route) - 1) - leg
            (a_lat, a_lng), (b_lat, b_lng) = route[leg], route[leg + 1]
            lat, lng = a_lat + (b_lat - a_lat) * frac, a_lng + (b_lng - a_lng) * frac
            heading = math.degrees(math.atan2(b_lng - a_lng, b_lat - a_lat)) % 360
            node.call(ctx, "update_location", location(f"demo-{friend.lower()}", lat, lng, 1.4, heading, 80 - i * 17))
            node.call(ctx, "update_presence", {"user_id": member, "online": True, "last_seen": now_ms()})
        time.sleep(2)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["setup", "share", "move"])
    p.add_argument("--node", default="http://localhost:4201")
    p.add_argument("--user", default="dev")
    p.add_argument("--password", default="dev-password")
    p.add_argument("--name", default="Weekend crew")
    p.add_argument("--context")
    p.add_argument("--member", help="share: the member the friends' trackers are shared with")
    p.add_argument("--seconds", type=int, default=90)
    a = p.parse_args()
    node = Node(a.node, a.user, a.password)
    if a.action == "setup":
        print(setup(node, a.name))
    elif a.action == "share":
        share_with(node, a.context, a.member)
    else:
        move(node, a.context, a.seconds)


if __name__ == "__main__":
    sys.exit(main())
