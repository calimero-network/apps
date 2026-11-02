# Mero Pass

A password manager for teams on Calimero. Teams share vaults of secrets that
are **end-to-end encrypted in the browser**: the Calimero nodes that hold a
vault, their disks, their logs and their operators only ever see ciphertext.

Mero Pass runs on Calimero 1.0: the contract is a `calimero:app` component on
core's component SDK (`calimero-app-sdk`, the node's wasmtime runtime), the
frontend talks to **Calimero Cloud** in production and to **`merod local`** in
development through mero-js's `CalimeroClient`
([docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md)).

> Alpha. The component state is not compatible with v1 vaults, and there is no
> migration: create new vaults (see [What changed in the port](#what-changed-in-the-port-and-why)).

## How it works

| Concept | Calimero 1.0 |
|---|---|
| **Team** | an **organization**. Invitations are org invites. |
| **Vault** | an **app instance** of this package in the org. *Open* vaults reach every org member; *invite-only* vaults reach the members of their own invite-only **team**. |
| **Personal vault** | an org nobody else is invited to, marked `{ kind: "personal" }` in its metadata. |
| **Secret** | a row whose name, fields and tags are **ciphertext**. Only its kind (login, TOTP, …) is cleartext. |
| **Account** | a passkey: sign in, or sign up with a new one. |

### Encryption

- Each browser has a **device key**: ECDH P-256, kept in IndexedDB sealed
  under a **passkey** (Touch ID, Windows Hello or a security key, through the
  WebAuthn PRF extension) or a **passphrase** of 8+ characters (PBKDF2, 600k
  iterations), so nothing usable is on disk. Sealing is required: a new
  browser's first screen makes the key sealed, and a browser holding an
  unprotected key from an earlier version must seal it before anything else
  opens (its vault keys move to the sealed key).
- Every browser also has to have a **recovery key** before a vault opens:
  the lock screen makes one and shows its code once, asking for its last
  four characters back, or takes a code already made in another browser.
- Each vault has a **vault key**: 32 random bytes for AES-256-GCM, identified by
  `SHA-256(key)`. It is **wrapped** (ECIES: ephemeral ECDH, then HKDF, then
  AES-GCM) to every entitled device, and the wraps are stored in the contract.
- A new browser of an account that already has one must be **approved** by
  that browser or by a vault admin, comparing a 6-digit code, before any key
  is wrapped to it. An account's first browser, or the replacement for a
  revoked one, is let in without asking.
- Every field is sealed with the secret id and field name bound in as
  associated data. An envelope moved to another field or secret fails to open.
- **Rotation** mints a new vault key, wraps it only to devices still entitled
  to it, and re-seals every secret. It runs when an admin removes someone or
  revokes a device. It also runs automatically when an admin next opens a
  vault after a removal at team level.

What the scheme cannot do: take back what a removed member already decrypted.
The UI says to change those passwords.

### If you lose your device key

This can happen by clearing the browser's site data, losing the machine, or
forgetting the passphrase (the lock screen offers **Reset this browser**).
What you lose is **your copy** of each vault key, not the vault key itself:
the contract keeps a wrap of it for every device that was given it. So the
outcome depends on whether anything else still holds the vault key.

**Your recovery key.** The lock screen makes one the first time a browser
is set up (and the **Security** page can replace it): a 56-character code,
shown once. It is one more holder of every vault key this browser has, and
vaults you open later in this browser get it too. In a browser with nothing,
enter the code on the lock screen's recovery step, or under **Restore** on
the Security page: it rebuilds the recovery key and hands every vault key it
holds to the new browser. Keep the code on paper or in another password
manager. Anyone who reads it can do the same.

**Another of your devices, or a teammate, holds it.**

1. Open Mero Pass in the new or cleared browser. It has you seal a fresh
   device key, and registers it in each vault you open.
2. If your old browser is still listed, the new one waits for approval and
   shows a code. Approve it from another device of yours, or ask a vault
   admin, checking that the codes match.
3. If you have no device left, revoke the lost one on the vault's **People &
   devices** tab (an admin can do it for you). Your new browser is then your
   account's first again and is let in the next time any key holder opens
   the vault. Revoking also rotates the key, which matters if the device was
   stolen rather than wiped.

**Nothing else held it** (a personal or solo vault, one browser, and a
recovery code that was never written down). The secrets cannot be recovered. The node only ever had ciphertext and
wraps to a key that no longer exists, and nobody else can decrypt them: not
the node operator, and not Calimero. This is the other side of "the node
never sees your passwords". There is no reset.

A vault whose key only this browser holds shows a warning with the ways out:
a recovery key, a second device (which then gets its own wrap), or an
encrypted backup from the vault's **Import & export** tab, which restores
into a new vault even if every device is gone.

### If someone steals or gets into your device

- **Locked, protected with a passkey or passphrase:** they have ciphertext
  and a sealed key. A passkey needs your authenticator; a passphrase has to
  be guessed at 600k PBKDF2 rounds per try, which is why it must be 8+
  characters.
- **Unlocked:** they can read what you can. Auto-lock and the Lock button
  narrow that window. (A browser set up before sealing was required held an
  unprotected key until its owner next opened Mero Pass.)
- **Using your account from another browser:** their browser has to be
  approved, and the request appears on yours.
- Either way, revoke the device from another one (or ask an admin). That
  rotates the vault key, so nothing written afterwards opens for it. What it
  already decrypted can't be taken back: change those passwords.

### Roles inside a vault

| Role | May |
|---|---|
| Viewer | read |
| Editor | add, edit, trash, restore, rename the vault |
| Admin | everything, plus roles, key rotation, and permanent deletion |
| *pending* | reaches the vault through the org and has registered a device, but has not been admitted. Gets no key. |

The account that creates a vault is its first Admin. The roles live in the
contract and are checked by every method against the caller
(`logic/src/lib.rs`, "Who may do what"): one leader applies every write in one
log, so there is no peer to forge a write on and no merge to re-check. Who
reaches the vault at all is the organization's (or the vault team's) decision,
made by the node before the contract runs. Newcomers are admitted with the
vault's default role, Editor or Viewer, by the next admin who opens the vault.

### Order and history

- **One log.** Every change is applied in order by the vault's leader. Edits
  to different fields of one secret both stick; on one field the later wins.
- **Trash.** Trashing sets a flag; only an admin purges.
- **History.** Every superseded value is kept, still sealed, and can be
  restored.
- **Append-only audit trail.** Each line names the account that acted and the
  object (a secret id, an account, a fingerprint), never a name or a value.

## Features

- Eight kinds: login, secure note, TOTP, SSH key, payment card, identity, and
  for agents, API key and OAuth connection.
- Live TOTP codes (RFC 6238, `otpauth://` URIs), computed in the browser.
- Password generator and a strength meter.
- Health tab: weak, reused and old passwords, plus an opt-in breach check (Have I Been
  Pwned k-anonymity: only 5 hex characters of a SHA-1 leave the browser).
- Trash and restore; permanent deletion is admin-only.
- Per-secret history with restore.
- Device lock by passkey or passphrase (required), auto-lock (1/5/15/60 min)
  and a Lock button. Copied values are cleared from
  the clipboard after 30 seconds.
- Import from Bitwarden, 1Password and Chrome/Edge CSV. Export is an
  **encrypted** backup only; there is no plaintext export.
- Share links: one secret for someone outside the team, sealed inside the URL
  fragment (never sent to a server). A passphrase is optional and an expiry is
  enforced by the viewer. Links cannot be revoked; the dialog says so.
- Live updates from the app's event stream when another member changes something.
- Device approval with confirmation codes, a recovery key every browser sets
  up, and a warning when only one browser holds a vault's key.
- Agents: an agent (mero-bot) opens a vault with its own `agent` device key
  and reads secrets the way a browser does. Only a vault admin can let one in,
  it is never admitted by itself, and it never hands a key on. Give an agent
  its own vault holding only what it should use: it can read all of it.
- Team admin:
  - invite expiry (1h / 24h / 7d);
  - invite-only vaults;
  - remove a member, which is finished inside each vault by key rotation;
  - remove a lost passkey on the Security page.

## Design

Mero Pass uses the fleet's light glass, the same look as Mero CRM, Calendar
and Issue Tracker, from `@calimero-apps/glass`:

- a cool off-white ground under soft teal-tinted colour fields, frosted
  translucent surfaces with a bright edge, pill buttons, larger radii;
- Figtree, self-hosted by the glass package;
- one near-black ink for the primary action.

`--accent` is only ever a fill (the glass ink, with `--accent-ink` on it);
accent used as text, an icon or an outline is `--accent-text`. The tokens live
in `app/src/index.css`.

Light is the default for everyone. The sun/moon button in the top bar, or
**Security → Appearance**, switches to dark ("smoked glass"); the choice is
saved under `mero-pass:theme` (`app/src/lib/theme.ts`) only when someone
picks it, and an inline script in `app/index.html` applies it before the
first paint.

Every signed-in screen sits in one frame, `app/src/components/AppShell.tsx`
(`app/src/styles/frame.module.css`): a floating glass rail on the left with the
mark, navigation, the vault's own sections and, at the bottom, who you are
with **Lock** and **Log out**; and a slim glass top bar over the page. On a
phone the rail opens as a drawer from the top bar's menu button. The pages
inside the frame share `app/src/styles/shell.module.css`; the lock screen is
`app/src/styles/gate.module.css`.

**Log out** (the rail, the phone drawer, or Security → Your account) runs
`app/src/auth/signOut.ts`: it locks the device key, so every open vault drops
its keys and decrypted items; clears a copied secret from the clipboard at
once; forgets the team and vault it had open last; then ends the Calimero
session and forgets the stored copy. The theme, the auto-lock delay and the sealed device key stay.

The landing page (`app/src/pages/landing/`) is hand-owned rather than generated
from `scripts/landing/`, restyled to the same glass. It follows the Calimero
home page and the Cloud marketing site:

- a hero with a product shot;
- numbered chapters;
- a tinted Cloud band;
- a comparison and an FAQ.

It follows the app's light/dark choice.

A vault is laid out the way 1Password and LastPass lay one out
(`app/src/pages/vault/`):

- **sidebar:** categories by kind, tags, and the vault's tools (password
  health, people, activity, import and export, trash);
