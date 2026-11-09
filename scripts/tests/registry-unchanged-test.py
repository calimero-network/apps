#!/usr/bin/env python3
"""registry-unchanged.py skips only a bundle a node could not tell apart from
the registry's latest.

Run against a stub registry that answers the way app-registry does: the
`?package=X` listing returns the latest version with `metadata.guide` dropped
(`sanitizeBundles`), `?package=X&version=V` the whole manifest
(`sanitizeBundle`), both with the response-only fields the sanitizer adds and
the server-stamped `_` keys and `metadata.author` that push.js writes.

UNCHANGED_CMD replaces the command under test (it gets MANIFEST PACKAGE
[VERSION] and CALIMERO_REGISTRY_URL, and must print same=true|false).
"""

import copy
import http.server
import json
import os
import pathlib
import shlex
import subprocess
import sys
import tempfile
import threading
import typing
import urllib.parse

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "registry-unchanged.py"
CMD = shlex.split(os.environ.get("UNCHANGED_CMD", "")) or [sys.executable, str(SCRIPT)]
PACKAGE = "com.calimero.example"

# What `mero-component inspect` prints for a built bundle.
BUILT = {
    "version": "1.0",
    "package": PACKAGE,
    "appVersion": "0.4.8",
    "signerId": "did:key:z6MkExample",
    "minRuntimeVersion": "1.0.0-rc.11",
    "metadata": {
        "name": "Example",
        "description": "An example app",
        "author": "Calimero",
        "icon": "data:image/png;base64,AAAA",
        "tags": ["demo"],
        "license": "MIT",
        "category": "productivity",
    },
    "handlers": {"slug": PACKAGE},
    "buildInfo": {"sdkSource": "https://github.com/calimero-network/core", "sdkVersion": "1.0.0-rc.11"},
    "wasm": {"path": "app.wasm", "hash": "aa11", "size": 1234},
    "frontend": {
        "entry": "index.html",
        "files": [
            {"path": "index.html", "hash": "f1", "size": 10},
            {"path": "assets/app.js", "hash": "f2", "size": 20},
        ],
    },
    "links": {"frontend": "https://example.calimero.network", "github": "https://github.com/calimero-network/apps"},
    "frontendAliases": ["https://old-example.vercel.app"],
    "outbound": ["https://api.example.com/v1/"],
    "upgrades": "publisher",
    "signature": {
        "algorithm": "ed25519",
        "publicKey": "pk",
        "signature": "sig-built",
        "signedAt": "2026-11-09T10:00:00Z",
    },
}


# The same app with a guide (hyperfeed, mero-blocks, mero-design, mero-docs,
# mero-issue-tracker): the listing never carries it.
GUIDED = copy.deepcopy(BUILT)
GUIDED["metadata"]["guide"] = "# Example\n\nHow an agent uses it."


def stored(built, version="0.4.7", author=None):
    """What the registry stores for a push of `built` as `version`, as the
    version endpoint answers it. push.js stamps `metadata.author` from the
    package's first publisher (`author`; unchanged when None)."""
    m = copy.deepcopy(built)
    m["appVersion"] = version
    m["signature"] = {
        "algorithm": "ed25519",
        "publicKey": "pk",
        "signature": "sig-old",
        "signedAt": "2026-11-01T10:00:00Z",
    }
    if author is not None:
        m["metadata"]["author"] = author
    m["metadata"]["_ownerEmail"] = "release@calimero.network"
    m["_installSize"] = 4321
    m["_publishedAt"] = "2026-11-01T10:00:01Z"
    m.update(min_runtime_version=m["minRuntimeVersion"], verified=True, publisherVerified=True)
    m.update(installSize=4321, publishedAt="2026-11-01T10:00:01Z", yanked=False, downloads=7)
    for k in ("_installSize", "_publishedAt"):
        del m[k]  # sanitizeBundle sets them undefined: absent from JSON
    del m["metadata"]["_ownerEmail"]
    return m


