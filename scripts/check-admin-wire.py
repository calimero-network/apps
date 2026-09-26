#!/usr/bin/env python3
"""Assert no app sends the node a request body key the node refuses.

WHY THIS EXISTS

Every body core deserializes is a CLOSED set. `crates/server/primitives/src/
admin/mod.rs` puts `deny_unknown_fields` on every admin request struct and
`jsonrpc.rs` puts it on `ExecutionRequest`; core even has a test
(`crates/server/primitives/tests/deny_unknown_fields.rs`) asserting a new
request type joins that list. So an extra key is never a field the node
shrugs off — it is a 400 that fails the whole call:

    Invalid JSON data: Failed to deserialize the JSON body into the target
    type: alias: unknown field `alias`, expected one of `applicationId`,
    `name`, `appKey`, `bytecodeId`

    rpc world_meta: unknown field `executorPublicKey`, expected one of
    `contextId`, `method`, `argsJson`

Both of those were live in the fleet against an rc.34 node. Neither was a
regression anyone introduced late: core dropped `executorPublicKey` from
JSON-RPC in #2116 and replaced the group `alias` with the generic metadata
record in #2338, and the call sites simply kept sending the old keys.

WHY NOTHING CAUGHT THEM

Nothing in CI ever compared an app's outgoing body to core's schema:

  * The vitest wire tests assert the keys that SHOULD be there
    (`expect(body.params.argsJson).toEqual(...)`) and never that nothing else
    is. A body with a fourth key passes every one of them.
  * The Playwright suites `page.route` the node and answer from a fixture. A
    mock cannot reject an unknown field — only a real `deny_unknown_fields`
    deserializer can — so a route-mocked suite is green by construction.
  * The merobox legs DO run a real merod, but merobox drives the node with its
    own Python client. The app's TypeScript request body is never on the wire
    in those runs.
  * `executorPublicKey` was spread in CONDITIONALLY
    (`...(target.executorPublicKey ? { executorPublicKey } : {})`), so a
    session without an identity — which is every unit test and every mocked
    e2e — sent the correct three keys and passed.

So this check reads the request bodies straight out of the source and compares
their keys to the table below. It is the only thing in CI that looks at the
shape an app actually POSTs.

REFRESHING THE TABLE

ROUTES is transcribed from core's request structs at the rc the fleet pins
(0.11.0-rc.34). When the SDK pin moves, re-read the `deny_unknown_fields`
structs in `crates/server/primitives/src/admin/mod.rs` and the `ExecutionRequest`
in `crates/server/primitives/src/jsonrpc.rs`, and update the sets here. A key
core ACCEPTS but no app sends is harmless to list; a key core REFUSES must not
be listed, or this check goes quiet on exactly the failure it exists for.

Stdlib only: this runs in the always-on `metadata` job.
"""

import os
import re
import sys

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
APPS = os.path.join(REPO, "apps")