- **item list:** searchable, with `/` to focus the search and arrow keys to
  move;
- **detail pane:** each field on a row with a one-click copy, secrets hidden
  until revealed, and the password's strength shown.

A login's tile shows the first letter of its name. It does not fetch the site's
favicon, because that request would tell a third party which sites are in the
vault. On a phone the three panes collapse to one at a time.


## Layout

```
logic/              the contract: a standalone crate on calimero-app-sdk (wasm32-wasip2)
  src/lib.rs        state, roles, device keys and wraps, secrets, audit
  tests/harness.rs  TestApp: every method on core's real wasmtime engine
  scenarios/*.json  neutral steps run by cargo test AND on merod local (CI e2e)
  res/abi.json      the component's ABI, committed, diffed in CI
app/                React + Vite frontend
  src/calimero.tsx  the session: local nodes in dev, the Cloud cluster in production, passkeys
  src/lib/meroPass.ts  the contract, typed (its method list is checked against res/abi.json)
  src/lib/vaultApi.ts  the one adapter from the contract's answers to the vault core's records
  src/lib/vaults.ts    teams (orgs), vaults (app instances), invites, members
  src/lib/          deviceKey, recoveryKey, totp, health, portability, shareLink
                    (crypto and vaultSession live in packages/mero-pass, shared with mero-bot)
  src/pages/        landing, teams, team, vault, security, share
mobile/             native iOS and Android apps (their Calimero 1.0 port is #699; see mobile/README.md)
```

