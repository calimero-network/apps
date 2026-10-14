# Mero Org

**One place to run a company on Calimero.** An admin invites a person once. The person makes a
profile once. The admin decides which groups the person belongs to and which applications those
groups may use, and the app turns those decisions into the governance operations each application
namespace needs. A hash-chained log records every change in plain sentences.

Without it, people are invited app by app, groups are created app by app, and nobody can answer
"who is in this company, which teams are they in, and which apps can they reach".

> **Status: v1.** The contract, the reconciler and the app run against a real `merod`
> (0.11.0-rc.83); see [Not in v1](#not-in-v1) for what is left out on purpose.

| | |
| --- | --- |
| Package | `com.calimero.mero-org` |
| Contract | [`logic/src/lib.rs`](logic/src/lib.rs), with 14 `TestHost` tests in [`logic/src/tests.rs`](logic/src/tests.rs) |
| Two-node scenario | [`logic/workflows/org.yml`](logic/workflows/org.yml): every contract method on real nodes, a newcomer claiming on a second node and refused every admin write, and the org state converging |
| Frontend | [`app/`](app): Vite, React and mero-react. People, Groups, Apps, a person's page, Me, Activity and Settings; `/join` handles the invitation link |
| Browser suite | [`app/e2e/org.spec.ts`](app/e2e/org.spec.ts): the admin's side through the UI against a real node |

## Model

Core fixes the shape: a namespace is one application, so a company cannot be one namespace with a
Drive subgroup and a Chat subgroup.

- **The org namespace** is one namespace of this app. Its root group is the company. Every member
  is a member here, and its one context holds the directory, the group tree, the app registry, the
  access rows, the enrolments and the activity log.
- **An app namespace** is one namespace per application the company uses. Its subgroups mirror the
  org groups that have access to it.

Members are **accounts**, nothing else: no kinds, no agents, no invite bookkeeping. An agent that
holds its own account joins like anyone else.

Access is granted to **groups**, never to people. A person reaches an app because one of their
groups does, so offboarding is a group removal, not a per-app audit.

### Joining: the invitation is the only credential

An admin presses Invite and the app mints a namespace invitation for the org namespace (24 hours,
as core clamps it) and shows one link, `/join#ns=…&inv=…`. Nothing is written to the org context.
The newcomer redeems it with their own device, and their **first write is
`claim_membership(display_name, handle)`**, which creates their directory row as `enrolled` and
writes their profile. Only a namespace member can execute anything in the org context, so that
first call already proves they hold an invitation an admin signed. Core keeps no list of minted
invitations, so "invited but not yet joined" is not a state the app can show; People lists a person
from the moment they claim.

The founder has no invitation. After "Create org" they land on a claim screen and claim their own
membership the same way.

### Member status

```
enrolled ──▶ active ──▶ suspended ──▶ left
```

Enrolled: joined and claimed. Active: at least one group membership; the contract moves `enrolled`
to `active` on the first membership and back when the last one goes. Suspended: out of every app
subgroup, kept in the directory. Left: out of every app namespace root and the org namespace root
as well. An org admin cannot be suspended or removed; revoke admin first.

### Enrolment, per (member, app)

```
invitation_pending ──member redeems──▶ joined ──reconciler adds to subgroup──▶ placed
        │ expired (24 h): re-mint                                              │
        └──────────────────────────────────────────────────────────────────────┘
placed ──access removed──▶ removed ──access granted again──▶ placed
```

`invitation_pending` is the app-namespace invitation the reconciler minted under an admin's
account, stored in the org context so the member finds it on any device. `joined` is detected by
listing the app namespace's members.

### Mirrored subgroups

For each (group, app) access row the reconciler keeps one subgroup in the app namespace, a **flat,
Restricted child of the app namespace root**, stamped with metadata `org-group` (the org group id)
and `org` (the org). Restricted, not Open: Open subgroups admit every namespace member with
`CAN_JOIN_OPEN_SUBGROUPS`, and the point is that the org decides who sees what. The members of a
subgroup are exactly the org group's members who are already in that app namespace. Nested org
groups are not nested in the app namespace; they are flattened into their own placements.

Contract timestamps are nanoseconds.

## What the reconciler does

A pure function, `plan` in [`app/src/reconcile/plan.ts`](app/src/reconcile/plan.ts), from (org
state, observed app namespace state) to a list of operations; an executor in
[`execute.ts`](app/src/reconcile/execute.ts) runs them through the signed-in admin's account-aware
admin and records the outcome in `enrolments` and `activity`. Each admin's tab reconciles only the
`ready` apps whose namespace that admin registered, and only subgroups stamped with this org's
namespace id count as mirrored (another org sharing the app namespace keeps its own). For each:

1. **Create missing subgroups** for each org group that has access and no mirrored subgroup yet.
2. **Mint an invitation** for a person who should reach the app but is not in its namespace, unless
   a live, unexpired one is already stored.
3. **Add to the subgroup**, with the access row's capabilities, a person who is in the namespace
   but not yet in the subgroup. Someone already in the namespace needs no ceremony. A placed
   member whose capabilities differ from the access row's is set to the row's value (org admins
   are never re-capped).
4. **Remove** members of a mirrored subgroup whom no group placement wants (app admins are never
   removed), and remove people who left the org from the app namespace root and from the org
   namespace root.
5. **Record** each enrolment's new state, and mark enrolments nobody wants any more `removed`. A
   failed operation writes one `failed` row (not one per round) and the row stays while the retry
   is pending.

It is idempotent: every operation comes from a diff, so re-running it changes nothing once the
namespace matches the org. Two admins' tabs can each create a subgroup for the same org group if
they race; the planner then uses whichever one it observes, and the other is left behind (a known
follow-up). It
runs in the admin's browser while the app is open (on every admin action, on a timer, and from
"Run now"); there is no server. An app is reconciled only once the registering admin holds Admin in
its namespace; until then it is `pending_admin`.

