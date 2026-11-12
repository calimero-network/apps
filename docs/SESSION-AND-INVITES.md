# Sign-in and invitations

How a person signs in to an app and joins someone else's organization from an
invite link, and which tests cover each step. Every app here is a component app
on Calimero 1.0, so both flows come from two workspace packages,
`@calimero-apps/connect` and `@calimero-apps/passkey`, rather than one copy per
app. [COMPONENT-APPS.md](COMPONENT-APPS.md) covers the rest of the stack.

> The audit that used to be here (2026-09-03) described the v1 flows:
> mero-react's `ConnectButton` and `MeroProvider`, the desktop's URL-fragment
> hand-off, and `links.calimero.network/<slug>/join` links. It also described
> the two-node journey that tested them (`e2e/journey/` on
> `packages/e2e-node`). No app uses any of that now, and the merobox and journey
> jobs were removed in #882 and #891. The audit is in git history.

---

## 1. Sign-in

`@calimero-apps/connect` picks the target: the `merod local` nodes under
`vite`, and a Calimero Cloud cluster under `vite build`, checked against the
release floor (`VITE_CALIMERO_MIN_RELEASE`). `@calimero-apps/passkey`'s
`usePasskeySession` runs passkey sign-in and sign-up against that target and
keeps the session in a `SessionStore`. The app shows the package's screens
(`SignInPanel`, `PasskeySignIn`). The account is the passkey, so there is no
password, node URL or login popup.

A native app signs in through the served page (`packages/passkey/src/native.ts`):
the system sign-in sheet opens the page at `#native-sign-in`, the person signs
in there as on the web, and the page seals the session back to the app.

---

## 2. Invitations

An org invite (`client.orgs.inviteCreate(..., { confirm })`) is a passkey
step-up: the inviter's passkey approves it. It names the org and, optionally,
the apps or team it grants.

**The link** (`inviteLink` in `packages/connect/src/invite.ts`) opens the app
at its origin's root, never at the inviter's `/{version}/`, which goes stale
after an upgrade:

```
https://<app origin>/?invite=<token>[&org=…][&team=…][&doc=…][&to=/route][&<app's own>]
```

A served host redirects `/` to the newest release and keeps the query. A dev
server serves it as is.

**Capture** (`createInviteStore(app).capture()`) runs in `main.tsx` before
anything renders. It moves the token, and whatever the link names, off the
address bar into storage, so the token survives a sign-up. The session binds
the invite to the cluster it connects to. The invite is dropped when it is used,
refused or declined, when its person signs out, and when a different account
signs in.

**Ask, then join.** Joining makes you a member of someone else's organization,
so no app joins without asking:

- *Signed out:* the invitation page comes first (`InvitationSignIn`, or the
  app's own `InvitationPage`). It shows the create-account-and-join path, or
  "Join with your passkey" for an account this browser has used before. A
  newcomer's sign-up carries the token and joins in the same step. "Not now"
  shows the usual page and keeps the token.
- *Signed in:* "Join …?" (`JoinInvitation`, or the app's `InvitationPrompt` /
  `InvitationHost`). A link that names its org is checked against the
  account's orgs first, so an existing member is told so instead of spending
  one of the invite's uses.

**Refusals** (`inviteRefusal`): the token is dropped only on the node's
statement that the invite is unknown, spent, expired or its org gone, and
`SPENT_INVITE_COPY` says so plainly. A lapsed session (401), a rate limit
(429), a 5xx or a network failure keeps the token for another try
(`describeRedeemFailure`).

---

## 3. How it is tested

Three layers. No single test drives a link between two separate nodes the way
the v1 journey did. Two people are two accounts on one cluster.

### Shared packages (vitest, mocked client)

| suite | covers | runs in |
|---|---|---|
| `packages/connect/src/invite.test.ts` | `inviteRefusal` / `isSpentInvite` (which errors drop the token and which keep it), `inviteLink` (at the root, never version-pinned), `createInviteStore` (capture, a route that leaves the app refused, kept per cluster, dropped on sign-out and on another account's sign-in), membership checks | components.yml `checks`; ci.yml `frontend` |
| `packages/passkey/src/invite.test.tsx` | the real `usePasskeySession` and screens: a sign-up refused for its invite, the org joined at sign-up and from a redemption, the whole pending invite at a sign-up's join, the invite dropped on sign-out or another account | the same |

### Each app's own tests (vitest, mocked client)

Every app that can be shared tests its invite path against a mocked
`CalimeroClient` (`withRoutes` from `@calimero-apps/connect/testing`), in
`App.test.tsx` or a dedicated file (`App.invitation.test.tsx`,
`SignIn.invitation.test.tsx`, `InviteModal.test.tsx`; the canvas games in
`tests/worlds.test.ts`). The same cases recur, for example in battleships and
mero-stream:

- creating an invite asks for the passkey and shows a link on this frontend's
  origin that names what it opens (a lobby, a room);
- signed out with a pending invite, the invitation page shows instead of the
  landing page;
- signing in from it asks before joining, and Join opens what the link named;
- an invited newcomer creates the account and joins in one click;
- "Not now" joins nothing and forgets the invite;
- a used or expired invite is said plainly and dropped;
- an account already in the org is not redeemed again;
- signing out drops the pending invite.

These run in ci.yml's `frontend` job for every app a change reaches.

### Browser e2e on `merod local` (Playwright, real passkeys)

Both suites run a real cluster (core's release binary at `component-core-tag`)
and give each person their own browser context with Chromium's virtual
authenticator, so every passkey ceremony and step-up is real.

- **Calimero Home** (`apps/mero-home/app/e2e/home.spec.ts`, components.yml
  `browser`): an admin joins from an invitation and lands in the org. Then:
  invite to one app only, list the pending invites by app and revoke one. The
  invited member signs up from the link and gets that app only.
- **Cross-app** (`e2e/cross-app/cross-app.spec.ts`, components.yml
  `cross-app`): Alice makes a workspace in Mero Chat and invites Bob from Home
  to Chat and KV Store. Bob signs up from the link and reaches the org in both
  apps. Then Alice takes him out of Chat only, and Chat's member list follows.

Other apps have no browser suite for invitations. Step 14 of the migration
guide in COMPONENT-APPS.md asks for an invitation between two browser profiles
on `pnpm dev:local <app>` by hand.

### Not covered

- **The served host's redirect** of `/?invite=…` to `/{version}/` with the
  query kept. That is core's behaviour; both browser suites run on dev servers.
- **A native app's sign-in sheet** end to end. `native.test.ts` and
  `nativeApproval.test.tsx` cover the page's half with a mocked client.
