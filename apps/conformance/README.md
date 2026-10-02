# Conformance — every method, node and account

A frontend with no product purpose: a checklist that runs every admin and RPC
call an app makes, under whatever connection the tab holds, and reports one row
per check — name, mode, expected outcome, actual outcome, error text, duration.
The design is `docs/superpowers/specs/2026-10-02-conformance-app-design.md` in
the workspace.

A row passes only when what happened is what its mode expects: `ok`, or a
refusal mero-react names (`NotForAccountError`, `NoRelayError`). Anything else
fails — a bare 403, a refused intent, a value read back wrong — and no row is
ever marked expected because it fails today.

## There is no `logic/` directory

Like `delegated-execution`, this app drives core's `apps/scaffolding-e2e`
contract (public storage, `UserStorage`, `FrozenStorage`, `AuthoredMap`,
`AuthoredVector`, `SharedStorage`) and ships none of its own. So it is outside
`scripts/check-app-metadata.sh`, has no landing page (`apps.config.mjs` does not
list it), and carries a `vercel.json` only because `check-vercel-output.sh`
requires one for every `apps/*/app`.

## Run it

```bash
pnpm install
pnpm --filter conformance test:rig
```

That brings the rig up, runs the matrix in node mode and in account mode, writes
`app/test-results/conformance-report.json`, takes the rig down, and exits
non-zero on any mismatch. `KEEP_RIG=1` leaves the rig running (stop it with
`pnpm --filter conformance rig:down`); `SKIP_RIG_UP=1` reuses one already up.

What it needs, and the defaults it assumes for this workspace:

| env | default | what |
| --- | --- | --- |
| `MEROD_BIN` | `../core-routes/target/debug/merod` | merod built with `--features merod/mock-attestation` |
| `MERO_AUTH_BIN` | `../core-routes/target/debug/mero-auth` | mero-auth from the same core |
| `CORE` | `../core-routes` | for `apps/scaffolding-e2e/relay-ingress` |
| `CONFORMANCE_MPK` | `rig/.state/scaffolding-e2e.mpk` | `cd <core>/apps/scaffolding-e2e && cargo mero bundle --dev --no-icon -o <path>` |
| `TRAEFIK_BIN` | `traefik` on PATH | |
| `MERO_JS_PATH` | unset | a built mero-js checkout to run against instead of the installed one (a paired run, or an unreleased fix); the page and the account minting both use it |

## The rig (`rig/`)

`up.sh` starts, and records the pid of, each of:

- **owner** node (`merod`, embedded auth) on rpc 4910 / swarm 4930;
- **relay** node (`--delegated-access --proxy-identity`, `run --mock-tee`) on
  rpc 4911 / swarm 4931, booting from the owner by address (no mDNS, no public
  boot node);
- **ingress**: mero-auth (account-proof login named by the relay's key) on 4981
  and Traefik on 4980 with core's relay routing, the public attest route and
  CORS — what a browser account talks to;
- **mock cloud** on 4999, answering namespace admitters and account relays with
  the relay (`mock-cloud.py`, from poc/local-relay-rig).

Then the owner founds a namespace, the relay fleet-joins it as a `RelayTee`
(before any invitation exists: an invited relay is a plain member), gets
`CAN_AUTHOR_ON_BEHALF` (512) added to its mask (not written over it: that would drop `CAN_JOIN_OPEN_SUBGROUPS`), the namespace's default mask becomes 231, and two
invitations naming the relay as admitter are minted. Two accounts (A, B) are
minted offline with `app/scripts/mint-account.mjs`. The node session's token is
minted through `/admin/client-key` with exactly the permissions mero-react's
`MultiContext` mode asks for at login, so a route an app's scope lacks fails
here the way it fails for an app.

All state is under `rig/.state/run/` (gitignored), `rig.json` is what the runner
reads, and `down.sh` kills only the pids `up.sh` recorded. Ports are
configurable with `CONF_*` (see the top of `up.sh`).

## The matrix (`app/src/conformance/matrix.ts`)

Two runs. In each, the **primary** session is the run's subject (the owner node;
then account A through the relay) and does the same calls; the **second**
session is always account B. Phases interleave across the two:

1. `p:start` — identity; for an account, the join that gives it its first
   relay; `createNamespace`, the namespace reads; four subgroups (open,
   restricted) and the group writes; three contexts and the context reads and
   writes; one write and read-back per storage kind.
2. *(node run only)* the rig seats the relay in the node's new namespace as a
   RelayTee — what enabling HA does. An account's namespace has its relay from
   the founding.
3. `p:invite` — `createNamespaceInvitation` (a node names its relays as
   admitters, as the account admin does).
4. `s:join` — B joins, joins a context in the namespace and one in an open
   subgroup, joins an open subgroup by inheritance, reads the primary's writes
   (public value, the primary's `UserStorage` slot, the primary as author of its
   `AuthoredMap` entry), writes its own entry, and is refused the shared value.
5. `p:members` — the primary sees B, sees B as the author of B's entry, and
   adds, promotes, re-capabilities and removes B in a restricted group.
6. `s:leave` — B leaves a context, a subgroup and the namespace.
7. `p:teardown` — detach, delete a context, delete subgroups, delete the
   namespace (the last two `NODE_ONLY` for an account).

Credentials are seeded the way the real flows leave them (a node login's token
bundle, an account's delegated connection with no relay), so the Cloud tab's
wallet round trip is not exercised here.

## Which mero-js and mero-react run

Both come from the workspace catalog, like every other app. To run the matrix
against an unreleased mero-js (a paired run, or a fix not out yet), build that
checkout and set `MERO_JS_PATH=<checkout>`: the page and the account minting
both use it, and `vite.config.ts` dedupes mero-react onto it so there is one
signer on the page.
