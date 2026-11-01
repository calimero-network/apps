# Mero Pass contract

One vault, as a `calimero:app` component on core's component SDK
(`calimero-app-sdk` at `component-core-tag`, `wasm32-wasip2`). The design notes
(what is stored, who may do what, how v1's collections and write rules map) are
the module docs at the top of [`src/lib.rs`](src/lib.rs); what a client sees
differently from v1 is in [../README.md](../README.md#what-changed-in-the-port-and-why).

Everything sensitive arrives already encrypted by the browser: secret names,
fields and tags are ciphertext envelopes, device keys are public keys, key wraps
are ECIES envelopes. The contract stores them and checks who may write what.

## Methods

64-bit times are decimal strings on the wire. Errors are `422 APP_ERROR` with
`code` `Forbidden` (the caller's vault role does not allow it), `NotFound`,
`Invalid` or `Conflict`, and `fields: { message }`.

| method | kind | who | what |
|---|---|---|---|
| `init()` | init | the creator | the empty vault; the creator is its first Admin |
| `vaultInfo()` | view | anyone the org lets in | `{ name, currentKey, defaultRole, myAccount, myRole }` |
| `vaultName()` | view | | the name, `""` until `renameVault` |
| `renameVault(name)` | call | Editor, Admin | emits `VaultRenamed` |
| `listMembers()` | view | | `[{ account, role, devices }]` by account; role `admin` / `editor` / `viewer` / `pending` / `removed` |
| `setRole(account, role)` | call | Admin | `admin` / `editor` / `viewer`; `NotFound` outside the org; `Conflict` for the last Admin stepping down; re-admits a removed account; emits `MembersChanged` |
| `removeMember(account)` | call | Admin | drops the role, revokes every device the account registered; emits `MembersChanged` |
| `setDefaultRole(role)` | call | Admin | `editor` / `viewer` |
| `registerDevice(fingerprint, publicKey, label, kind)` | call | anyone the org lets in | under the caller's account; `kind` `browser` / `recovery` / `agent`; emits `KeysChanged` |
| `listDevices()` | view | | `[{ fingerprint, publicKey, label, kind, account, addedAt, revoked }]` |
| `revokeDevice(fingerprint)` | call | its account, or Admin | the owner withdraws it; an Admin marks it revoked; emits `KeysChanged` |
| `addKeyWraps(wraps)` | call | anyone the org lets in | `[{ keyId, recipient, wrapper, envelope }]`; answers how many were stored (unknown or revoked recipients, repeats and a non-admin's wraps to an agent are skipped) |
| `keyWrapsFor(recipient)` | view | | `[{ keyId, recipient, wrapper, envelope, wrappedBy }]` |
| `wrappedPairs()` | view | | sorted `keyId:recipient` pairs wrapped by a role holder (an agent's only by an Admin) |
| `rotateKey(keyId)` | call | Admin | needs a stored wrap of the key; emits `KeysChanged` |
| `addSecret(id, kind, name, tags, fields)` | call | Editor, Admin | client-chosen `secret_<32 hex>`; answers the id; emits `SecretChanged` |
| `updateSecret(id, name?, tags?, fields, rekey)` | call | Editor, Admin | only what is passed; `""` clears a field; history unless `rekey` |
| `secretHistory(id)` | view | | superseded values, newest first |
| `trashSecret(id)` / `restoreSecret(id)` | call | Editor, Admin | |
| `purgeSecret(id)` | call | Admin | a trashed secret, its fields and history |
| `getSecret(id)` | view | | the secret or `null` |
| `listSecrets()` | view | | every secret, trashed included |
| `getAuditLogs()` | view | | the newest 1,000 lines, newest first |

Events carry ids only: `SecretChanged { secretId }`, `MembersChanged`,
`KeysChanged`, `VaultRenamed`, to everyone the app reaches.

## Test and build

```bash
cargo test                                   # tests/harness.rs + every scenarios/*.json
cargo clippy --all-targets -- -D warnings
cargo clippy --target wasm32-wasip2 -- -D warnings
cargo run --release --manifest-path ../../../tools/component-bundle/Cargo.toml -- build .
pnpm merod-local e2e mero-pass               # the scenarios on merod local (CI's e2e job)
```

`scenarios/shared-vault.json` is v1's two-node workflow (Docker, two merod 0.x nodes) as accounts on
one vault; `scenarios/access.json` is what v1 enforced in storage (forged
role grants, forged wraps, an agent admitted by an editor) as method checks,
plus the org's access gate.