class Registry(http.server.BaseHTTPRequestHandler):
    latest = None  # the version endpoint's manifest, or None for no package
    requests: typing.ClassVar[list] = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        Registry.requests.append(q)
        if url.path != "/api/v2/bundles" or q.get("package") != PACKAGE or Registry.latest is None:
            body = []
        elif "version" in q:
            body = [Registry.latest] if q["version"] == Registry.latest["appVersion"] else None
        else:
            listed = copy.deepcopy(Registry.latest)
            listed["metadata"].pop("guide", None)  # sanitizeBundles
            body = [listed]
        data = json.dumps(body).encode()
        self.send_response(200 if body is not None else 404)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Registry)
threading.Thread(target=server.serve_forever, daemon=True).start()
REGISTRY = f"http://127.0.0.1:{server.server_port}"


def same(built, latest, *version):
    Registry.latest = latest
    Registry.requests = []
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(built, f)
    try:
        r = subprocess.run(
            [*CMD, f.name, PACKAGE, *version],
            capture_output=True,
            check=False,
            text=True,
            env={
                **os.environ,
                "CALIMERO_REGISTRY_URL": REGISTRY,
                "REGISTRY": REGISTRY,
                "PACKAGE": PACKAGE,
                "NO_PROXY": "127.0.0.1",
                "no_proxy": "127.0.0.1",
            },
        )
    finally:
        os.unlink(f.name)
    assert r.returncode == 0, r
    out = [l for l in r.stdout.splitlines() if l.startswith("same=")]
    assert out in (["same=true"], ["same=false"]), r
    return out[0] == "same=true"


def changed(**top):
    m = copy.deepcopy(BUILT)
    m.update(top)
    return m


failures = []


def case(name, got, want):
    print(f"{'ok  ' if got == want else 'FAIL'} {name}: same={str(got).lower()} (want {str(want).lower()})")
    if got != want:
        failures.append(name)


case("identical -> skip", same(BUILT, stored(BUILT)), True)
case("outbound-only change -> publish", same(changed(outbound=["https://api.example.com/v2/"]), stored(BUILT)), False)
case("outbound removed -> publish", same(changed(outbound=[]), stored(BUILT)), False)
case(
    "frontendAliases change -> publish",
    same(changed(frontendAliases=["https://old-example.vercel.app", "https://older.example.com"]), stored(BUILT)),
    False,
)
case("upgrades change -> publish", same(changed(upgrades="owner"), stored(BUILT)), False)
case("handlers.slug change -> publish", same(changed(handlers={"slug": "example"}), stored(BUILT)), False)
case("links change -> publish", same(changed(links={"frontend": "https://new.example.com"}), stored(BUILT)), False)
case(
    "frontend.entry change -> publish",
    same(changed(frontend={**BUILT["frontend"], "entry": "app.html"}), stored(BUILT)),
    False,
)
case("a field core adds later -> publish", same(changed(newSignedField={"x": 1}), stored(BUILT)), False)
case("wasm change -> publish", same(changed(wasm={**BUILT["wasm"], "hash": "bb22"}), stored(BUILT)), False)
case("metadata.author stamped by the registry -> skip", same(BUILT, stored(BUILT, author="calimero-bot")), True)
case("metadata change -> publish", same(BUILT, stored(changed(metadata={**BUILT["metadata"], "name": "Old"}))), False)
# The listing drops the guide; the version endpoint keeps it.
case("guide on both sides, listing strips it -> skip", same(GUIDED, stored(GUIDED)), True)
new_guide = copy.deepcopy(GUIDED)
new_guide["metadata"]["guide"] = "# Example\n\nA rewritten guide."
case("guide-only change -> publish", same(new_guide, stored(GUIDED)), False)
# Frontend files in another order, empty lists the registry answers as absent.
reordered = changed(frontend={**BUILT["frontend"], "files": BUILT["frontend"]["files"][::-1]})
case("frontend files reordered -> skip", same(reordered, stored(BUILT)), True)
case("explicit version -> publish", same(BUILT, stored(BUILT), "0.5.0"), False)
case("package not on the registry -> publish", same(BUILT, None), False)

# fresh=1 on every lookup: the edge cache is ~60 s stale otherwise.
same(BUILT, stored(BUILT))
lookups = Registry.requests
case("every lookup passes fresh=1", bool(lookups) and all(q.get("fresh") == "1" for q in lookups), True)

server.shutdown()
if failures:
    sys.exit(f"{len(failures)} failing: {', '.join(failures)}")
