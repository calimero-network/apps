# Login, desktop hand-off, and invitations across the sixteen apps

A point-in-time audit (2026-09-03) of the three flows every app is supposed to
share, read out of the code rather than from the READMEs, plus what CI does and
does not hold in place afterwards.

The short version: **login is consistent, the desktop hand-off is now consistent
and gated, and invitations are one system** — one link shape, one capture, ask
before joining, and no paste field anywhere (§4).

---

## 1. What "the same" means

All three flows have a canonical shape supplied by `@calimero-network/mero-react`
(`^6.0.4` via the workspace catalog):

| flow | the shared thing |
|---|---|
| Login | `<ConnectButton>` renders the button and owns `<LoginModal>`, which scans `DEFAULT_LOCAL_NODE_PORTS` = `[2428, 2429, 2528, 2529]` with `discoverLocalNodes`, pre-selects the first node that answers, and otherwise offers a URL field validated against `admin-api/is-authed`. That *is* the "click a button, get a popup offering a live localhost or your own URL" flow. |
| Desktop hand-off | `MeroProvider` parses the auth callback out of the URL fragment and adopts the tokens through `resolveTokenAdoption`, provided node trust is anchored. |
| Invitations | `@calimero-network/mero-react`: `buildInviteLink` to share, `primeInvitationCapture` + `useInviteRedemption` (on mero-platform's `DeepLinkController` + `PendingIntentStore`) to capture an opened link across the login reload, and `InvitationDialog` to ask, join and wait for the data. |

An app that uses those gets the same behaviour for free. An app that
reimplements one gets its own behaviour, and nothing notices.

---

## 2. Login

| app | provider | `ConnectButton` | `packageName` | `registryUrl` | notes |
|---|---|---|---|---|---|
| battleships | MeroProvider | ✅ | ✅ | ✅ | |
| kv-store | MeroProvider | ✅ | ✅ | ❌ | see below |
| mero-blocks | *none* | — | — | — | vanilla TS; reimplements the modal |
| mero-calendar | MeroProvider | ✅ | ✅ | ✅ | |
| mero-design | MeroProvider | ✅ | ✅ | ✅ | |
| mero-docs | MeroProvider | ✅ | ✅ | ✅ | also mounts `LoginModal` directly |
| mero-forum | MeroProvider | ✅ | ✅ | ✅ | |
| mero-crm | MeroProvider | ✅ | ✅ | ✅ | same shell as mero-issue-tracker |
| mero-issue-tracker | MeroProvider | ✅ | ✅ | ✅ | |
| mero-pass | MeroProvider | ✅ | ✅ | ✅ | |
| mero-pixart | MeroProvider | ✅ | ✅ | ✅ | |
| mero-sheets | MeroProvider | ✅ | ✅ | ✅ | |
| mero-standup | MeroProvider | ✅ | ✅ | ✅ | kv-store's shell |
| mero-sign | **CalimeroProvider** | ❌ | ❌ | ❌ | legacy SDK — see §5 |
| mero-stream | MeroProvider | ✅ | ✅ | ✅ | |
| merraria | *none* | — | — | — | vanilla TS; reimplements the modal |
| scaffolding-e2e | MeroProvider | ❌ | ✅ | ✅ | test harness; drives `discoverLocalNodes` itself |

**Eleven of the thirteen React apps present the identical flow** —
`ConnectButton` into `LoginModal`, nothing hand-rolled. The two that do not
(mero-sign, scaffolding-e2e), plus the two non-React games, each have a reason:

- **mero-blocks / merraria** reimplement the modal in plain DOM, but on the *same
  primitives* — `DEFAULT_LOCAL_NODE_PORTS`, `localNodeUrl`, `probeNodeHealth`,
  plus a manual `node-url-input`. Same shape, separate code. They are not React,
  so `ConnectButton` is not available to them; the duplication is the cost of
  that, not a divergence in behaviour.
- **scaffolding-e2e** deliberately drives discovery itself — exercising the SDK
  surface is the point of that app.

### kv-store passes `packageName` without `registryUrl`

Every other MeroProvider app passes both. `mero-js@13.3.0`'s
`buildAuthLoginUrl` sends `package-name` whenever `packageName` is truthy and
adds `registry-url` only if given, and `mero-react@6.0.4` has **no default
registry** — it forwards whatever the app passed. So kv-store's login reaches
the auth frontend with a package name and no registry to resolve it against.

Worth noting because two app comments in this repo assert the opposite rule —
battleships: *"mero-js only forwards `package-name`/`registry-url` to
/auth/login when BOTH are truthy"*. That was true of an earlier mero-js; it is
not true of 13.3.0. Whether the auth frontend defaults the registry when
`registry-url` is absent is the open question, and it decides whether kv-store's
hosted login works. **Untested here** — it needs a real hosted login against
`https://mero-kv-store.vercel.app`, whose registry entry does declare the right
`links.frontend`.

---

## 3. Desktop hand-off (auth skip)

`resolveTrustedNodeUrl` — byte-identical in the mero-react 4.6.1 and 6.0.4 the
fleet pins — is **default-deny**:

```js
if (!candidate)              return { url: initiated ?? null, rejected: false };
if (initiated)               return sameOrigin(candidate, initiated) ? … : { rejected: true };
if (allowedNodeUrls?.length) return allowedNodeUrls.some(sameOrigin)  ? … : { rejected: true };
return { url: null, rejected: true };          // ← neither anchor
```

`initiated` is the node *this* browser context started a login against, and a
desktop hand-off never had one. So an app that anchors neither way drops the
session on every cold desktop open, leaving one console line behind and the
ordinary Connect screen on screen.

Three apps were in that state: battleships and mero-docs with no anchor, and
mero-sheets with an inverted guard that skipped the only case it existed for.
Fixed, tested and gated in `scripts/check-desktop-sso.py`, which runs in the
always-on `metadata` job — see that script's header for the full account. (That
work is a separate change; if `scripts/check-desktop-sso.py` is not in the tree
yet, it has not landed.)

