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

- Each browser has a **device key**: ECDH P-256, stored non-extractable in
  IndexedDB, or sealed under a PIN (PBKDF2, 600k iterations) if you set one.
- Each vault has a **vault key**: 32 random bytes for AES-256-GCM, identified by
  `SHA-256(key)`. It is **wrapped** (ECIES: ephemeral ECDH, then HKDF, then
  AES-GCM) to every entitled device, and the wraps are stored in the contract.
- Every field is sealed with the secret id and field name bound in as
  associated data. An envelope moved to another field or secret fails to open.
- **Rotation** mints a new vault key, wraps it only to devices still entitled
  to it, and re-seals every secret. It runs when an admin removes someone or
  revokes a device. It also runs automatically when an admin next opens a
  vault after a removal at team level.

What the scheme cannot do: take back what a removed member already decrypted.
The UI says to change those passwords.

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

- Six kinds: login, secure note, TOTP, SSH key, payment card, identity.
- Live TOTP codes (RFC 6238, `otpauth://` URIs), computed in the browser.
- Password generator and a strength meter.
- Health tab: weak, reused and old passwords, plus an opt-in breach check (Have I Been
  Pwned k-anonymity: only 5 hex characters of a SHA-1 leave the browser).
- Trash and restore; permanent deletion is admin-only.
- Per-secret history with restore.
- Auto-lock (1/5/15/60 min) and a Lock button. Copied values are cleared from
  the clipboard after 30 seconds.
- Import from Bitwarden, 1Password and Chrome/Edge CSV. Export is an
  **encrypted** backup only; there is no plaintext export.
- Share links: one secret for someone outside the team, sealed inside the URL
  fragment (never sent to a server). A passphrase is optional and an expiry is
  enforced by the viewer. Links cannot be revoked; the dialog says so.
- Live updates over SSE when another member changes something.
- Team admin:
  - invite expiry (1h / 24h / 7d);
  - invite-only vaults;
  - remove a member, which is finished inside each vault by key rotation;
  - revoke devices on the Security page.

## Layout

```
logic/            Rust contract → WASM
  src/lib.rs      state, roles, key registry, secrets
  src/tests.rs    TestHost tests
  workflows/      two-node merobox scenario
app/              React + Vite frontend
  src/lib/        crypto, deviceKey, vaultSession, vaults, totp, health,
                  portability, shareLink
  src/pages/      teams, team, vault, security, share
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
```

The two-node scenario: `merobox bootstrap run apps/mero-pass/logic/workflows/e2e.yml`.

See [logic/README.md](logic/README.md) for the contract API.