# Route pattern -> the body keys core accepts, at 0.11.0-rc.34.
#
# `*` matches one path segment, so a template literal like
# `/namespaces/${teamId}/groups` normalises to `/namespaces/*/groups` and is
# checked the same as a literal string. The first version of this file matched
# LITERAL route strings only, which is why it passed a fleet that was sending
# `groupAlias` to the subgroup route in three apps: every call site spells that
# route as a template.
#
# Transcribed from the `deny_unknown_fields` structs in
# `crates/server/primitives/src/admin/mod.rs`, plus `CreateGroupInNamespaceBody`
# which lives in its handler
# (`crates/server/src/admin/handlers/namespaces/create_group_in_namespace.rs`).
# Regenerate on an SDK pin bump — see the docstring.
#
# A route is listed ONLY when its accepted set has been read from core. An
# unlisted route is NOT checked: a guessed entry would either miss the bug it
# exists for or red-flag correct code, and both are worse than silence.
ROUTES = {
    "/namespaces": {"applicationId", "name", "appKey", "bytecodeId"},
    # NOT CreateGroupApiRequest — the namespace-scoped subgroup route has its
    # own, much smaller body. `groupAlias` is not in it and never was.
    "/namespaces/*/groups": {"groupName", "visibility"},
    "/namespaces/*/invite": {
        "expirationTimestamp",
        "recursive",
        "admitters",
        "admitterAddrs",
    },
    "/namespaces/*/join": {"invitation", "groupName"},
    "/namespaces/*/admit": {"invitation", "signedOp"},
    "/contexts": {
        "applicationId",
        "serviceName",
        "contextSeed",
        "initializationParams",
        "groupId",
        "identitySecret",
        "name",
    },
    "/contexts/*/resync": {"force"},
    "/contexts/*/application": {"applicationId", "executorPublicKey"},
    "/groups": {
        "groupId",
        "appKey",
        "bytecodeId",
        "applicationId",
        "name",
        "parentGroupId",
    },
    "/groups/join": {"invitation", "groupName"},
    "/groups/*/members": {"members"},
    "/groups/*/members/remove": {"members"},
    "/groups/*/members/*/role": {"role"},
    "/groups/*/members/*/capabilities": {"capabilities"},
    "/groups/*/members/*/auto-follow": {"autoFollowContexts", "autoFollowSubgroups"},
    "/groups/*/members/*/metadata": {"name", "data"},
    "/groups/*/metadata": {"name", "data"},
    "/groups/*/settings/default-capabilities": {"defaultCapabilities"},
    "/groups/*/settings/subgroup-visibility": {"subgroupVisibility"},
    "/groups/*/reparent": {"newParentId"},
    "/groups/*/upgrade": {"cascade", "forceCodeOnly", "targetApplicationId"},
    "/groups/*/issue-ownership-proof": {
        "audience",
        "contextId",
        "expiresAtMs",
        "nonce",
        "subject",
    },
    "/groups/*/issue-namespace-ownership-proof": {
        "audience",
        "expiresAtMs",
        "nonce",
        "subject",
    },
    "/groups/*/accounts/*/seal": {"plaintext"},
    "/install-dev-application": {"path"},
    "/install-application": {"package", "version"},
}

# The JSON-RPC `execute` envelope: ExecutionRequest, jsonrpc.rs.
RPC_PARAMS = {"contextId", "method", "argsJson"}

# Keys whose values are objects/arrays we must not descend into when reading a
# body's top-level keys.
OPAQUE = {"argsJson", "initializationParams", "data", "members", "invitation"}