**Still unverified:** the three apps the gate lists as out of scope, because they
never reach `resolveTrustedNodeUrl`. mero-blocks and merraria read `node_url`,
`context_id` and the token out of the URL themselves (`src/net/session.ts`);
mero-sign is on the legacy client. Their hand-off may work, may not — nobody has
checked.

### What the desktop actually sends

From tauri-app's `openAppFrontend`, worth having written down because apps make
assumptions about it:

```
#node_url=…&access_token=…&refresh_token=BROKERED_REFRESH_TOKEN
 &expires_at=…&app-id=…&context_id=…&executor_public_key=…&dev_mode=1
```

Two details that matter:

- **`refresh_token` is a sentinel, not a token.** The desktop keeps the real
  one and stays the sole rotator, intercepting `/auth/refresh` from the injected
  proxy script. Refresh tokens are single-use, so handing every app window the
  same real one would revoke the family and log everyone out. Any app that
  hand-seeds the refresh token from this fragment is broken by construction.
- **The key is `app-id`, not `application_id`.** `mero-js`'s
  `parseAuthCallback` reads `application_id`, so mero-react does **not** pick the
  application id up out of a desktop fragment. mero-sheets and
  mero-issue-tracker read both spellings and seed it themselves; the rest rely on
  resolving it from the registry via `packageName`, which is the documented
  MultiContext path. Not known to be a bug — but it is the kind of near-miss
  worth knowing about, and it is nowhere in a comment today.

---

## 4. Invitations and joining

**One rule for every app: an invitation reaches an app only by its link being
opened.** No app has a field to paste a link or code into, and every app asks
before it joins.

### The link

```
https://links.calimero.network/<slug>/join?invitation=<token>[&…]
```

`<slug>` is the app's deep-link handler, which in this repo is always its
package id (`slug` in `logic/Cargo.toml`). Apps build it with
`buildInviteLink(slug, token, extra?)` from `@calimero-network/mero-react`; there is no
`calimero://` variant and no raw code to share. The token's encoding stays the
app's own (most apps: deflate + base58 of a small JSON envelope; mero-docs and
scaffolding-e2e: base64url JSON), because links already in the wild must keep
working. mero-docs carries `kind`, `id` and `name` beside the token.

### How an opened link reaches the app

The links page opens the app's frontend with the link's query string appended
(`/?invitation=…`) — on the web, as a PWA, or on a cold desktop start. A
desktop launcher that already has the app open sends a `deep-link` event on
`window.__calimero_platform__` instead. Both arrive through one capture:

- `primeInvitationCapture(appKey, { slug })` runs once at boot, before the UI
  mounts (a router would otherwise rewrite the URL first). It strips the token
  from the address bar, keeps the invitation in localStorage until the app acks
  it, and drops a `join` addressed to another app's slug.
- `useInviteRedemption({ parse, redeemer })` delivers it to the app's
  `InvitationDialog`, mounted once at the app root so a link opened on any page
  works. An app whose join does more than join the namespace passes
  `redeem(parsed)` instead of `redeemer`.
  `useInviteRedemption` asks first by default (`awaiting-confirmation` →
  `accept()`), and still asks once the automatic attempts are spent, since the
  link is the only way in.
- `redeemInvitation` joins once, then checks membership: a join that timed out
  but landed is `already-member`, not a failure. `shouldRetain` keeps an
  invitation a later attempt could redeem (no member online) and drops one that
  cannot (expired, invalid, refused); `describeInviteFailure` words the reason.

Every app shows the same prompt, mero-react's `InvitationDialog`: ask (Join /
Not now) → joining → **syncing** → ready (closes by itself), or already a
member, or failed (the reason, with Try again when a retry can help). Syncing
is the stage that matters most: a join returns before the namespace's data has
arrived, and an empty page then looks like an empty workspace. It lasts while
the namespace's just-joined flag is set, which redemption sets and the page
showing that namespace's data clears with
`useJoinSync({ namespaceId, settled, active })` once that data has arrived.
The gate gives up after 30 s unless `active` holds it open, and never waits
past `JOIN_SYNC_MAX_MS` (2 minutes). What counts as arrived depends on what the
page reads:

