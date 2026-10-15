#!/usr/bin/env python3
"""Fixture tests for scripts/check-service-workers.py.

The fixtures are real builds: mero-chat's worker before and after it stopped
precaching its page, and hyperfeed's push-only worker. A check that stops
recognising the first one is worse than no check, because it still claims the
apps are covered.

Run: python3 scripts/tests/service-workers-test.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures" / "service-workers"
SPEC = importlib.util.spec_from_file_location(
    "check_service_workers", HERE.parent / "check-service-workers.py"
)
csw = importlib.util.module_from_spec(SPEC)
sys.modules["check_service_workers"] = csw
assert SPEC.loader is not None
SPEC.loader.exec_module(csw)

FAILURES: list[str] = []


def expect(name: str, ok: bool, detail: object = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        FAILURES.append(f"{name}: {detail}")


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


# mero-chat before the fix: index.html precached and served for navigations.
stale = csw.findings(fixture("precached-shell.js"))
expect("a precached index.html is caught", any("index.html" in f for f in stale), stale)
expect(
    "a precached navigation fallback is caught",
    any("navigateFallback" in f for f in stale),
    stale,
)

# mero-chat after it: pages NetworkFirst, nothing HTML in the precache.
fresh = csw.findings(fixture("network-first.js"))
expect("a NetworkFirst page worker passes", fresh == [], fresh)

# hyperfeed: shows pushes, no fetch handler.
push = csw.findings(fixture("push-only.js"))
expect("a push-only worker passes", push == [], push)

handwritten = csw.findings(
    'self.addEventListener("fetch", (e) => e.respondWith(caches.match(e.request)));'
)
expect("a hand-written fetch handler is caught", handwritten != [], handwritten)

# The Workbox runtime chunk defines NavigationRoute whether or not the worker
# uses it, so it is never judged; the worker beside it is.
with tempfile.TemporaryDirectory(dir=csw.ROOT) as tmp:
    app = pathlib.Path(tmp) / "app"
    (app / "dist").mkdir(parents=True)
    (app / "dist" / "workbox-0123abcd.js").write_text(
        "class NavigationRoute{} function createHandlerBoundToURL(){} precacheAndRoute"
    )
    (app / "dist" / "sw.js").write_text(fixture("network-first.js"))
    expect("the Workbox runtime chunk is not judged", csw.check(app) == [], csw.check(app))

    (app / "dist" / "sw.js").write_text(fixture("precached-shell.js"))
    expect("the worker beside it still is", csw.check(app) != [], csw.check(app))

if FAILURES:
    print("\n".join(["", *FAILURES]))
    sys.exit(1)
print("all service-worker checks behave")