def strip_noise(src):
    """Blank out comments and string bodies so they cannot look like keys."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
        elif c in "\"'`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            # keep the quotes, blank the body: `"/namespaces"` still matches a
            # route regex run against the ORIGINAL source, not this one.
            out.append(c + "".join(ch if ch == "\n" else " " for ch in src[i + 1 : j - 1]) + c)
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def block_at(src, start):
    """Balanced {...} beginning at the first `{` at or after `start`."""
    i = src.find("{", start)
    if i < 0:
        return None, -1
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i : j + 1], j
        j += 1
    return None, -1


# `name: value`, `"name": value`, and the ES6 shorthand `name` (`{ method, }`),
# which is how `method` reaches the JSON-RPC envelope — miss it and the
# envelope never looks like an `execute` call at all.
KEY = re.compile(
    r'(?:^|[{,])\s*(?:"([A-Za-z_$][\w$]*)"|([A-Za-z_$][\w$]*))\s*(?::|(?=\s*[,}]))'
)


def body_keys(block):
    """Top-level keys of an object literal, plus keys inside any `...` spread.

    The spread matters: the `executorPublicKey` bug hid inside
    `...(cond ? { executorPublicKey } : {})`, which is a nested literal that
    still contributes a top-level key to the JSON that goes out.
    """
    keys, depth, i, n = set(), 0, 0, len(block)
    spread_depths = []
    while i < n:
        c = block[i]
        if c == "{":
            depth += 1
        elif c == "}":
            if spread_depths and depth == spread_depths[-1]:
                spread_depths.pop()
            depth -= 1
        elif block.startswith("...", i):
            spread_depths.append(depth)
        elif c in "([":
            pass
        if depth >= 1:
            m = KEY.match(block, max(0, i - 1))
            if m:
                key = m.group(1) or m.group(2)
                # depth 1 is the body itself; deeper only counts inside a spread
                if depth == 1 or spread_depths:
                    if key not in OPAQUE or depth == 1:
                        keys.add(key)
        i += 1
    return keys


def normalise_route(raw):
    """`/admin-api/namespaces/${teamId}/groups` -> `/namespaces/*/groups`.

    Interpolations become a single `*` so a template literal and a literal
    string for the same endpoint compare equal. Trailing slashes are dropped;
    a query string is not part of the route.
    """
    r = re.sub(r"\$\{[^}]*\}", "*", raw)
    r = r.split("?", 1)[0]
    # A call may build the URL with a base: `${base}/admin-api/groups/${id}/...`
    # or `new URL('/admin-api/blobs', nodeUrl)`. Anchor on the API prefix
    # wherever it appears and drop whatever came before it - mero-docs's
    # reparent call is spelled that way and was invisible while this only
    # handled a leading slash.
    i = r.find("/admin-api")
    if i >= 0:
        r = r[i + len("/admin-api") :]
    elif not r.startswith("/"):
        return ""
    if len(r) > 1 and r.endswith("/"):
        r = r[:-1]
    return r


FETCH_INIT = {"method", "headers", "body", "signal", "credentials", "mode", "cache"}


def unwrap_init(clean, block):
    """Resolve a `fetch`-style init to the object literal it actually sends.

    `adminPost(route, {...})` hands the body directly, but
    `adminFetch(route, { method, headers, body: JSON.stringify({...}) })`
    wraps it. Checking the init's own keys would report `method`/`headers` as
    fields the node refuses, which is noise — the body is what goes on the
    wire. Returns None when the init carries no inline literal body (a
    pre-built variable), because there is nothing here to read.
    """
    keys = body_keys(block)
    if not keys or not keys <= FETCH_INIT:
        return block
    m = re.search(r"\bbody\s*:\s*JSON\.stringify\s*\(", block)
    if m is None:
        return None
    inner, _ = block_at(block, m.end())
    return inner


def scan(path, src):
    problems = []
    clean = strip_noise(src)

    # Every route argument written as a string OR a template literal, followed
    # by a comma (i.e. a call that also passes a body).
    for m in re.finditer(r'(["`])((?:\$\{[^}]*\})?(?:/admin-api)?/[^"`\n]*)\1\s*,', src):
        route = normalise_route(m.group(2))
        allowed = ROUTES.get(route)
        if allowed is None:
            continue
        # The body must be an object literal starting RIGHT HERE. When the
        # call passes a variable (`post(url, request)`) there is nothing to
        # read statically, and walking forward to the next `{` finds something
        # unrelated — a `{ timeoutMs }` options argument, or the function's
        # return literal. That produced four false positives against mero-js,
        # and a check that cries wolf is a check people learn to ignore.
        rest = clean[m.end() :]
        if rest.lstrip()[:1] != "{":
            continue
        block, _ = block_at(clean, m.end())
        if block is None:
            continue
        block = unwrap_init(clean, block)
        if block is None:
            continue
        extra = body_keys(block) - allowed
        if extra:
            line = src.count("\n", 0, m.start()) + 1
            problems.append((line, route, sorted(extra), sorted(allowed)))

    for m in re.finditer(r"\bparams\s*:\s*", clean):
        block, _ = block_at(clean, m.end())
        if block is None:
            continue
        keys = body_keys(block)
        # only an `execute` envelope — other JSON-RPC methods have other params
        if "contextId" not in keys or "method" not in keys:
            continue
        extra = keys - RPC_PARAMS
        if extra:
            line = src.count("\n", 0, m.start()) + 1
            problems.append((line, "POST /jsonrpc params", sorted(extra), sorted(RPC_PARAMS)))

    return problems


def main():
    failures = []
    for app in sorted(os.listdir(APPS)):
        src_root = os.path.join(APPS, app, "app", "src")
        if not os.path.isdir(src_root):
            continue
        for dirpath, dirnames, filenames in os.walk(src_root):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", "generated")]
            for fn in filenames:
                if not fn.endswith((".ts", ".tsx")) or ".test." in fn:
                    continue
                p = os.path.join(dirpath, fn)
                with open(p, encoding="utf-8") as fh:
                    src = fh.read()
                for line, route, extra, allowed in scan(p, src):
                    failures.append(
                        f"{os.path.relpath(p, REPO)}:{line}: {route} — the node refuses "
                        f"{', '.join('`' + k + '`' for k in extra)}; it accepts only "
                        f"{', '.join('`' + k + '`' for k in allowed)}"
                    )

    if failures:
        print("Request bodies the node will reject with a 400:\n")
        for f in failures:
            print("  " + f)
        print(
            "\nEvery core request struct is `deny_unknown_fields` — an extra key fails the\n"
            "whole call. Drop the key, or if core has since added it, update ROUTES in\n"
            "scripts/check-admin-wire.py from the structs named in its docstring."
        )
        return 1

    print("admin/JSON-RPC request bodies: every key is one core 0.11.0-rc.34 accepts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
