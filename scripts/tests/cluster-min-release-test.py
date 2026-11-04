#!/usr/bin/env python3
"""cluster-min-release.py takes the lowest release the cluster's answering nodes run.

Runs the script against a local stub of the node directory and of each node's
/attestation route, from fixture responses.
"""

import http.server
import json
import pathlib
import re
import subprocess
import sys
import threading

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "cluster-min-release.py"

# path prefix -> (status, body) of that node's /attestation
NODES = {}
# cluster -> (status, body) of the directory
CLUSTERS = {}
SEEN = []


class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        SEEN.append(self.path)
        m = re.match(r"^/directory/([^/?]+)$", self.path)
        if m:
            return self.reply(*CLUSTERS.get(m.group(1), (404, {"error": "unknown cluster"})))
        m = re.match(r"^/(n\d+)/attestation\?nonce=([0-9a-f]{64})$", self.path)
        if m and m.group(1) in NODES:
            return self.reply(*NODES[m.group(1)])
        return self.reply(404, {})


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"


def node(name, weight=1, **extra):
    return {"id": name, "url": f"{base}/{name}/", "zone": "eu", "weight": weight, **extra}


def attests(version):
    return (200, {"transportKey": "00" * 32, "quote": "", "release": {"version": version}})


def run(cluster):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--cluster", cluster, "--directory", f"{base}/directory/", "--timeout", "2"],
        capture_output=True,
        text=True,
    )


# A half-rolled-out cluster: the lowest release wins, in SemVer order (2.3.99 < 2.3.136),
# whatever the prefix the node writes.
NODES.update(
    n1=attests("2.3.136"),
    n2=attests("mero-tee-v2.3.99"),
    n3=attests("v2.3.140"),
    n4=(503, {"error": "starting"}),  # unhealthy: skipped
    n5=(200, {"release": {"version": "latest"}}),  # names no release: skipped
    n6=(200, b"not json"),  # skipped
    n7=attests("2.3.99-rc.1"),  # a pre-release sorts before its release
    n8=attests("2.3.10"),
)
CLUSTERS["rolling"] = (
    200,
    {"nodes": [node("n1"), node("n2", 3), node("n3"), node("n4"), node("n5"), node("n6")], "refreshAfterSeconds": 60},
)
r = run("rolling")
assert r.returncode == 0, r
assert r.stdout == "2.3.99\n", r
assert "skipped" in r.stderr, r
assert any(p.startswith("/n1/attestation?nonce=") for p in SEEN), SEEN

CLUSTERS["prerelease"] = (200, {"nodes": [node("n1"), node("n7")]})
r = run("prerelease")
assert r.stdout == "2.3.99-rc.1\n", r

# Numeric, not lexical: 2.3.10 < 2.3.99.
CLUSTERS["numeric"] = (200, {"nodes": [node("n2"), node("n8")]})
r = run("numeric")
assert r.stdout == "2.3.10\n", r

# Entries mero-js would not use are not asked: no weight, a zero weight, not a URL.
SEEN.clear()
CLUSTERS["filtered"] = (
    200,
    {
        "nodes": [
            node("n1"),
            {"url": f"{base}/n2", "zone": "eu"},
            {"url": f"{base}/n8", "weight": 0},
            {"url": "ftp://x", "weight": 1},
            "junk",
        ]
    },
)
r = run("filtered")
assert r.stdout == "2.3.136\n", r
assert not any(p.startswith(("/n2/", "/n8/")) for p in SEEN), SEEN

# No version: every node down, an empty or unknown cluster. Exit 1, a reason, nothing on stdout.
CLUSTERS["down"] = (200, {"nodes": [node("n4"), node("n5")]})
CLUSTERS["empty"] = (200, {"nodes": []})
for cluster, reason in (("down", "names a mero-tee release"), ("empty", "no usable node"), ("nope", "could not be read")):
    r = run(cluster)
    assert r.returncode == 1 and r.stdout == "", (cluster, r)
    assert reason in r.stderr, (cluster, r.stderr)

server.shutdown()
print("ok")
