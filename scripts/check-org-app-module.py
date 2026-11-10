#!/usr/bin/env python3
"""Assert every org app reaches its organization through the shared module.

WHY THIS EXISTS

An org app keeps its people in an organization, and since core#4890 each app
has its own app team there. What "create a workspace", "invite", "remove" and
"leave" mean then depends on the organization's mode: in an org that keeps
its apps apart (shared), an invite must name the app's team or it opens every
other app to the person, and Remove or Leave must take them out of this app,
not out of the organization. A team made without `shared` passed explicitly
closes every other app's team once the org holds two.

Those rules live in one place, `packages/connect/src/orgApp.ts`
(`createAppOrg`, `orgWideAccess`, `appInvite`, `appPeople`, `removeFromApp`,
`leaveApp`, `leaveOrg`). An app that calls the client itself gets them wrong
silently: nothing throws, the invite works, and the person simply lands in
every app of the org. So this fails when an org app calls any of these
directly instead of through the module:

    client.createOrg(...)                        create a workspace
    client.scopeApps(...), createAppTeam(...),   make an app team
      ensureAppTeam(...)
    client.invite(org, role, passkey, ...),      mint an invite
      inviteToApp(...)
    client.removeMember(org, account, passkey)   remove someone, leave the org
    client.removeTeamMember(org, team, account, passkey)

The member calls are told from an app's own helpers of the same name
(`roles.removeMember(account)`, `ws.invite({ contextId })`, a contract's
`removeMember(account)`) by their argument count: the node's take the org,
the person and a passkey. Comments, strings and test files are skipped.

Every app under `apps/` is in exactly one list below:

- CONVERTED: goes through the module. Any direct call fails.
- NOT_CONVERTED_YET: a temporary exemption that shrinks with each batch. An
  entry that no longer makes a direct call fails too, so it is moved to
  CONVERTED rather than left behind.
- NOT_ORG_APPS: not an org app as this check means it, with the reason.
- An app in no list (a new one) is checked as CONVERTED.

Stdlib only: this runs in the always-on `metadata` job.
"""

import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

CONVERTED = {
    "mero-chat",
    "mero-crm",
    "mero-issue-tracker",
    "mero-docs",
    "mero-forms",
    "mero-forum",
    "mero-pass",
    "mero-pixart",
    "mero-stream",
    "mero-updates",
    "mero-calendar",
}

NOT_CONVERTED_YET = {
    "mero-design",
    "mero-sheets",
    "mero-sign",
}

NOT_ORG_APPS = {
    "mero-home": "Calimero Home is the portal that manages an org's app teams, invites and people itself",
    "conformance": "a test harness that drives the node's org routes on purpose",
    "scaffolding-e2e": "a test harness for the app template",
    "battleships": "a game: one org per table, never shared with other apps",
    "mero-chess": "a game: one org per table, never shared with other apps",
    "mero-kombat": "a game: one org per lobby, never shared with other apps",
    "mero-blocks": "a game: one org per world, never shared with other apps",
    "merraria": "a game: one org per world, never shared with other apps",
    "hyperfeed": "a template app, not yet adopting app teams",
    "kv-store": "a template app, not yet adopting app teams",
    "mero-models": "a template app, not yet adopting app teams",
    "mero-standup": "a template app, not yet adopting app teams",
    "mero-vote": "a template app, not yet adopting app teams",
}

SKIP_DIRS = {"node_modules", "dist", "build", "target", "e2e", "android", "ios", ".vite", "coverage", "__tests__"}
SOURCE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs")

# name -> least number of arguments the node's call takes (0: any call counts).
CLIENT_CALLS = {
    "createOrg": 0,
    "scopeApps": 0,
    "invite": 3,
    "removeMember": 3,
    "removeTeamMember": 4,
}
HELPER_CALLS = {"createAppTeam", "ensureAppTeam", "inviteToApp"}

CALL = re.compile(r"(\.\s*)?\b([A-Za-z_$][\w$]*)\s*\(")


