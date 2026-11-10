# @calimero-apps/connect

Where a component app's frontend connects, from the build's environment: the
`merod local` nodes on the dev server, a Calimero Cloud cluster (by name,
through the cloud's node directory, with failover) in a production build, both
through mero-js's `CalimeroClient`.

```ts
import { browserPasskey } from "@calimero-network/mero-js";
import { appSource, connectTarget, createClient, SessionStore } from "@calimero-apps/connect";

const target = await connectTarget(import.meta.env, { app: "my-app" });
const client = await createClient(target);
const sessions = new SessionStore("my-app", target);
if (!sessions.restore(client)) await client.signIn(browserPasskey());
sessions.sync(client);
const app = await client.createApp("my-app", appSource(import.meta.env, "com.calimero.my-app"));
```

| | local | cloud | node |
|---|---|---|---|
| chosen when | `vite` (`DEV`), or `VITE_CALIMERO_TARGET=local` | `vite build`, or `VITE_CALIMERO_TARGET=cloud` | `VITE_CALIMERO_TARGET=node` |
| nodes | `VITE_CALIMERO_NODES`, default `127.0.0.1:2501-2503` | the cluster serving the page; else `VITE_CALIMERO_CLUSTER` (optional override) via the node directory; else the primary cluster running the app's package (`GET {directory}/package/{package}`); `VITE_CALIMERO_ZONE`, `VITE_CALIMERO_DIRECTORY` | `VITE_CALIMERO_NODES` (required, `https`), no directory |
| trust | mock quotes (`allowMock`) | signed mero-tee release `>= VITE_CALIMERO_MIN_RELEASE` (required) | the same as cloud |
| instances from | `VITE_CALIMERO_BUNDLE` (written by `pnpm dev:local`) | the package (`VITE_CALIMERO_PACKAGE`, `VITE_CALIMERO_VERSION`) | the same as cloud |

The target is fixed when the service starts, from its build's environment. The
person using the app never chooses a cloud, a cluster or a node: they sign in
or up with a passkey on the one target the service was built for. A `node`
target is a `cloud` target with `direct: true`, its `nodes` set and `cluster`
naming the first node's host, so code that handles `local` and `cloud` handles
it unchanged.

On a page the cluster serves from the app's bundle (the production frontend:
the only origin a Cloud node trusts for an app's passkey ceremonies besides its
own), `connectTarget` takes the cluster's API URLs from
`/.well-known/calimero.json` instead of the directory, which that page's CSP
does not allow. That frontend is built once and served by every cluster it is
deployed to, so it needs no `VITE_CALIMERO_CLUSTER`: on a served page a build
without one connects to the nodes that serve it, keyed by the page's host
(`{label}.{apps_domain}`, one per package and cluster). `VITE_CALIMERO_MIN_RELEASE`
is required everywhere: it is the attestation floor. Off a served page, a build
without a cluster asks the directory where the app's package runs
(`GET {VITE_CALIMERO_DIRECTORY or mero-js's DEFAULT_DIRECTORY}/package/{package}`,
the package from `VITE_CALIMERO_PACKAGE` or `connectTarget`'s `package` option)
and connects to its primary cluster's nodes, the build's zone first, then
heaviest first: a frontend the developer hosts needs no cluster name.
When nothing runs the package (404), or the build has no floor or package,
it throws `NotServedError` (a `ConfigError`), which an app shows as "open the app
from Calimero Cloud" with a link to `CLOUD_CONSOLE`. Any other misconfigured
production build throws `ConfigError` instead of connecting anywhere.
`resolveTarget` and `withServedNodes`, which `connectTarget` is built on, are
still exported for code that only reads the build's environment. Sessions are stored per app and per target. See
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).

Signing up follows the cluster's sign-up policy (core's `GET /sign-up`):
`readSignUpPolicy(client)` reads it (`null` on a node without the route, which
blocks nothing), `signUpAccess(policy, hasInviteToken)` says whether this page
may create an account (`allowed`, `needs-invite`, `closed`, `unknown`),
`signUpNotice` says why not, and `signUpInvite(policy, token)` is the invite to
send with `signUp` where the policy requires one. `describeSignInError(error,
access)` answers a passkey the cluster does not know with the way in for that
policy, and a refused sign-up (`SignUpRefused`) by its reason.

## Invites

One invite flow for every app (`invite.ts`), so no app keeps its own copy of
capture, storage, the spent check or the membership pre-check:

