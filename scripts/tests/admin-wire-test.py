#!/usr/bin/env python3
"""Assert scripts/check-admin-wire.py actually catches what it claims to.

WHY THIS EXISTS

The first version of that checker matched request routes as LITERAL strings.
Every call site that writes a route as a template literal —
`` `/namespaces/${teamId}/groups` `` — was therefore invisible to it, so the
check passed a fleet in which four apps were sending `groupAlias` to the
subgroup route and getting

    unknown field `groupAlias`, expected `groupName` or `visibility`

from every node. The checker was green because it was looking at almost
nothing, which is the same failure the checker exists to prevent, one level up.

A guard that silently stops covering a shape is worse than no guard: it also
carries the claim that the shape is covered. So the guard gets its own tests.

Stdlib only: this runs in the always-on `metadata` job.
"""

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKER = os.path.join(HERE, "..", "check-admin-wire.py")

spec = importlib.util.spec_from_file_location("check_admin_wire", CHECKER)
chk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chk)

failures = []


def check(label, source, expect_flagged, expect_key=None):
    """Run the checker over one snippet and assert whether it complains."""
    problems = chk.scan("<test>", source)
    flagged = len(problems) > 0
    if flagged != expect_flagged:
        failures.append(
            f"{label}: expected {'a finding' if expect_flagged else 'no finding'}, "
            f"got {problems if problems else 'none'}"
        )
        return
    if expect_flagged and expect_key is not None:
        keys = {k for _, _, extra, _ in problems for k in extra}
        if expect_key not in keys:
            failures.append(f"{label}: expected `{expect_key}` among {sorted(keys)}")


# ── the regression this file is named for ────────────────────────────────────
check(
    "templated route, bad key (the groupAlias bug)",
    'await adminPost(`/namespaces/${teamId}/groups`, { groupAlias: n, groupName: n });',
    expect_flagged=True,
    expect_key="groupAlias",
)
check(
    "templated route, good key",
    'await adminPost(`/namespaces/${teamId}/groups`, { groupName: n });',
    expect_flagged=False,
)

# The namespace-scoped subgroup route is NOT CreateGroupApiRequest. Sending
# that struct's fields here is a 400, and a table that conflated the two would
# wave this through.
check(
    "subgroup route does not accept CreateGroupApiRequest fields",
    'await adminPost(`/namespaces/${id}/groups`, { applicationId: a, name: n });',
    expect_flagged=True,
    expect_key="applicationId",
)

# A call that builds the URL from a base variable. mero-drive's reparent is
# spelled this way, and it was invisible while the matcher required the string
# to START with a slash — the same blind spot as the literal-route bug, one
# spelling over.
check(
    "base-prefixed URL, bad key",
    'fetch(`${base}/admin-api/groups/${id}/reparent`, { method: "POST", body: JSON.stringify({ newParentId: p, parentId: p }) });',
    expect_flagged=True,
    expect_key="parentId",
)
check(
    "base-prefixed URL, clean",
    'fetch(`${base}/admin-api/groups/${id}/reparent`, { method: "POST", body: JSON.stringify({ newParentId: p }) });',
    expect_flagged=False,
)

# ── literal routes (what the first version covered) ──────────────────────────
check(
    "literal namespace create, dead `alias`",
    'await adminPost("/admin-api/namespaces", { applicationId: a, name: n, alias: n });',
    expect_flagged=True,
    expect_key="alias",
)
check(
    "literal context create, dead `protocol`",
    'adminPost("/contexts", { applicationId: a, groupId: g, protocol: "near", name: n });',
    expect_flagged=True,
    expect_key="protocol",
)
check(
    "literal namespace create, clean",
    'await adminPost("/admin-api/namespaces", { applicationId: a, name: n });',
    expect_flagged=False,
)

# ── the JSON-RPC envelope ────────────────────────────────────────────────────
# Spread CONDITIONALLY, which is how it survived: a session with no identity
# sent the correct three keys, so every fixture passed.
check(
    "jsonrpc params, conditionally-spread executorPublicKey",
    """fetch(u, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "execute",
        params: { contextId: c, method, argsJson: a,
                  ...(t.executorPublicKey ? { executorPublicKey: t.executorPublicKey } : {}) } }) });""",
    expect_flagged=True,
    expect_key="executorPublicKey",
)
check(
    "jsonrpc params, clean (ES6 shorthand `method`)",
    """fetch(u, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "execute",
        params: { contextId: c, method, argsJson: a } }) });""",
    expect_flagged=False,
)

# ── shapes that must NOT be reported ─────────────────────────────────────────
# A fetch init is not the body; reporting `method`/`headers` as refused fields
# is noise that trains people to ignore the check.
check(
    "fetch init is unwrapped to its JSON body",
    """await adminFetch(`/admin-api/namespaces/${id}/groups`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName: n }) });""",
    expect_flagged=False,
)
# A body passed as a variable cannot be read statically. Walking forward to the
# next `{` finds an options argument or a return literal — that produced four
# false positives against mero-js.
check(
    "variable body is skipped, not guessed at",
    'await this.httpClient.post(`/admin-api/namespaces/${id}/join`, request, { timeoutMs: 65000 });',
    expect_flagged=False,
)
# An unlisted route is not checked at all; a guessed table entry would be worse
# than silence.
check(
    "untabled route is ignored",
    'await adminPost(`/admin-api/groups/${id}/join-via-inheritance`, { whatever: 1 });',
    expect_flagged=False,
)
# Comments and strings must not be mistaken for keys.
check(
    "a dead key named only in a comment is not a finding",
    """// historical: this used to send `alias` alongside name
       await adminPost("/admin-api/namespaces", { applicationId: a, name: n });""",
    expect_flagged=False,
)

if failures:
    print("check-admin-wire.py does not behave as documented:\n")
    for f in failures:
        print("  " + f)
    sys.exit(1)

print("check-admin-wire.py: catches templated + literal routes, ignores "
      "fetch inits, variable bodies, untabled routes and comments")