- **A context's state** (kv-store, battleships' lobby `useLobbyJoinSync`,
  mero-vote's `VotePanel`): a node that has not synced the context fails the
  read (`Uninitialized`), it does not come back empty, so any read that
  succeeds settles, an empty one included. No live event follows the state
  landing, so while syncing the page re-reads every `JOIN_SYNC_POLL_MS` (2 s).
- **A list from the namespace** (mero-stream's `RoomsPage`, mero-updates'
  `UpdatesPage` and `AudiencesPage`, mero-calendar's `TeamCalendarsPage`): an
  unsynced node returns the list empty, so while the namespace is just-joined
  an empty list does not settle. The page passes `active: empty` and re-reads
  every `JOIN_SYNC_POLL_MS`. The cost: a workspace that really is empty when
  the invite is accepted holds the dialog until the 2-minute ceiling.

A read or join that the page makes after the gate has cleared can still beat
the data, so those retry: mero-pixart's `readProjectWithJoinRetry`
(`api/loadProject.ts`) and mero-calendar's `joinCalendarWithRetry`
(`api/joinCalendar.ts`, opening a calendar) retry every 3 s for up to 90 s
while the namespace is just-joined, else 20 s; mero-docs' `redeemInvite`
retries a folder join every 3 s for up to 90 s, stopping at once on a final
refusal (expired, revoked, a 4xx); mero-chess's `joinContextWithRetry` is the
same pattern for its game context.

Its test ids are `invite-prompt` (with `data-stage`), `invite-accept`,
`invite-decline`, `invite-continue`, `invite-done`, `invite-retry` and
`invite-error`; the journey harness relies on them.

### What CI proves

Every app with invitations has a two-node journey (`e2e/journey/`,
`packages/e2e-node`). The harness never pastes: it opens the link itself.

1. **Lifecycle:** alice creates a namespace and copies the link (which must be a
   `links.calimero.network/…/join` link); bob, on the second node, opens it as
   the links page would (`/?invitation=…`), accepts the prompt, and every
   feature then syncs both ways.
2. **Desktop:** on fresh nodes, bob's app is already open inside a stand-in
   launcher. A link for another app must be ignored; then his own arrives as a
   `deep-link` event and must join without a reload, after which the first
   feature reaches him.

The driver says only how to tell the actor has landed (`joined()`, optionally
`beforeJoin()`); the harness opens the link, clicks `invite-accept`, and then
requires the dialog to pass through joining, never fail, and close by itself
once the data has arrived, well under the dialog's 2-minute ceiling. An app
whose page never reports its data settled fails the journey.

---

## 5. The outliers in full

### mero-sign is a different application stack

| | mero-sign | every other app |
|---|---|---|
| SDK | `@calimero-network/calimero-client@^1.25.0-beta.1` | `mero-js` + `mero-react` (catalog) |
| provider | `CalimeroProvider` | `MeroProvider` |
| app id | `clientApplicationId` **baked**: `46M9ayEPkpgDBoDDUP8bHJEwqCN78PXcndTUTW9crGc9` | resolved per-node from `packageName` |
| wasm | `APPLICATION_PATH` → an **S3 URL** for `mero_sign_test_v1.wasm` | the registry bundle |
| context | `CONTEXT_ID` **baked** | discovered |
| login UI | own "Calimero Connection Required" screen | `ConnectButton` |

Three of those are known-broken patterns rather than merely inconsistent ones. An
ApplicationId is assigned **per install**, so a baked one is wrong on every node
but the machine it was copied from — mero-pass's own `index.tsx` carries the
comment recording that lesson. A baked `CONTEXT_ID` has the same problem. And
the baked id is base58, which core rc.27 stopped using. mero-sign is not "an app
that logs in differently"; it is an app on a previous generation of the platform.

### mero-docs is off the catalog

`mero-js@^7.3.2`, `mero-react@^4.6.1`, `mero-ui@^0.3.6` — literal pins while the
catalog is at `^13.2.5` / `^6.0.4` / `^1.5.1`. Six majors behind on mero-js. It
is the only app in the workspace that does not take its Calimero versions from
`pnpm-workspace.yaml`, which is also why the desktop-hand-off fix had to reason
about 4.6.1 separately.

---

## 6. What CI holds in place

| invariant | enforced by |
|---|---|
| package id, slug, frontend origin, runtime floor | `scripts/check-app-metadata.sh` |
| registry + launcher icon is real, square, ≥512², mask-safe | `scripts/check-app-icons.py` |
| every MeroProvider app can adopt a desktop hand-off | `scripts/check-desktop-sso.py` |
| **login uses the shared `ConnectButton` / `LoginModal`** | *nothing* |
| **`registryUrl` is passed alongside `packageName`** | *nothing* |
| **an app that can be shared has an invite + join path** | the two-node journey (`packages/e2e-node`): invite, open the link on node 2, accept |
| **the invitation link format is interoperable across apps** | the journey asserts a `links.calimero.network/<slug>/join` link; capture drops another app's |
| **Calimero deps come from the catalog** | *nothing* |

The three still marked *nothing* are all checkable statically in the shape of the two scripts
above. They are deliberately not added here: each one reds at least one app
today, and which way to resolve that is a product call, not a lint rule.