## Develop

```bash
rustup target add wasm32-wasip2
M=tools/component-bundle/Cargo.toml

# Contract: harness + scenarios, then the component and its ABI
cargo test --manifest-path apps/mero-pass/logic/Cargo.toml
cargo run --release --manifest-path $M -- build apps/mero-pass/logic   # res/mero_pass.wasm + res/abi.json

# Everything on merod local: the cluster, the contract, the dev server on :5173
pnpm dev:local mero-pass
pnpm merod-local e2e mero-pass   # every scenarios/*.json as real accounts on three nodes

# Frontend
pnpm -F mero-pass lint && pnpm -F mero-pass typecheck && pnpm -F mero-pass test && pnpm -F mero-pass build
```

In the browser, sign up with a passkey and create a vault: you get your own
instance of the bundle `dev:local` uploaded. Invite a second browser profile
from the team's **Invite** button to try sharing.

## Production

The production frontend is the one packed into the bundle (`frontend-dir`),
served by the cluster from the package's own origin: a Cloud node trusts
passkey ceremonies only from frontends it serves. Build it with
`VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (`app/.env.example`),
then bundle:

```bash
pnpm -F mero-pass build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-pass/logic --key key.json --app-version <version>
```

Known limits on a cluster-served page today: the breach check (Have I Been
Pwned) is off, because the page's CSP lets it reach the cluster's API origins
only; and mero-js's release attestation needs the same exception
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").

## What changed in the port, and why

Same methods, same arguments, same events and the same answers, in the
component SDK's wire shapes. The vault core (`@calimero-network/mero-pass`) and
its public `VaultApi` are unchanged: the app converts the new answers back to
its records in one adapter (`app/src/lib/vaultApi.ts`).

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `vault_info`, `add_secret`, `key_wraps_for`, … | `vaultInfo`, `addSecret`, `keyWrapsFor`, … | the ABI names methods and arguments in camelCase |
| argument and result fields | `public_key`, `key_id`, `my_role`, `created_at`, … | `publicKey`, `keyId`, `myRole`, `createdAt`, … | camelCase on the wire |
| times (`createdAt`, `addedAt`, `replacedAt`, `timestamp`, …) | numbers | decimal strings (`"1700000000000"`) | `u64` travels as a decimal string |
| `init` | `init(name)`: the vault's name as `initializationParams` | `init()` takes nothing; the creator names the vault with `renameVault` (the frontend does it right after creating the instance); `vaultName` is `""` until then | the runtime runs `init` with no arguments |
| who is the first Admin | the context's creator | the account that creates the app instance | same idea, an account instead of a node identity |
| accounts | 64-hex account ids, parsed and checked | the node's account ids, opaque strings; `setRole` refuses an account the organization does not hold (`NotFound`) | accounts are the node's; the org is the membership list |
| errors | `app::bail!("message")`, a string | `422 APP_ERROR` `{ code, fields: { message } }` with code `Forbidden`, `NotFound`, `Invalid` or `Conflict`; `message` is v1's text | `#[app::error]`'s typed shape |
| write rules | capability masks on `PermissionedStorage` (re-checked by every peer at merge) and owner stamps on `Authored*` entries | the same rules as checks in each method against the caller, before anything is written; a refused write is `Forbidden` | one leader, one log: every write goes through a method |
| a device's account, a wrap's author, an audit line's account | the entry's owner stamp | a field the method writes from the caller | the same guarantee, enforced by the method |
| reads | any method | `vaultInfo`, `vaultName`, `listMembers`, `listDevices`, `keyWrapsFor`, `wrappedPairs`, `secretHistory`, `getSecret`, `listSecrets`, `getAuditLogs` are views; calling a write as a view is `NotAView` | a view is answered without touching the log |
| `getAuditLogs` | every line | the newest 1,000 lines, newest first | multi-row reads are pages |
| other lists (`listSecrets`, `listDevices`, `listMembers`, …) | every entry | still every entry (the contract reads page by page) | a vault's secrets must not be cut off |
| audit `device` | the author's node device | always `""` | a component app has no node device to report |
| audit `redacted` | true for a line its author blanked | always `false` | no method blanks a line (none did in v1 either) |
| a cleared field | an empty register, filtered out of answers | the row is deleted; the 64-field cap counts fields with a value | plain data, nothing to merge |
| history order | by `replaced_at`, newest first | by write order, newest first | one log orders every write |
| concurrent edits | per-field LWW registers merged by HLC; trash vs edit by HLC | the log orders them; the later write holds | no CRDT merge under one log |
| events | emitted before the write commits | emitted after it, to everyone the app reaches (`Audience::All`), guests included; they carry ids only | an event describes a write that happened |
| who may call | any member of the context | any owner, admin, member or guest of the org (for an invite-only vault: its team); anonymous `401 UNAUTHENTICATED`, others `404 NOT_FOUND` | the org is the access boundary |
| a member who leaves the team | keeps a synced copy until removed and rotated | stops reaching the vault at once; their vault role stays listed until an admin's client removes it and rotates the key | the node gates every request |
| migrations, v1 state | none in v1 | none, and v1 vaults are not carried over: create new ones | the component SDK has no migrations yet, and the storage layout is new |