```ts
import { createInviteStore, inviteLink, isSpentInvite, canCreateIn } from "@calimero-apps/connect";

export const invites = createInviteStore("my-app", { keep: ["forum"] }); // module level
invites.capture(window.location, { basename }); // main.tsx, before React mounts

// Minting a link: at the origin's root, never the inviter's `/{version}/`.
inviteLink(token, { org, team, doc, route: "/forums/42", extra: { forum } });
```

- **The link** is `/?invite=<token>&org=&team=&doc=&to=<route>&<the app's own>`.
  A served host's root redirects to the newest release with the query kept
  (core's `fix/served-redirect-query`). Until every cluster runs that fix, pass
  `root: basename` to pin the link as before. `capture` reads both forms: the
  route from `to`, else from a version-pinned path relative to `basename`. It
  never takes a route that leaves the app (`//host`, a scheme).
- **The store** keeps one pending invite per app: `pending()` (the same object
  until it changes, for `useSyncExternalStore`), `token()`, `drop()`, `put()`,
  `subscribe()` (also told of changes in another tab). `bind(target)` keeps it
  under that cluster's key from then on. `signedIn(account)` holds it for that
  account and drops it when another account signs in; `signedOut()` drops it.
  `usePasskeySession({ invites })` makes all of those calls.
- **Spent or not**: `inviteRefusal(error)` is the node's word that the invite
  is done (`unknown-invite`, `expired-invite`, `org-gone`), at a sign-up
  (`SignUpRefused`) or a redemption (`400 REJECTED`). It reads core's old and
  rc.12 sentences. `isSpentInvite` is its boolean. Anything else keeps the
  token: 401 (the session lapsed), 408, 429, a 5xx or a network failure.
  `describeRedeemFailure(error)` says which, with the next step.
- **Membership**: `memberOf(client, org)` before redeeming a link that names
  its org (a member would spend a use for nothing), `joinedOrg(redeemed)` for
  the org a redemption joined.
- **Who may add an instance**: `canCreateIn(client, org, team?)` applies core's
  `CREATE_APP` rule (`Org::may`) to `getOrg`. Admins and owners may, as do a
  team's leads (also of a team above it) and members granted it on the team's
  row or org-wide. A plain member may not by default. `null` when it cannot
  tell. `mayCreateIn(org, account, team?)` is the same on an org already read,
  and `askAnOwnerCopy("a calendar")` is what to show instead of the button.

## Serving each instance its own release

An app's frontend ships in its signed `.mpk` and works only with that
release's backend, so each instance is served the frontend of the release it
runs (`release.ts`). Call it where a person enters an instance:

```ts
import { followInstanceRelease } from "@calimero-apps/connect";

// true: the page is moving to the instance's release; stop here.
if (await followInstanceRelease({ client, app: appId })) return;
```

React apps use `useInstanceRelease(client, appId)` from `@calimero-apps/passkey`.

- **When it moves**: on a page a node serves (`{label}.{apps domain}/{version}/`,
  `servedRelease(href)`) whose release is not the one the instance runs, as its
  scope's version report says (`instanceRelease(client, app)`:
  `package.version`, exact once core records each instance's release). Never in
  development or on a static host.
- **Where to**: `/app/{app}/{route}?{query}#{fragment}` (`instanceReleaseUrl`),
  which core redirects to `/{version}/{route}` of the instance's release, so
  the person lands in the same place. Apps that keep the open instance in
  storage rather than the route reopen it from there. `location.replace`, so
  Back does not return to the old release.
- **Never a loop**: the tab notes the release it went for
  (`RELEASE_FOLLOW_KEY`, `sessionStorage`) and stays on a page that still
  differs after the move (a core without the record redirecting to another
  release of the same WASM); arriving clears the note. With no storage for
  the note it never moves.

## Organizations

An account is in organizations made for other apps (a Mero Blocks world, a
chat workspace). An app lists, resumes and enters only its own (`orgs.ts`):

```ts
import { appSource, orgsWithApp, otherOrgs } from "@calimero-apps/connect";

const source = appSource(import.meta.env, "com.calimero.my-app");
const mine = await orgsWithApp(client, source);   // the default list: orgs holding this app
const others = await otherOrgs(client, source);   // "Connect to an existing organization"
await client.createApp(name, source, { org: others[0].orgId }); // only on the person's choice
```

- **The default list** is `orgsWithApp(client, source)`: the account's
  organizations (`/me`) that hold an instance of this app (`listApps` by
  package, or by bundle in development). Nothing outside it is preselected or
  entered automatically. With none, the primary action is creating a new
  organization for the app.
- **Connecting an existing organization** is a separate, secondary choice:
  `otherOrgs(client, source)` lists the rest, where the account may create
  apps (`CREATE_APP`, as `canCreateIn` decides it; `{ includeNotAllowed: true }`
  keeps the others with `canCreate: false`). Each carries `holds` (the
  instances it holds that the account reaches) and `label`, what it holds in
  words. On a node with app teams (core#4890) the label is the org's apps by
  name from `listAppTeams` ("Mero Blocks, Mero Chat (not yours)"), so an org
  whose apps are closed to the account no longer reads "No apps yet"; `apps`
  and `mode` carry the teams. A node without the route (404), or a legacy org
  with no app teams, keeps the instance label: "Mero Blocks: overworld". In
  an org that has app teams, only its owners and admins may add an app that
  has no team there (core#4890), so `canCreate` is `false` for anyone else.
  `<ConnectExistingOrg>` in
  `@calimero-apps/passkey` is the list every React app shows for it.
- **Organizations that start empty**: an app that creates its org first and
  its instances later (a forum space, a password team) records it with
  `markOrgFor(client, org, source)` (`{ createdFor: <package> }` merged into
  the org's metadata) and lists with `orgsWithApp(client, source, { marked:
  true })`, so a space made there stays listed before it holds anything.
  `otherOrgs` leaves those out.
- `myOrgs(client)` is `/me`'s organizations, sorted; `appFilter(source)` the
  `listApps` filter for a source; `packageTitle`, `holdingsLabel` and
  `appTeamsLabel` the words.

## App teams

One organization, many apps, separate access (`appTeams.ts`; core#4890,
#4891). Each app installed in an org has its own **app team** (a top-level
team marked with its package), its instances use team access on it, and an
in-app invite names it, so the person gets that app and no other. The node
derives the org's mode: `legacy` (no app teams: organization access, as
before), `standalone` (open app teams: the org is one app's, members may
invite) or `shared` (closed app teams: each app lists who is in it; leads and
admins invite unless "members may invite" is on for that app). Calimero Home
(`apps/mero-home`) is where a shared org's people, invites and apps are managed.

```ts
import { appAccess, ensureAppTeam, inviteToApp } from "@calimero-apps/connect";

const access = await appAccess(client, org, PACKAGE); // { mode, team, member, manages, mayInvite }
if (access.mayInvite) {
  const { token } = await inviteToApp(client, org, PACKAGE, { role: "member", passkey });
  inviteLink(token, { org });
}
await ensureAppTeam(client, org, PACKAGE, passkey); // admin: the app's team, made if missing
```

- `appTeams(client, org)` is `listAppTeams`, or `null` when the node cannot
  say (404: a node before core#4890, or an account outside the org).
  `appTeamOf(client, org, pkg)` picks one package's team out of it.
- `createAppTeam(client, org, pkg, passkey, { name, instances, shared })` is
  core's `ScopeApps` for one package (owner or admin, one passkey): the team is
  found or made, everyone who reaches the package's org-access instances keeps
  them, and they move onto the team. `instances: []` for a fresh install;
  `shared: true` closes every app team. `ensureAppTeam` reads first and only
  creates when there is none.
- `inviteToApp(client, org, pkg | pkgs, { role, passkey, teams, ttlSecs, uses })`
  names the app teams. In a legacy org, or on an older node, it is the
  org-wide invite apps send today; in an org with app teams a package without
  one throws `NoAppTeamError` instead of widening to the whole org.
- `appTeamMembers(orgView, teamId, mode)` is who is in an app team, from
  `getOrg` alone, as core decides it: its rows, and for an open team every org
  member not taken out of it who joins open teams (not a guest once the org
  has app teams). An app's member list reads it instead of the org's roster.
- `appAccess(client, org, pkg)` is what an app's invite button and member
  menu decide on: `manages` (owner, admin, the team's lead) and `mayInvite`
  (a manager, or someone in the app whose own row, or the org's caps with the
  team's default, hold `INVITE_MEMBERS`). `membersMayInvite(team)` reads the
  per-app switch and `setMembersMayInvite(client, org, team, on, passkey)`
  flips it (`setTeamDefaultCapabilities`, other bits kept).
