#!/usr/bin/env python3
"""A stand-in for the cloud's anonymous routing reads, for the local rig only.

The prod cloud has never heard of a namespace on this machine, so a fresh
account cannot learn which relay admits it. This answers the two reads mero-js
makes for that (namespace admitters, account relays) with the local relay.
It verifies no routing proof: it is a rig, not a cloud.

Usage: mock-cloud.py <port> <relay-url> <relay-account>
"""
import json
import re
import secrets
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, RELAY_URL, RELAY_ACCOUNT = int(sys.argv[1]), sys.argv[2], sys.argv[3]


def challenge(key, value):
    return {key: value, "nonce": secrets.token_hex(16), "expires_at_ms": int(time.time() * 1000) + 300_000}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body=None):
        self.send_response(status)
        self.send_header("access-control-allow-origin", self.headers.get("origin") or "*")
        self.send_header("access-control-allow-headers", "*")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.send_header("content-type", "application/json")
        self.end_headers()
        if body is not None:
            self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = self.path.split("?")[0]
        if m := re.fullmatch(r"/api/cloud/namespaces/([0-9a-f]+)/challenge", path):
            return self._send(200, challenge("namespace_id", m[1]))
        if m := re.fullmatch(r"/api/cloud/namespaces/([0-9a-f]+)/admitters", path):
            return self._send(200, {
                "namespace_id": m[1],
                "admitters": [{
                    "peer_id": "rig-relay", "account": RELAY_ACCOUNT, "relay_url": RELAY_URL,
                    "admit_url": None, "status": "active", "fresh": True, "can_admit": True,
                    "authorship_ready": True, "tee_role": "RelayTee", "can_execute": True,
                }],
                "servable": True, "writable": True,
            })
        if m := re.fullmatch(r"/api/cloud/accounts/([0-9a-f]+)/challenge", path):
            return self._send(200, challenge("account_id", m[1]))
        if m := re.fullmatch(r"/api/cloud/accounts/([0-9a-f]+)/relays", path):
            # Every account here is served by the one local relay. The real cloud
            # answers from assignments; a second device of a member needs this to
            # find its relay at all.
            return self._send(200, {"account_id": m[1], "relays": [
                {"peer_id": "rig-relay", "relay_url": RELAY_URL, "fresh": True}]})
        self._send(404, {"error": f"mock cloud has no {path}"})

    def log_message(self, fmt, *args):
        sys.stderr.write("mock-cloud: " + fmt % args + "\n")


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
