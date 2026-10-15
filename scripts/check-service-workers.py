#!/usr/bin/env python3
"""Assert no app's service worker can serve a page older than the deploy.

Every app's `vercel.json` serves its HTML `no-cache`, so a browser or the
desktop's webview revalidates the page on every open and gets the deployed
build. A service worker answers before that header is ever read. mero-chat's
precached `index.html` and served it for every navigation, so the first open
after a deploy ran the previous build: an invite opened from the desktop landed
on a screen the release had removed, with its `?invitation=` ignored.

So, in each app's built output, a service worker may not:

  * precache an `.html` file (Workbox: a `url:"….html"` precache entry),
  * answer navigations from the precache (Workbox: `createHandlerBoundToURL`,
    which is what `navigateFallback` generates),
  * or, written by hand, handle `fetch` at all, since that can do either.

A worker that only shows pushes (hyperfeed's) passes. A Workbox worker that
fetches pages NetworkFirst (mero-chat's) passes.

  scripts/check-service-workers.py                 # every app with a build
  scripts/check-service-workers.py apps/x/app ...  # only these (CI passes the
                                                   # apps the frontend job built)
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Workbox's runtime is emitted beside the worker as `workbox-<hash>.js`. It
# defines `NavigationRoute` and friends whether or not the worker uses them, so
# only the worker that calls into it is judged.
WORKBOX_RUNTIME = re.compile(r"^workbox-[0-9a-f]+\.js$")
PRECACHED_HTML = re.compile(r"""url\s*:\s*["']([^"']*\.html)["']""")
PRECACHED_NAVIGATION = re.compile(r"createHandlerBoundToURL\s*\(")
FETCH_HANDLER = re.compile(
    r"""addEventListener\s*\(\s*["']fetch["']|\bonfetch\s*="""
)


def findings(source: str) -> list[str]:
    """What in one built script can serve a stale page. Empty when nothing."""
    if "precacheAndRoute" in source:
        found = [
            f"precaches {url}" for url in sorted(set(PRECACHED_HTML.findall(source)))
        ]
        if PRECACHED_NAVIGATION.search(source):
            found.append(
                "answers navigations from the precache (navigateFallback); "
                "set `navigateFallback: null` and fetch pages NetworkFirst"
            )
        return found
    if FETCH_HANDLER.search(source):
        return [
            "handles fetch in a hand-written worker; serve pages from the "
            "network, then allowlist it here once reviewed"
        ]
    return []


def output_dir(app_dir: pathlib.Path) -> pathlib.Path:
    cfg = app_dir / "vercel.json"
    out = "dist"
    if cfg.is_file():
        out = json.loads(cfg.read_text()).get("outputDirectory") or "dist"
    return app_dir / out


def check(app_dir: pathlib.Path) -> list[str]:
    """Findings for one app, each prefixed with the file it is in."""
    out = output_dir(app_dir)
    problems = []
    for script in sorted(out.glob("*.js")):
        if WORKBOX_RUNTIME.match(script.name):
            continue
        for finding in findings(script.read_text(errors="replace")):
            problems.append(f"{script.relative_to(ROOT)}: {finding}")
    return problems


def main(argv: list[str]) -> int:
    dirs = [ROOT / d.rstrip("/") for d in argv] or sorted(ROOT.glob("apps/*/app"))
    failed = False
    for app_dir in dirs:
        app = app_dir.parent.name
        if not output_dir(app_dir).is_dir():
            print(f"  {app:<19} not built, skipped")
            continue
        problems = check(app_dir)
        if problems:
            failed = True
            for problem in problems:
                print(f"::error::{problem}")
        else:
            print(f"  {app:<19} ok")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