The frontend changed with it:

- **Gone:** mero-react's `MeroProvider` and node login, the desktop SSO
  hand-off (`auth/desktopBootstrap`), the application-id resolution
  (`lib/appId`, `useApplicationId`), node-served detection
  (`@calimero-apps/node-served`), the generated `MeroPassClient` and
  abi-codegen, the v1 invitation codec (signed namespace payloads, deflate +
  base58, links.calimero.network / `calimero://` deep links,
  `@calimero-network/mero-platform`), the post-join sync gate, namespace member
  names (`@calimero-apps/names`), the node device list, the Playwright suites
  and screenshot harness (built on mero-react and mocked or real merod 0.x
  nodes; the checklist drops Playwright, and the screens are now tested with a
  mocked client), and the two-node v1 workflow (`logic/workflows/e2e.yml`).
- **New:** `@calimero-apps/connect` picks the target from the build (`merod
  local` under `vite`, the Cloud cluster under `vite build`) and keeps the
  session per app and target; sign-in is a **passkey**; teams are **orgs** and
  vaults **app instances**; an invitation is an **org invite** token in
  `?invite=` (making one is a passkey step-up; opening it after signing in
  redeems it); live updates come from `client.events`; member names are org
  member metadata (your sign-up name is set when you create or join a team);
  the Security page lists your **passkeys** instead of node devices.
- **Same:** every screen, the crypto, the vault session, device approval,
  recovery keys, rotation, share links, import/export, health, TOTP.

The native iOS and Android apps (`mobile/`) move to Calimero 1.0 in their own
PR, #699, against this contract's component ABI; it depends on this port and
lands right after it.