def strip_comments_and_strings(source):
    """Blank out comments and string contents (a template's `${...}` stays code), keeping offsets."""
    out = list(source)
    n = len(source)

    def blank(a, b):
        for k in range(a, min(b, n)):
            if out[k] != "\n":
                out[k] = " "

    def code(i, closing):
        """Scan code from `i`; with `closing`, stop after the `}` that ends a template expression."""
        depth = 0
        while i < n:
            c, two = source[i], source[i : i + 2]
            if two == "//":
                j = source.find("\n", i)
                j = n if j < 0 else j
                blank(i, j)
                i = j
            elif two == "/*":
                j = source.find("*/", i + 2)
                j = n if j < 0 else j + 2
                blank(i, j)
                i = j
            elif c in "'\"":
                j = i + 1
                while j < n and source[j] not in (c, "\n"):
                    j += 2 if source[j] == "\\" else 1
                blank(i + 1, j)
                i = j + 1
            elif c == "`":
                i = template(i + 1)
            else:
                if c == "{":
                    depth += 1
                elif c == "}":
                    if closing and depth == 0:
                        return i + 1
                    depth -= 1
                i += 1
        return i

    def template(i):
        while i < n:
            if source[i] == "\\":
                blank(i, i + 2)
                i += 2
            elif source[i] == "`":
                return i + 1
            elif source[i : i + 2] == "${":
                i = code(i + 2, True)
            else:
                blank(i, i + 1)
                i += 1
        return i

    code(0, False)
    return "".join(out)


def count_args(code, open_paren):
    """The number of top-level arguments of the call whose `(` is at `open_paren`."""
    depth, args, seen = 0, 0, False
    for k in range(open_paren, len(code)):
        ch = code[k]
        if ch in "([{":
            depth += 1
            if depth > 1:
                seen = True
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                return args + (1 if seen else 0)
        elif depth == 1:
            if ch == ",":
                args += 1
                seen = False
            elif not ch.isspace():
                seen = True
    return args


def scan(path, source):
    """The direct org calls in one file: [(path, line, name)]."""
    code = strip_comments_and_strings(source)
    problems = []
    for m in CALL.finditer(code):
        dotted, name = m.group(1) is not None, m.group(2)
        if dotted and name in CLIENT_CALLS:
            if count_args(code, m.end() - 1) < CLIENT_CALLS[name]:
                continue
        elif not dotted and name in HELPER_CALLS:
            # `function createAppTeam(` declares one; it is not a call.
            if re.search(r"\bfunction\s*\*?\s*$", code[: m.start()]):
                continue
        else:
            continue
        line = code.count("\n", 0, m.start()) + 1
        problems.append((path, line, name))
    return problems


def app_sources(app_dir):
    for dirpath, dirnames, filenames in os.walk(app_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if not f.endswith(SOURCE_EXT) or ".test." in f or ".spec." in f or f.endswith(".d.ts"):
                continue
            yield os.path.join(dirpath, f)


def check(root=ROOT):
    """Every complaint, as lines to print; empty when the fleet is clean."""
    errors = []
    apps_dir = os.path.join(root, "apps")
    apps = sorted(d for d in os.listdir(apps_dir) if os.path.isdir(os.path.join(apps_dir, d)))
    for listed in sorted((CONVERTED | NOT_CONVERTED_YET | set(NOT_ORG_APPS)) - set(apps)):
        errors.append(f"{listed}: listed in check-org-app-module.py but there is no apps/{listed}")
    for both in sorted(CONVERTED & NOT_CONVERTED_YET):
        errors.append(f"{both}: both CONVERTED and NOT_CONVERTED_YET")
    for app in apps:
        if app in NOT_ORG_APPS:
            continue
        found = []
        for path in app_sources(os.path.join(apps_dir, app)):
            with open(path, encoding="utf-8", errors="ignore") as fh:
                found += scan(os.path.relpath(path, root), fh.read())
        if app in NOT_CONVERTED_YET:
            if not found:
                errors.append(
                    f"{app}: makes no direct org call any more; move it from NOT_CONVERTED_YET to CONVERTED"
                )
            continue
        for path, line, name in found:
            errors.append(
                f"{path}:{line}: `{name}` called directly; an org app goes through "
                f"@calimero-apps/connect's org-app module (createAppOrg, orgWideAccess, appInvite, "
                f"removeFromApp, leaveApp, leaveOrg)"
            )
    return errors


def main():
    errors = check()
    if errors:
        print("Org apps must reach their organization through the shared module:\n")
        for e in errors:
            print(f"  {e}")
        print("\nSee scripts/check-org-app-module.py for why and for the lists.")
        return 1
    print(
        f"check-org-app-module: {len(CONVERTED)} org apps go through the module; "
        f"{len(NOT_CONVERTED_YET)} still exempt."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
