# Login, desktop hand-off, and invitations across the sixteen apps

A point-in-time audit (2026-09-03) of the three flows every app is supposed to
share, read out of the code rather than from the READMEs, plus what CI does and
does not hold in place afterwards.

The short version: **login is consistent, the desktop hand-off is now consistent
and gated, and invitations are not consistent in any sense** — five separate
implementations of the same job, and four apps with no invitation flow at all.

---

## 1. What "the same" means

All three flows have a canonical shape supplied by `@calimero-network/mero-react`
(`^6.0.4` via the workspace catalog):

| flow | the shared thing |
|---|---|
| Login | `<ConnectButton>` renders the button and owns `<LoginModal>`, which scans `DEFAULT_LOCAL_NODE_PORTS` = `[2428, 2429, 2528, 2529]` with `discoverLocalNodes`, pre-selects the first node that answers, and otherwise offers a URL field validated against `admin-api/is-authed`. That *is* the "click a button, get a popup offering a live localhost or your own URL" flow. |
| Desktop hand-off | `MeroProvider` parses the auth callback out of the URL fragment and adopts the tokens through `resolveTokenAdoption`, provided node trust is anchored. |
| Invitations | `useCreateNamespaceInvitation` to mint, `useJoinNamespace` to redeem, and — for the nine apps on it — `@calimero-network/mero-platform`'s `DeepLinkController` + `PendingIntentStore` to capture a link across the login reload. |

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
| mero-drive | MeroProvider | ✅ | ✅ | ✅ | also mounts `LoginModal` directly |
| mero-forum | MeroProvider | ✅ | ✅ | ✅ | |
| mero-issue-tracker | MeroProvider | ✅ | ✅ | ✅ | |
| mero-meet | MeroProvider | ❌ | ✅ | ✅ | own sign-in page, `connectToNode()` |
| mero-pass | MeroProvider | ✅ | ✅ | ✅ | |
| mero-pixart | MeroProvider | ✅ | ✅ | ✅ | |
| mero-sheets | MeroProvider | ✅ | ✅ | ✅ | |
| mero-sign | **CalimeroProvider** | ❌ | ❌ | ❌ | legacy SDK — see §5 |
| mero-stream | MeroProvider | ✅ | ✅ | ✅ | |
| merraria | *none* | — | — | — | vanilla TS; reimplements the modal |
| scaffolding-e2e | MeroProvider | ❌ | ✅ | ✅ | test harness; drives `discoverLocalNodes` itself |

**Eleven of the fourteen React apps present the identical flow** —
`ConnectButton` into `LoginModal`, nothing hand-rolled. The three that do not
(mero-meet, mero-sign, scaffolding-e2e), plus the two non-React games, each have
a reason; one of them is a real gap:

- **mero-blocks / merraria** reimplement the modal in plain DOM, but on the *same
  primitives* — `DEFAULT_LOCAL_NODE_PORTS`, `localNodeUrl`, `probeNodeHealth`,
  plus a manual `node-url-input`. Same shape, separate code. They are not React,
  so `ConnectButton` is not available to them; the duplication is the cost of
  that, not a divergence in behaviour.
- **scaffolding-e2e** deliberately drives discovery itself — exercising the SDK
  surface is the point of that app.
- **mero-meet** renders its own `DesktopSignInPage` and calls
  `connectToNode(nodeUrl)` on a node it already has, so **there is no node
  picker**. In the desktop that is right: the node came from the shell. Its
  docstring explains the history — the auth guard used to render the *web*
  landing page there, telling a user who had just opened the app from the
  desktop to go download the desktop app. Worth confirming a plain web visitor
  to mero-meet still gets a way in, which this audit did not test.

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

Three apps were in that state: battleships and mero-drive with no anchor, and
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

This is where the fleet is not one thing. Two independent axes diverge: **the
node calls** and **the link format**.

