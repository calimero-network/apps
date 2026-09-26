# Mero Pass contract: how it is built, and why

This contract is the replicated state of **one vault**. Every member's node
runs it over its own copy, and the copies converge without a server. So each
decision below answers one of three questions:

1. What happens when two members change this at the same time, on two nodes?
2. Who may change it, and is that enforced by *every* node, or only by ours?
3. What does a node, its disk or its operator get to see?

Read [the app README](../README.md) for the product. This page is about
`src/lib.rs`.

- [State at a glance](#state-at-a-glance)
- [The decisions](#the-decisions)
- [How the pieces work together](#how-the-pieces-work-together)
- [What this contract does not protect](#what-this-contract-does-not-protect)
- [Alternatives we tried and dropped](#alternatives-we-tried-and-dropped)
- [API](#api)
- [Build and test](#build-and-test)

## State at a glance

```rust
#[app::state(emits = Event)]
pub struct MeroPassApp {
    vault_name: LwwRegister<String>,
    roles:      AccessControl,
    secrets:    PermissionedStorage<UnorderedMap<String, Secret>, ProtocolAuthorizer>,
    history:    PermissionedStorage<UnorderedMap<String, Revision>, ProtocolAuthorizer>,
    admin:      PermissionedStorage<UnorderedMap<String, LwwRegister<String>>, ProtocolAuthorizer>,
    devices:    AuthoredMap<String, DeviceKey>,   // fingerprint -> browser public key
    key_wraps:  AuthoredMap<String, KeyWrap>,     // "key:recipient:wrapper" -> wrapped vault key
    audit:      AuthoredVector<AuditLogEntry>,
}
```

| Field | Who may write | Enforced at merge by |
|---|---|---|
| `vault_name` | Editors, Admins | API check only (see [decision 12](#12-the-vault-name-is-a-plain-register)) |
| `roles` | Admins | `AccessControl` writer set = the admin tier |
| `secrets` | Editors (`WRITE`), Admins (`FULL`) | capability masks projected from `roles` |
| `history` | Editors, Admins | same |
| `admin` | Admins only | same, with no role masks |
| `devices` | anyone, own entries only | `AuthoredMap` owner stamp |
| `key_wraps` | anyone, own slots only | `AuthoredMap` owner stamp |
| `audit` | appended by every mutation | `AuthoredVector` owner stamp |

## The decisions

### 1. A context *is* a vault

There is no `Vault` type, no vault id, and no member list in the contract.
The vault's audience is the context's audience, which Calimero already
manages. A team is a namespace, and a vault is a subgroup plus one context.

**Why.** Calimero scopes already give each context its own op-log, its own
encryption key and its own member set. A vault record inside a shared context
would duplicate all three, and do it worse: every team member could read every
vault, because reads can't be restricted in a replicated store. One context
per audience is the only way a vault's data reaches *only* its members' nodes.

**Consequence.** Inviting someone is a group operation done through the admin
API by the frontend (`lib/vaults.ts`), not a contract call.

### 2. The contract stores ciphertext and never decrypts

`add_secret` and `update_secret` take envelopes of the form
`mp1.<keyId>.<iv>.<ciphertext>`, sealed in the browser. The contract checks
their size (`MAX_ENVELOPE_LEN`, 128 KiB) and nothing else. The only
cleartext is `kind` (login, totp, …), so the UI can draw an icon before the
vault is unlocked.

**Why.** Calimero encrypts deltas on the wire with the group key, but state at
rest on a node is readable unless the operator enables the encrypted store,
which is off by default. And every member's node holds everything the context
holds. For a password manager, "every member's node, disk and operator can
read every password" is not acceptable. Encrypting in the client is the only
place where the node never sees plaintext.

**Consequence.** The contract can't search, sort by name or validate field
contents. `search_secrets` and `get_secrets_by_tag` from v1 are gone: search
happens in the browser after decryption.

### 3. The client chooses the secret id

`add_secret(id, …)` requires `secret_` + 32 hex characters, and refuses an id
that already exists.

**Why.** The browser binds `secret_id ‖ field_name` into every envelope as
AES-GCM associated data. That stops a malicious member from pasting the
password envelope of secret A into secret B, or into another field of A. The
id has to exist *before* the encryption, so the client picks it.

It is 16 random bytes, as unique as the host's `random_bytes`. The explicit
duplicate check matters: `UnorderedMap::insert` is an upsert, so without it a
colliding or hostile id would silently replace an existing secret. v1 had
exactly that bug with ids built from `time_now()`.

### 4. A secret is a struct of registers, not one record

```rust
#[derive(Default, BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
pub struct Secret {
    kind: LwwRegister<String>,
    name: LwwRegister<String>,
    tags: LwwRegister<String>,
    fields: UnorderedMap<String, LwwRegister<String>>,
    created_at, created_by, updated_at, updated_by,   // LwwRegister each
    trashed: LwwRegister<bool>,
    trashed_at: LwwRegister<u64>,
}
```

**Why.** v1 stored a whole `SecretItem` and merged it with a custom
last-writer-wins over `(version, updated_at, bytes)`. Alice fixing the URL
while Bob rotated the password on another node meant one of them lost their
edit, silently. With one register per field, the two edits land in different
registers and both survive. Within a single field, last writer wins by HLC,
which is the honest rule: there is no meaningful merge of two passwords.

`update_secret` takes only the fields that changed, and the client sends only
what the user touched, so an untouched field can't overwrite a concurrent
change to it. An empty string clears a field.

**Proven on a real network.** The merobox scenario has Bob change `password`
on node 2 while Alice changes `url` on node 1, then asserts both nodes hold
both changes.

`tags` is one envelope over a JSON array rather than an `UnorderedSet`: set
elements would have to be deterministic ciphertext to deduplicate, and that
leaks equality between tags.

### 5. Deletion is a flag first; purging is separate and admin-only

`trash_secret` / `restore_secret` set `trashed`. `purge_secret` removes the
entry, requires the `DELETE` capability, and only works on a trashed secret.

**Why two steps.**
- **Add-wins maps resurrect.** If node A `remove`s a key while node B edits
  it, the edit wins and the secret comes back. A tombstone flag resolves
  edit-vs-trash by HLC instead.
- **Capability split.** Trashing is a `WRITE`, purging a `DELETE`. Editors
  hold only `WRITE`, so an editor can never make a secret unrecoverable, and
  peers enforce that.

### 6. History is its own guarded store of write-once values

Every `update_secret` that changes a value writes a `Revision` holding the
previous envelope, keyed by a fresh random id. `rekey: true` (re-encryption
after a key rotation) writes none, because the plaintext didn't change.

**Why a separate map instead of a `Vector` inside `Secret`.** Revisions are
written once and never edited, so they need no merge logic at all. Keeping
them out of `Secret` keeps `list_secrets` small, and puts them under their own
capability mask. The cost is that `secret_history` scans all revisions and
filters by `secret_id`. That is fine at vault scale; a `SortedMap` keyed
`secret_id ‖ time` is the upgrade path.

Old revisions stay sealed under whatever key wrote them, and the envelope says
which. Members keep old keys in their keyring, so history survives rotation.

### 7. Roles: `AccessControl` projected onto guarded stores

```rust
const CONTENT_ROLES: [(&str, OpMask); 1] = [(ROLE_EDITOR, OpMask::WRITE)];
const ADMIN_ONLY:    [(&str, OpMask); 0] = [];

fn project_roles(&mut self) -> app::Result<()> {
    self.roles.project_onto(&CONTENT_ROLES, &mut self.secrets)?;
    self.roles.project_onto(&CONTENT_ROLES, &mut self.history)?;
    self.roles.project_onto(&ADMIN_ONLY,    &mut self.admin)?;
    Ok(())
}
```

**Why not a `roles: UnorderedMap<Account, String>`.** A role string is a label.
A patched node can skip `if role == "editor"` and write anyway, and every
other node would accept the write. Calimero enforces permissions on a
separate *merge plane*: when a change arrives, each node re-derives who may
write at that point in causal history and verifies the signature. It
understands writer sets and capability masks, not arbitrary code. So:

- `AccessControl` holds the registry. Its writer set *is* the admin tier, so
  only admins can grant or revoke, enforced at merge.
- `project_onto` turns roles into per-account `OpMask`s on each guarded store:
  admins get `FULL`, editors `WRITE`, and viewers are absent.
- `ProtocolAuthorizer` checks the mask for each op, locally *and* at merge.

**Consequences.**
- **Re-projection.** `set_role` and `remove_member` must re-project after every
  change. The registry write and the projection are separate signed actions.
- **Explicit checks.** `get_mut()` on a guarded store does not check the mask
  by itself, so every mutator starts with `require_editor()` or
  `require_admin()`. These are the fast, friendly half of the rule; the merge
  check is the half that holds.
- **Three stores, not one.** The admin settings must be writable by admins
  only, while secrets and history are editor-writable. One store has one mask
  per account.

### 8. `pending` is not `viewer`, and `removed` is sticky

A viewer is an explicit grant (`ROLE_VIEWER`), not the absence of a role. An
account with no role is `pending`. An account an admin removed is marked
`removed:<account>` in the admin store.

**Why.** Clients hand the vault key only to accounts holding *some* role (see
[how the pieces work together](#how-the-pieces-work-together)). If "no role"
meant viewer, anyone who reached the context, including a removed member who
re-registers a device, would be handed the key again automatically. With
`pending` distinct, admission is an admin decision. With `removed` sticky,
automatic admission skips them, and only an explicit `set_role` lets them
back in.

The last admin can't step down (`set_role` refuses), so a vault can't lock
itself out of administration. Inside `set_role`, the grant is written before
`revoke_admin`: an admin demoting themself stops being an admin on the next
line.

### 9. The admin store is a flat map, not a struct

```rust
const ADMIN_DEFAULT_ROLE: &str = "default_role";
const ADMIN_CURRENT_KEY:  &str = "current_key";
const ADMIN_REVOKED:      &str = "revoked:";   // + fingerprint -> "1"
const ADMIN_REMOVED:      &str = "removed:";   // + account     -> "1"
```

**Why.** A `PermissionedStorage` can only guard a collection: its entries
carry the writer stamps that peers verify. A plain `AdminState` struct does
not implement the storage `Data` trait and won't compile under a guarded
store. A string-keyed map of `LwwRegister<String>` is the smallest shape that
is both guarded and mergeable. Revocations are flags rather than removals for
the same add-wins reason as the trash.

### 10. Devices: an `AuthoredMap` whose identity fields come from the host

`register_device(fingerprint, public_key, label, kind)` stores a P-256
public key under its SHA-256 fingerprint. `kind` is `browser` or `recovery`
(a key pair the user holds as a printed code) and anything else is refused. `account` and `node_device` are
taken from `env::account_id()` and `env::device_id()`, never from arguments.

**Why.**
- **`AuthoredMap`, not a guarded store.** Any member, a viewer or a pending
  newcomer included, must be able to register their own key. Otherwise
  nobody could ever be admitted.
- **Only the owner may remove.** `AuthoredMap` stamps each entry with the
  inserting account and lets only that account update or remove it, enforced
  at merge. A member can't delete someone else's device.
- **Host-derived identity.** A member cannot register a key "for" another
  account.
- **Insert refuses an existing key.** So one member can't replace another's
  public key.

**Two ways to revoke.** An owner revoking their own device removes the entry,
so nothing new is wrapped to it. An admin revoking someone else's can't
remove it (it isn't theirs), so the admin store gets a `revoked:` flag that
every wrapper honours.

Why account *and* device: authorization names the person (their laptop and
phone share one role), while the device is recorded so the audit trail and
the device list can tell machines apart.

**Why `kind` is on chain.** Every key holder's browser runs the same
approval rule (below) over the same device list, so they have to agree on
which entries are recovery keys: a recovery key is never auto-entitled,
never approves anyone, and doesn't count as the account's approved browser.

**Device approval is a client rule, not a contract rule.** A new browser is
handed keys only when it is *approved* (it already holds a wrap, because
someone who had the key chose to give it one) or when no other browser of
its account is approved and still listed (an account's first device, or the
replacement for a lost one that was revoked). Anything else waits until one
of the account's approved browsers or an admin approves it, comparing a
6-digit code derived from the fingerprint. The contract can't enforce this:
it can't tell whose browser holds a key, and a key holder can always wrap to
anyone. What it prevents is the useful attack: someone able to call the node
as you (a stolen session, a shared machine) registers a browser and waits
for your teammates' clients to hand it every key. With the rule, they get a
request on your screen instead.

### 11. Key wraps: one slot per (key, recipient, wrapper)

The vault key is 32 random bytes. It is identified by
`keyId = hex(SHA-256(key))` and wrapped to each device with ECIES (the
details are in `app/src/lib/crypto.ts`). The contract stores wraps in an
`AuthoredMap` keyed `"<keyId>:<recipient>:<wrapper>"`.

**Why this key shape.**
- **Squatting.** Keyed only by recipient, the first member to write a
  garbage wrap for a newcomer would block the real one: `AuthoredMap`
  refuses to overwrite. Including the wrapper gives every key holder their
  own slot.
- **Forged keys.** A hostile member *can* wrap a different key and label it
  with the real id. The recipient hashes what it unwrapped and discards
  anything that doesn't match `keyId`. The hash is why forged wraps are
  harmless, and why the contract doesn't need to judge wraps.
- **Wraps are open to all.** Any member holding the key can wrap it to a
  newcomer's device, so admission doesn't wait for the vault creator to come
  online. `add_key_wraps` skips unregistered and revoked recipients.

`rotate_key(key_id)` is admin-only and refuses a key with no wrap yet.
Switching the vault to a key nobody can open would make every later write
unreadable to everyone.

### 12. The vault name is a plain register

`vault_name` is an `LwwRegister`, set in `init` from `createContext`'s
parameters and renamed by editors.

**Why not guarded.** Guarded cells silently drop a value inserted inside
`init`: the cell isn't attached to the state tree yet, `insert` returns `Ok`,
and a later read is empty (the same trap mero-design documents for
`Ownable`). A renamed vault is recoverable and audited, so an API-plane check
is proportionate here. It is the one field whose rule a patched node could
bypass, and the table above says so.

The name is also written to the subgroup's metadata by the frontend, so
people who haven't joined the vault yet can see it. This register is the
authoritative copy for members.

### 13. The audit trail is an `AuthoredVector`

Every mutation appends `{action, target, account, device, timestamp}`. The
target is a secret id, account or fingerprint, never a name: names are
ciphertext, and an audit line echoing them would undo the encryption.

**Why `AuthoredVector`.** Anyone who writes must be able to append, viewers
included. Only an entry's author can blank it (`tombstone` replaces the slot
with a default value), and the blank slot stays, so a redaction is itself
visible (`AuditView.redacted`). An `UnorderedMap` would let any member delete
any entry. `FrozenStorage` would be tamper-proof but can't be iterated, so
the log couldn't be listed.

### 14. Write-once values skip the merge hop

```rust
immutable_value!(Revision, DeviceKey, KeyWrap, AuditLogEntry);
// MergeStrategy::DISPATCHED = false, a no-op Mergeable, a no-op RekeyTarget
```

Each of these is written once under a fresh random key or an owner-stamped
slot, so two replicas never hold different values for one entry. Marking them
undispatched records that fact. Core requires it to be explicit since rc.32,
and it avoids a WASM call per merge that would decide nothing.

### 15. Events carry ids only

```rust
pub enum Event { SecretChanged { secret_id: String }, MembersChanged, KeysChanged, VaultRenamed }
```

Events are sealed with the group key on the wire, but they are also delivered
to every subscriber and often logged. An event carrying a name, or even a
ciphertext envelope, would put secret material somewhere it doesn't need to
be. The frontend treats any event as "re-read the vault".

### 16. Hard limits

`MAX_ENVELOPE_LEN` (128 KiB per value) and `MAX_FIELDS` (64 per secret) cap
what one member can make everyone else replicate. `SECRET_KINDS` is a closed
list so the UI can always render what it receives.

## How the pieces work together

**First open, by the vault's creator** (the creator is the first admin; see `init`):
1. `register_device(fp, pubkey)`.
2. The browser generates a vault key, calls `add_key_wraps([wrap to own fp])`,
   then `rotate_key(keyId)`.

**A newcomer arrives:**
1. They join the context through the admin API and call `register_device`.
   `list_members` shows them as `pending`, and they get no key.
2. The next admin to open the vault calls `set_role(them, default_role)`. Roles
   are re-projected.
3. Any member holding the current key sees an entitled device without a wrap
   (`wrapped_pairs`) and calls `add_key_wraps`.
4. The newcomer's browser reads `key_wraps_for(fp)`, unwraps, checks the hash,
   and can read.

**Another browser of the same account arrives:**
1. It calls `register_device(fp, pubkey, label, "browser")`. The account
   already has an approved browser, so no key holder wraps to it.
2. The account's approved browser, or an admin, sees the request and its
   code, and approves: `add_key_wraps` for every key it holds, old ones too.
   Denying is `revoke_device`.

**A recovery key is created or used:**
1. The browser registers it with `kind: "recovery"` and wraps every key to it.
   A replacement revokes the account's previous recovery key first.
2. Restoring, a browser rebuilds the private key from the code and the
   registered public key, reads `key_wraps_for(recovery fp)`, and wraps every
   key to itself. The restored browser is then approved like any other.

**Someone is removed:**
1. An admin calls `remove_member`: roles are revoked and re-projected, their
   devices get `revoked:` flags, and their account gets `removed:`.
2. The admin's browser mints a new key, wraps it only to devices that are still
   entitled, and calls `rotate_key`.
3. It re-seals every secret with `update_secret(…, rekey: true)`.

If the removal happened at team level (the namespace), the next vault admin to
open the vault finishes steps 1–3 automatically.

## What this contract does not protect

- **What a removed member already saw.** Rotation gives forward secrecy only.
  They keep every value they decrypted before removal.
- **Reads between members.** Any member holding the key can read every secret
  in the vault. Roles govern writes. Read isolation is the vault boundary
  (decision 1): use invite-only vaults for a subset.
- **Metadata.** Secret kinds, counts, timestamps, authors, the audit actions
  and the device list are cleartext to every member's node.
- **The vault name** is guarded at the API plane only (decision 12).
- **Timestamps** come from each node's `env::time_now()`. They order the audit
  log and history for display. Convergence never depends on them: the
  registers merge by HLC.

## Alternatives we tried and dropped

| Tried | Why it went |
|---|---|
| v1: one `SecretItem` merged by `(version, updated_at, bytes)` | Concurrent edits to different fields lost one of them |
| Ids from `time_now()` | Two adds in one millisecond collided, and `insert` upserted over the first |
| Plaintext `data: String` with a "context-level encryption" claim | Readable on every member's disk and by every operator |
| A `Vault` / member list inside the contract | Duplicated what the context already is, and couldn't restrict reads |
| `AdminState` struct inside `PermissionedStorage` | Doesn't compile: a guarded store must hold a collection |
| `FrozenStorage` for the audit trail | Can't be iterated, so the log couldn't be listed |
| Viewer as "no role" | A removed member who re-registered would be handed the key again |
| Wraps keyed by recipient only | The first wrapper could squat the slot with garbage |
| Seeding guarded cells in `init` | The value is silently dropped |

## API

The vault
- `init(name)`: the creator becomes the first Admin.
- `vault_info()` → `{ name, current_key, default_role, my_account, my_role }`
- `vault_name()`, `rename_vault(name)` (Editor+)

Roles
- `list_members()` → `[{ account, role, devices }]`, where the role is
  `admin|editor|viewer|pending|removed`
- `set_role(account, role)` (Admin): the last admin can't step down
- `remove_member(account)` (Admin)
- `set_default_role(role)` (Admin): `editor` or `viewer`

Devices and keys
- `register_device(fingerprint, public_key, label, kind)`: `kind` is
  `browser` or `recovery`
- `list_devices()` → `[{ fingerprint, public_key, label, kind, account, added_at, revoked }]`,
  `revoke_device(fingerprint)` (your own device, or Admin)
- `add_key_wraps(wraps)`, `key_wraps_for(recipient)`, `wrapped_pairs()`
- `rotate_key(key_id)` (Admin): needs at least one wrap first

Secrets
- `add_secret(id, kind, name, tags, fields)` (Editor+)
- `update_secret(id, name?, tags?, fields, rekey)` (Editor+)
- `trash_secret(id)`, `restore_secret(id)` (Editor+), `purge_secret(id)` (Admin, trashed only)
- `get_secret(id)`, `list_secrets()`, `secret_history(id)`

Audit
- `get_audit_logs()`: newest first

## Build and test

```bash
cargo test -p mero-pass                     # 27 TestHost tests, src/tests.rs
cargo mero bundle --manifest-path apps/mero-pass/logic/Cargo.toml --dev \
  --app-version 0.0.0 --output dist/com.calimero.mero-pass.mpk   # also writes res/abi.json
merobox bootstrap run apps/mero-pass/logic/workflows/e2e.yml     # two real nodes
```

`TestHost` runs one node and checks the API plane: roles, trash and purge,
wraps and revocation, field-level updates, audit. `workflows/e2e.yml` runs two
nodes and checks what only replication can show: the key and roles reaching
the other node, concurrent field edits converging, a viewer refused on its
own node, and removal propagating.
