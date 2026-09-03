#!/usr/bin/env python3
"""Assert every app can adopt the session the Calimero desktop hands it.

WHY THIS EXISTS

tauri-app opens an app at its registry `links.frontend` with a session already
minted, in the URL fragment:

    …#node_url=…&access_token=…&refresh_token=…&app-id=…&expires_at=…

mero-react owns that fragment — `MeroProvider` runs `parseAuthCallback` on its
first render — but it will not store the tokens unless it can decide the node is
trusted. `resolveTrustedNodeUrl` (mero-react/src/auth/node-trust.ts, unchanged
between the 4.6.1 and 6.0.4 the fleet pins) is DEFAULT-DENY:

    candidate + initiated        -> accept only if same origin
    candidate + allowedNodeUrls  -> accept only if listed
    candidate + neither          -> REJECT

"initiated" is `getNodeUrl()`, the node THIS browser context started a login
against. A desktop hand-off never had one: the launcher did the login. So an app
that anchors neither way lands in the third branch on every cold desktop open,
and the ONLY trace is

    [MeroProvider] OAuth callback node_url is not trusted … no tokens stored

on the console. The user sees the ordinary Connect screen while holding a
perfectly good session — the "auth skip" simply does not happen. Nothing
throws, no test fails, and the app works fine on the web, so this survives any
amount of green CI. Three apps were in that state when this was written:
battleships and mero-drive (no anchor at all) and mero-sheets, whose bootstrap
returned early on exactly the token-bearing hash that needs the seed — the one
case it existed for — while its index.tsx advertised "desktop auth-skip".

The two accepted anchors, both in use in the fleet:

  (a) pass `allowedNodeUrls={[hashNodeUrl]}` to MeroProvider, read from the
      hash at module scope (mero-calendar, mero-design, mero-forum, mero-meet,
      mero-pass, mero-pixart, mero-stream)
  (b) seed the initiated node with `setNodeUrl(...)` from the hash before React
      mounts, so `initiated` == the callback's node and the same-origin branch
      accepts it (kv-store, mero-issue-tracker)

They are not equally strict — kv-store gates (b) behind `getBridge()`, so it
only relaxes inside the launcher — but both clear the default-deny, which is
what this script checks. Choosing one for the whole fleet is a separate
decision.

Stdlib only: this runs in the always-on `metadata` job.
"""

import os
import re
import sys

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# `if (p.get('access_token')) return;` — the shape that made mero-sheets' seed
# unreachable in the only case it mattered.
BAILS_ON_TOKEN = re.compile(
    r"""if\s*\(\s*[\w.]*\.get\(\s*['"]access_token['"]\s*\)\s*\)\s*(?:\{\s*)?return""",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"::error::{msg}")


def source_files(app: str) -> dict[str, str]:
    """Every non-test .ts/.tsx under the app's frontend, by path."""
    src = os.path.join(REPO, "apps", app, "app/src")
    out: dict[str, str] = {}
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            # A test may legitimately assert the BROKEN shape (mero-meet's
            # boot.test.tsx does), so tests never count as evidence either way.
            if ".test." in name or ".spec." in name:
                continue
            path = os.path.join(root, name)
            out[path] = open(path, encoding="utf8", errors="replace").read()
    return out


def has_allowed_node_urls(blob: dict[str, str]) -> bool:
    """Anchor (a): the PROP, passed as a JSX expression.

    Matched as `allowedNodeUrls={` rather than as a bare word, because every
    app that gets this right also explains it in a comment — and a comment
    anchors nothing.
    """
    return any(re.search(r"allowedNodeUrls\s*=\s*\{", text) for text in blob.values())


def seeds_node_from_hash(blob: dict[str, str]) -> tuple[bool, list[str]]:
    """Anchor (b): `setNodeUrl(...)` fed from the auth hash, before mount.

    Returns (anchored, problems). A file that seeds but bails on a
    token-bearing hash first is reported rather than counted: that is the
    mero-sheets defect, and it reads as working code.
    """
    anchored = False
    problems: list[str] = []
    for path, text in blob.items():
        if "setNodeUrl(" not in text:
            continue
        # The seed has to come from the fragment the launcher wrote. A
        # `setNodeUrl` wired to a settings field anchors nothing.
        if not re.search(r"location\.hash", text):
            continue
        call = text.index("setNodeUrl(")
        bail = BAILS_ON_TOKEN.search(text[:call])
        if bail:
            line = text[: bail.start()].count("\n") + 1
            problems.append(
                f"{os.path.relpath(path, REPO)}:{line}: returns early on a token-bearing "
                f"hash before seeding the node URL — that is the one case the seed exists "
                f"for, so the desktop's session is dropped"
            )
            continue
        anchored = True
    return anchored, problems


def main() -> int:
    apps = sorted(os.listdir(os.path.join(REPO, "apps")))
    for app in apps:
        if not os.path.isdir(os.path.join(REPO, "apps", app, "app/src")):
            continue
        blob = source_files(app)
        joined = "\n".join(blob.values())

        if "<MeroProvider" not in joined:
            # Not every frontend mounts mero-react. mero-blocks and merraria are
            # vanilla TS and read the session out of the URL themselves;
            # mero-sign is still on the legacy @calimero-network/calimero-client
            # and its CalimeroProvider. Neither goes through
            # `resolveTrustedNodeUrl`, so this rule does not apply to them —
            # their desktop hand-off is real but has to be checked separately.
            print(f"  --  {app} (no MeroProvider; not subject to mero-react node trust)")
            continue

        prop = has_allowed_node_urls(blob)
        seed, problems = seeds_node_from_hash(blob)

        for problem in problems:
            fail(f"{app}: {problem}")

        if prop or seed:
            how = "allowedNodeUrls" if prop else "seeded initiated node"
            print(f"  ok  {app}  ({how})")
        elif not problems:
            fail(
                f"{app}: mounts MeroProvider but anchors node trust neither way, so a cold "
                f"desktop open is default-DENIED and the handed-over session is dropped with "
                f"only a console error. Pass `allowedNodeUrls={{[hashNodeUrl]}}` read from the "
                f"hash at module scope, or seed `setNodeUrl(...)` from the hash before React "
                f"mounts"
            )

    if failures:
        print(f"\ndesktop SSO check FAILED ({len(failures)} problem(s))")
        return 1
    print("\nevery MeroProvider app can adopt a desktop hand-off")
    return 0


if __name__ == "__main__":
    sys.exit(main())