| app | mint / redeem | deep-link plumbing | link codec family |
|---|---|---|---|
| battleships | `createNamespaceInvitation` + `joinNamespace` | — | *(none — no shareable link)* |
| kv-store | `createNamespaceInvitation` + `joinNamespace` + `admit` | mero-platform | `encodeInvitationPayload` |
| mero-blocks | raw `/admin-api/*` `fetch` | mero-platform | `encodeInvite` |
| mero-calendar | app-local `generateInvite` | mero-platform | `encodeInvitation` |
| mero-design | app-local `generateInvite`, `joinGroup` | mero-platform | `encodeInvitation` |
| mero-drive | `createNamespaceInvitation`, `joinNamespace`, `joinGroup` | — | own `useNamespaceInvitation` |
| mero-forum | **none** | — | **none** |
| mero-issue-tracker | `createNamespaceInvitation` + `joinNamespace` | mero-platform | `encodeInvitationPayload` |
| mero-meet | `createNamespaceInvitation` + `joinNamespace` | mero-platform | `encodeInvitation` |
| mero-pass | **none** | — | **none** |
| mero-pixart | app-local `generateInvite` | mero-platform | `encodeInvitation` |
| mero-sheets | `createNamespaceInvitation` + `joinNamespace` | — | `encodeInvitation` (2.3 KB stub) |
| mero-sign | **none** (baked `CONTEXT_ID`) | — | `saveInvitationToStorage` |
| mero-stream | `createNamespaceInvitation`, `joinNamespace`, `joinGroup`, `admit` | mero-platform | `encodeInvite` |
| merraria | raw `/admin-api/*` `fetch` | mero-platform | `encodeInvite` |
| scaffolding-e2e | `createNamespaceInvitation` + `joinNamespace` | — | *(none)* |

### Five codec families for one job

Same purpose, five different exported surfaces:

| family | exports | apps |
|---|---|---|
| `encodeInvitation` | `encodeInvitation` / `decodeInvitation` / `invitationLink` / `invitationFromRaw` / `urlWithoutInvitation` | mero-calendar, mero-design, mero-meet, mero-pixart |
| `encodeInvite` | `encodeInvite` / `decodeInvite` / `inviteLink` / `inviteFromRaw` / `urlWithoutInvite` | mero-blocks, merraria, mero-stream |
| `encodeInvitationPayload` | `encodeInvitationPayload` / `decodeInvitationPayload` / `generateInvitationUrl` / `generateInvitationDeepLink` | kv-store, mero-issue-tracker |
| stub | `encodeInvitation` / `decodeInvitation` only | mero-sheets |
| legacy | `saveInvitationToStorage` / `generateInvitationUrl` / `extractInvitationFromUrl` | mero-sign |

They are copy-paste descendants that have drifted, and the byte counts show it —
`invitation.ts` is 7552 B in mero-calendar, 7494 in mero-design, 7548 in
mero-pixart and 9233 in mero-meet; `invitationIntents.ts` is 5877 / 5873 / 5873 /
5870 / 5816 / 5810 / 5743 B across seven apps. Nothing keeps them in step, and no test
crosses an app boundary.

The one thing that *is* uniform is the URL surface: `?invitation=<payload>` with
`JOIN_ACTION = "join"`, in every app that has a link at all. mero-stream also
accepts a legacy `?invite=`. So links are at least addressed the same way, even
where the payload codec differs.

### Four apps cannot invite or be invited

- **mero-pass** — no invitation code, no `joinNamespace`, no namespace UI. Its
  registry description is *"keep credentials in a vault on your own nodes and
  **share them with namespace members**"*, and `VaultList.tsx` tells the user
  *"Vaults are created when you join contexts. Ask someone to invite you to a
  vault!"* while `VaultDashboard.tsx:232` renders

  ```tsx
  <Button variant="secondary">Invite Member</Button>
  ```

  with **no `onClick`**. A dead button, and the app's headline capability is
  unimplemented.
- **mero-forum** — no invite, no join, no context picker. Whole `src/` is eleven
  files.
- **mero-sign** — bakes `CONTEXT_ID` at build time, so there is nothing to
  invite anyone into.
- **battleships / scaffolding-e2e** can mint and redeem but have no link codec,
  so an invitation cannot leave the app as a shareable URL.

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

### mero-drive is off the catalog

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
| **an app that can be shared has an invite + join path** | *nothing* |
| **the invitation link format is interoperable across apps** | *nothing* |
| **Calimero deps come from the catalog** | *nothing* |

The bottom five are all checkable statically in the shape of the two scripts
above. They are deliberately not added here: each one reds at least one app
today, and which way to resolve that is a product call, not a lint rule.
