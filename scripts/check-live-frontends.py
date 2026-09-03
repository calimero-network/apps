#!/usr/bin/env python3
"""Assert each app's live deployment is actually the app in this repo.

WHY THIS EXISTS

`battleships.vercel.app` serves somebody else's application — a third-party
single-player battleships-vs-computer toy built with create-react-app. Its
bundle carries no `com.calimero.*` package id and no mero-react at all, and
neither does `battleships-app.vercel.app`, which is a *different* third-party
battleships game. The repo is fine: every component under
`apps/battleships/app/src` matches the archived `calimero-network/battleships`
and `vite build` is green.

The cause is the `frontend` value, not a project setting: `battleships` is a
generic name that was already taken on Vercel. That is why every other app here
carries a prefix or suffix — `mero-kv-store`, `mero-stream-neon`,
`mero-issue-tracker-app`, `scaffolding-e2e-application`. battleships is the only
one declaring a bare generic name, so it has been publishing a stranger's site
as its own frontend.

Nothing could catch that. `check-vercel-output.sh` asserts the declared
`outputDirectory` matches what the build writes, which was true. CI builds and
tests the app in the repo, which was correct. And the stale URL is not cosmetic:
`[package.metadata.calimero].frontend` is what the registry publishes as
`links.frontend`, which is what the desktop launcher opens, what every invite
link resolves to, and what the auth frontend authorizes a login callback
against. A stale deployment silently becomes the app, everywhere.

WHAT IT CHECKS

For each app, fetch the `frontend` URL from its Cargo metadata and compare the
served `<title>` with the one in `apps/<app>/app/index.html`. That is a
deliberately shallow check and it is the right depth: the title is committed
next to the app, changes when the app changes, and a mismatch means the origin
is serving something this repo did not build. It also flags the specific
fingerprints of the failure that happened — CRA's marker meta tag and a webpack
runtime — because naming them turns "the title is different" into "this is an
old create-react-app build".

A network failure is NOT a mismatch. Vercel being unreachable, or a DNS blip,
reports as skipped: a check that reds the build when a third party is down gets
switched off, and then it catches nothing.

Stdlib only, so it runs in the always-on metadata job.
"""

import glob
import os
import re
import sys
import urllib.error
import urllib.request

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TIMEOUT = 20

# Fingerprints of the exact failure this exists for.
CRA_MARKERS = (
    "create-react-app",
    "<title>React App</title>",
)

# Apps whose deployment is known-broken and whose fix is NOT in this repo.
#
# A named exception with a stated reason, rather than either of the two worse
# options: leaving the check unwired (dormant, catches nothing) or letting it red
# main until somebody clicks something in a dashboard. The exception cannot
# outlive its cause — an app listed here that turns out to be FINE fails the
# check, so the entry has to be deleted rather than quietly kept.
EXPECTED_STALE = {
    "battleships": (
        "points at a domain WE DO NOT OWN. battleships.vercel.app serves a "
        "third-party single-player battleships game (create-react-app, "
        "'Player board' / 'Start the game against the computer'); "
        "battleships-app.vercel.app is a DIFFERENT third-party battleships "
        "game. Neither bundle contains a `com.calimero.*` package id or any "
        "mero-react. The repo is correct — every component under "
        "apps/battleships/app/src matches the archived "
        "calimero-network/battleships and `vite build` is green.\n"
        "        This is not a Root Directory setting. `battleships` is a "
        "generic name that was already claimed on Vercel, which is exactly why "
        "every other app in this repo carries a prefix or suffix: "
        "mero-kv-store (not kv-store), mero-stream-neon, "
        "mero-issue-tracker-app, scaffolding-e2e-application. battleships is "
        "the only `frontend` here using a bare generic name.\n"
        "        FIX: read this project's real *.vercel.app URL off the Vercel "
        "dashboard (or rename the project to a free name, e.g. "
        "mero-battleships) and put THAT in "
        "apps/battleships/logic/Cargo.toml `frontend`. Until then the registry "
        "publishes a stranger's site as this app's links.frontend — which is "
        "what the desktop launcher opens, what invite links resolve to, and "
        "what the auth frontend authorizes a login callback against."
    ),
}

failures: list[str] = []
skipped: list[str] = []
stale_as_expected: list[str] = []
unexpectedly_fine: list[str] = []


def title_of(html: str) -> str | None:
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    return m.group(1).strip() if m else None


def frontend_url(app: str) -> str | None:
    manifest = os.path.join(REPO, "apps", app, "logic/Cargo.toml")
    if not os.path.isfile(manifest):
        return None
    # `\Z` in the lookahead: see the note in check-app-icons.py. An app whose
    # calimero table is the last in the file must not be skipped in silence —
    # kv-store is one.
    table = re.search(
        r"^\[package\.metadata\.calimero\]$(.*?)(?=^\[|\Z)",
        open(manifest).read(),
        re.M | re.S,
    )
    if not table:
        return None
    found = re.search(r'^frontend\s*=\s*"([^"]+)"', table.group(1), re.M)
    return found.group(1).rstrip("/") if found else None


def main() -> int:
    apps = sorted(
        p.split(os.sep)[-3] for p in glob.glob(os.path.join(REPO, "apps/*/logic/Cargo.toml"))
    )
    for app in apps:
        index = os.path.join(REPO, "apps", app, "app/index.html")
        url = frontend_url(app)
        if not url or not os.path.isfile(index):
            print(f"  --  {app} (no frontend URL or no index.html)")
            continue

        want = title_of(open(index).read())
        if not want:
            print(f"  --  {app} (its index.html has no <title> to compare)")
            continue

        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
                html = resp.read(200_000).decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            skipped.append(f"{app}: {url} unreachable ({exc})")
            print(f"  ??  {app} (unreachable — not treated as a mismatch)")
            continue

        got = title_of(html)
        if got == want:
            if app in EXPECTED_STALE:
                unexpectedly_fine.append(app)
                print(
                    f"::error::{app}: {url} now serves the right app, so its "
                    f"EXPECTED_STALE entry in this script is out of date — delete it "
                    f"so the check guards this app again."
                )
            else:
                print(f"  ok  {app}  ({want})")
            continue

        stale = [m for m in CRA_MARKERS if m.lower() in html.lower()]
        detail = (
            " — and it carries "
            + ", ".join(repr(m) for m in stale)
            + ", i.e. an old create-react-app build from before this app moved to Vite"
            if stale
            else ""
        )
        if app in EXPECTED_STALE:
            stale_as_expected.append(app)
            print(
                f"::warning::{app}: {url} serves <title>{got}</title>, not "
                f"<title>{want}</title> — KNOWN: {EXPECTED_STALE[app]}"
            )
            continue

        failures.append(app)
        print(
            f"::error::{app}: {url} serves <title>{got}</title> but this repo builds "
            f"<title>{want}</title>{detail}. The Vercel project is not deploying from "
            f"apps/{app}/app — check its Root Directory (see docs/VERCEL.md). This URL is "
            f"what the registry publishes as links.frontend, so the desktop launcher, "
            f"every invite link and the login callback all resolve to it."
        )

    if skipped:
        print("\nskipped (unreachable):")
        for s in skipped:
            print(f"  {s}")

    if stale_as_expected:
        print("\nknown-stale (fix is outside this repo):")
        for app in stale_as_expected:
            print(f"  {app}: {EXPECTED_STALE[app]}")

    if failures or unexpectedly_fine:
        bad = ", ".join(failures + unexpectedly_fine)
        print(f"\nlive frontend check FAILED for: {bad}")
        return 1
    print("\nevery reachable deployment serves the app this repo builds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
