#!/usr/bin/env python3
"""Assert scripts/check-org-app-module.py catches what it claims to.

The check tells the node's org calls from an app's own helpers of the same
name by their argument count, and skips comments and strings. Get either
wrong and it goes quiet on the very call it exists for (a guard that stops
covering a shape still claims to cover it), or it fails on correct code until
someone adds an exemption that hides the next real call. So the guard gets
its own tests, like check-admin-wire.py.

Stdlib only: this runs in the always-on `metadata` job.
"""

import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKER = os.path.join(HERE, "..", "check-org-app-module.py")

spec = importlib.util.spec_from_file_location("check_org_app_module", CHECKER)
chk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chk)

failures = []


def flags(label, source, expected):
    """`expected`: the call names the checker must report, in order ([] for none)."""
    got = [name for _, _, name in chk.scan("<test>", source)]
    if got != expected:
        failures.append(f"{label}: expected {expected}, got {got}")


# ── the node's calls, made directly ──────────────────────────────────────────
flags("createOrg", "const org = await client.createOrg(name);", ["createOrg"])
flags("scopeApps", "await c.scopeApps(org, passkey, { apps });", ["scopeApps"])
flags("an org invite", "return client.invite(org, 'member', passkey);", ["invite"])
flags("an invite naming teams", 'await this.client.invite(org, "member", this.passkey(), team ? [team] : []);', ["invite"])
flags("remove from the org", "await client.removeMember(o, account, passkey());", ["removeMember"])
flags("leave the org (remove yourself)", "await conn.client.removeMember(org, self, passkey());", ["removeMember"])
flags("remove from a team", "await c.removeTeamMember(org, team, account, passkey());", ["removeTeamMember"])
flags("the app-team helpers", "await createAppTeam(c, org, pkg, p); await inviteToApp(c, org, pkg, { passkey });", ["createAppTeam", "inviteToApp"])
flags("ensureAppTeam", "const t = await ensureAppTeam(client, org, PKG, passkey);", ["ensureAppTeam"])
flags(
    "a call over several lines",
    "await client.invite(\n  org,\n  'member',\n  passkey(),\n);",
    ["invite"],
)
flags("inside a template expression", "const s = `org ${await client.createOrg(`x`)}`;", ["createOrg"])
flags("an argument with nested calls", "client.removeMember(f(a, b), g(c), h());", ["removeMember"])

# ── what is not one ──────────────────────────────────────────────────────────
flags("an app's own remove helper", "onConfirm={() => run(account, () => roles.removeMember(account))}", [])
flags("a contract's removeMember", "await client.removeMember(account);", [])
flags("an app's own invite wrapper", "await ws.invite({ contextId: ws.contextId });", [])
flags("a data source's remove", "const resp = await api.removeMember(groupId, memberIdentity);", [])
flags("the module's own calls", "await createAppOrg(client, name, source, passkey); await appInvite(c, org, s, p);", [])
flags("a line comment", "// client.invite(org, 'member', passkey) used to be here", [])
flags("a block comment", "/* `client.createOrg(name)` makes the org */ const x = 1;", [])
flags("a string", "const doc = 'call client.removeMember(org, account, passkey) to remove';", [])
flags("a template's text", "const doc = `client.createOrg(name) makes ${what}`;", [])
flags("a declaration of the same name", "export async function inviteToApp(client, org, pkg, o) {}", [])
flags("an escaped quote does not end the string", "const s = 'it\\'s client.createOrg(x)'; f();", [])

# ── the lists ────────────────────────────────────────────────────────────────


def tree(apps):
    root = tempfile.mkdtemp(prefix="org-app-module-")
    for app, source in apps.items():
        src = os.path.join(root, "apps", app, "app", "src")
        os.makedirs(src)
        with open(os.path.join(src, "orgs.ts"), "w") as fh:
            fh.write(source)
        # Tests and e2e may call the client directly.
        with open(os.path.join(src, "orgs.test.ts"), "w") as fh:
            fh.write("await client.createOrg('t');")
        os.makedirs(os.path.join(root, "apps", app, "app", "e2e"))
        with open(os.path.join(root, "apps", app, "app", "e2e", "h.ts"), "w") as fh:
            fh.write("await client.createOrg('t');")
    return root


def errors_for(apps, converted, exempt, not_org):
    saved = (chk.CONVERTED, chk.NOT_CONVERTED_YET, chk.NOT_ORG_APPS)
    chk.CONVERTED, chk.NOT_CONVERTED_YET, chk.NOT_ORG_APPS = set(converted), set(exempt), dict(not_org)
    try:
        return chk.check(tree(apps))
    finally:
        chk.CONVERTED, chk.NOT_CONVERTED_YET, chk.NOT_ORG_APPS = saved


DIRECT = "await client.createOrg(name);"
CLEAN = "await createAppOrg(client, name, source, passkey);"


def expect(label, errors, needles):
    if len(errors) != len(needles) or not all(any(n in e for e in errors) for n in needles):
        failures.append(f"{label}: expected errors naming {needles}, got {errors}")


expect("a clean fleet", errors_for({"a": CLEAN, "b": DIRECT, "c": DIRECT}, ["a"], ["b"], {"c": "portal"}), [])
expect("a converted app calling directly", errors_for({"a": DIRECT}, ["a"], [], {}), ["apps/a/app/src/orgs.ts:1: `createOrg`"])
expect("a new app, in no list, is checked", errors_for({"new": DIRECT}, [], [], {}), ["apps/new/app/src/orgs.ts:1"])
expect(
    "an exemption that is no longer needed",
    errors_for({"b": CLEAN}, [], ["b"], {}),
    ["b: makes no direct org call any more"],
)
expect("a listed app that does not exist", errors_for({"a": CLEAN}, ["a", "gone"], [], {}), ["gone: listed"])
expect("an app in two lists", errors_for({"a": DIRECT}, ["a"], ["a"], {}), ["both CONVERTED"])

# ── and the real fleet passes ────────────────────────────────────────────────
real = chk.check()
if real:
    failures.append("the repository itself: " + "; ".join(real))

if failures:
    print("check-org-app-module.py does not behave as documented:\n")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("check-org-app-module.py: catches the node's org calls made directly, ignores comments, strings, tests and same-named app helpers")
