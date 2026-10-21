# Mero Pass

A peer-to-peer password manager on Calimero. Teams share vaults of secrets that
live on their members' own nodes, sync between them without a server, and are
**end-to-end encrypted in the browser**: no node, disk, log or operator ever
holds a readable secret.

> Alpha. The v2 state layout is not compatible with v1 vaults, and there is no
> migration — create new vaults.

## How it works

| Concept | Calimero primitive |
|---|---|
| **Team** | a namespace. Invitations grant membership of it. |
| **Vault** | a subgroup plus one context running this contract. *Open* vaults admit every team member by inheritance; *invite-only* vaults need their own invitation. |
| **Personal vault** | its own namespace nobody else can join, with a restricted subgroup. |
| **Secret** | an entry whose name, fields and tags are **ciphertext**. Only its kind (login, TOTP, …) is cleartext. |

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
- **Using your node account from another browser:** their browser has to be
  approved, and the request appears on yours.
- Either way, revoke the device from another one (or ask an admin). That
  rotates the vault key, so nothing written afterwards opens for it. What it
  already decrypted can't be taken back: change those passwords.

### Roles inside a vault

| Role | May |
|---|---|
| Viewer | read |
| Editor | add, edit, trash, restore |
| Admin | everything, plus roles, key rotation, and permanent deletion |
| *pending* | has registered a device but has not been admitted yet. Gets no key. |

Roles live in an `AccessControl` registry and are projected as capability
masks onto `PermissionedStorage<_, ProtocolAuthorizer>` stores. Every peer
re-checks them when merging, so a patched node that skips the API checks
still has its forged writes dropped. Newcomers are admitted with the vault's
default role, Editor or Viewer, by the next admin who opens the vault.

### Convergence

- **Per-field registers.** Concurrent edits to different fields of one secret
  both survive; the merobox scenario proves this across two nodes.
- **Tombstones.** Trashing sets a flag rather than removing the entry, so an
  edit racing a trash resolves by HLC instead of resurrecting the secret.
- **History.** Every superseded value is kept, still sealed, and can be
  restored.
- **Append-only audit trail** (`AuthoredVector`). Entries can only be blanked,
  only by their own author, and a blank stays visible as a redaction. No
  entry carries a name or a value.

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
- Live updates over SSE when another member changes something.
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
  - revoke devices on the Security page.

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
once; forgets the application resolved for this node; then calls mero-react's
`logout()`. The theme, the auto-lock delay and the sealed device key stay.

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

Screenshots of every screen, with no node: `SHOTS_CHROMIUM=<chromium> node
app/e2e/shots.mjs --out /tmp/shots`.

## Layout

```
logic/            Rust contract → WASM
  src/lib.rs      state, roles, key registry, secrets
  src/tests.rs    TestHost tests
  workflows/      two-node merobox scenario
app/              React + Vite frontend
  src/lib/        deviceKey, recoveryKey, vaults, totp, health, portability,
                  shareLink (crypto and vaultSession live in
                  packages/mero-pass, shared with mero-bot)
  src/pages/      landing, teams, team, vault, security, share
  src/components/AppShell.tsx   the signed-in frame: rail, top bar, Lock, Log out
  src/auth/       signOut: lock, clear clipboard, forget the app, log out
  src/styles/     frame, shell (pages) and gate (lock screen) CSS modules
  tests/          Playwright, no node: entry, landing, theme, Log out
  e2e/shots/      screenshot harness (fixtures in place of a node)
  e2e/journey/    Playwright against a real node (session: theme, copy, Log out)
```

## Develop

```bash
# Contract: tests, then bundle (which also writes res/abi.json)
cargo test -p mero-pass
cargo mero bundle --manifest-path apps/mero-pass/logic/Cargo.toml --dev \
  --app-version 0.0.0 --output /tmp/mero-pass.mpk

# Regenerate the typed client after any contract change
pnpm -F mero-pass codegen

# Frontend
pnpm -F mero-pass test
pnpm -F mero-pass dev        # http://localhost:5182
pnpm -F mero-pass test:e2e   # Playwright specs in app/tests, no node
MEROD_BINARY=… pnpm -F mero-pass test:journey   # e2e/journey: needs merod and the bundle
```

The two-node scenario: `merobox bootstrap run apps/mero-pass/logic/workflows/e2e.yml`.

See [logic/README.md](logic/README.md) for the contract API.