## Trust model, honestly

- **The admin tier is enforced at merge.** Org admins are the writer set of an `AccessControl`
  backing store, so a forged grant from a non-admin is refused by every peer, not only by nodes
  that execute the contract. The admin-written collections themselves (groups, memberships, apps,
  access rows, enrolments) are checked inside the contract (`require_admin`), which binds honest
  nodes only: a peer folds deltas without executing it. That is the known merge-time gap, shared
  with every app today; writer sets on those collections would close it.
- **Profiles are authored.** A profile lives in an `AuthoredMap`, so a person can only edit their
  own row and peers re-check that at apply time.
- **Enrolment rows are written by an admin's session.** The reconciler runs in an admin's browser,
  not in the contract, so an enrolment row says what that admin's session saw and did, not
  something every peer proved.
- **Invitations are bearer-ish.** An invitation stored in the org context, or in a link, lets
  whoever holds it plus a device join as themselves. The org context is members-only and the
  invitation expires in 24 hours, so this is no worse than mailing it.
- **The contract cannot see governance.** It does not know who is in an app namespace; only the
  reconciler observes that. Group membership, subgroup keys and capabilities in each app namespace
  are enforced by core at apply time; Mero Org only requests them.
- **The activity log is tamper-evident, not tamper-proof.** Rows carry `prev_hash`, and
  `verify_activity` re-walks the chain, but a writer with admin rights authors the rows.

## Running it

Building the contract needs **cargo-mero 0.11.0-rc.83 or newer**, the core tag the workspace's
`calimero-sdk` is pinned to in the root `Cargo.toml` (`.github/actions/install-cargo-mero`).

```bash
cargo test -p mero-org
cargo mero bundle --manifest-path apps/mero-org/logic/Cargo.toml --dev --app-version 0.0.0 --output apps/mero-org/logic/dist/com.calimero.mero-org.mpk
pnpm -F mero-org codegen   # after any contract change
pnpm -F mero-org dev       # http://localhost:5197
pnpm -F mero-org typecheck
pnpm -F mero-org test
pnpm -F mero-org build
```

The two-node scenario runs without Docker too:
`merobox bootstrap run --no-docker apps/mero-org/logic/workflows/org.yml`.

Browser suites, as CI runs them (`test:e2e:ci`):

```bash
pnpm -F mero-org test:e2e        # tests/: the landing page, no node
pnpm -F mero-org test:e2e:node   # e2e/: a real merod with the bundle; found the org, grant access, run the reconciler
```

## Not in v1

- Sending email or chat messages: the admin copies the link.
- Device management (list, label, revoke): that stays in the wallet or Desktop.
- IdP sync (Okta, Google groups, SCIM).
- Resource-scoped warrants and the read gate.
- Acquiring Admin in an app namespace founded by someone else: the founder grants it.
- A headless reconciler on an org node. `plan` is transport-free so that is a host change.
- Applications that are not namespace-native (a context without a group).
