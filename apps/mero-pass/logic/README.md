# Mero Pass contract

The replicated state of ONE vault: a Calimero context is a vault. The contract
stores **ciphertext** — every secret name, field and tag list is sealed by the
browser before it arrives (see `app/src/lib/crypto.ts`) — and never decrypts
anything. See the [app README](../README.md) for the whole design.

## State

| Field | Type | Who writes |
|---|---|---|
| `vault_name` | `LwwRegister<String>` | Editors |
| `roles` | `AccessControl` (admin tier + `editor`, `viewer`) | Admins |
| `secrets` | `PermissionedStorage<UnorderedMap<String, Secret>, ProtocolAuthorizer>` | Editors (WRITE), Admins (FULL) |
| `history` | same shape, `Revision` values | Editors, Admins |
| `admin` | same shape: `default_role`, `current_key`, `revoked:<fp>`, `removed:<account>` | Admins |
| `devices` | `AuthoredMap<fingerprint, DeviceKey>` | anyone, own entries |
| `key_wraps` | `AuthoredMap<key:recipient:wrapper, KeyWrap>` | anyone, own slots |
| `audit` | `AuthoredVector<AuditLogEntry>` | appended by every mutation |

A `Secret` is a struct of registers (`kind`, `name`, `tags`, `fields:
UnorderedMap<String, LwwRegister<String>>`, timestamps, `trashed`), so edits to
different fields merge instead of overwriting each other.

Role masks are re-projected after every role change, and are what peers check
at merge: a patched node that skips the API guards still has its forged write
dropped.

## API

The vault
- `init(name)`: the creator becomes the first Admin.
- `vault_info()` → `{ name, current_key, default_role, my_account, my_role }`
- `vault_name()`, `rename_vault(name)` (Editor+)

Roles
- `list_members()` → `[{ account, role, devices }]`. The role is
  `admin|editor|viewer`, `pending` (registered but not admitted), or `removed`.
- `set_role(account, role)` (Admin). The last admin cannot step down.
- `remove_member(account)` (Admin): drops every role, revokes the account's
  devices, and marks it `removed`.
- `set_default_role(role)` (Admin): `editor` or `viewer`.

Devices and keys
- `register_device(fingerprint, public_key, label)`: account and device come
  from the host.
- `list_devices()`, `revoke_device(fingerprint)` (your own device, or Admin)
- `add_key_wraps(wraps)`: skips unregistered or revoked recipients and
  never overwrites.
- `key_wraps_for(recipient)`, `wrapped_pairs()`
- `rotate_key(key_id)` (Admin): needs at least one wrap of the new key first.

Secrets
- `add_secret(id, kind, name, tags, fields)`: `id` is `secret_<32 hex>`,
  chosen by the client so it can be bound into the ciphertext. A duplicate is
  refused.
- `update_secret(id, name?, tags?, fields, rekey)`: only the fields passed are
  touched, and `""` clears one. Superseded values go to history unless `rekey`.
- `trash_secret(id)`, `restore_secret(id)` (Editor+),
  `purge_secret(id)` (Admin, trashed only)
- `get_secret(id)`, `list_secrets()`, `secret_history(id)`

Audit
- `get_audit_logs()`: newest first. Each entry has action, target id, account,
  device and time. There are no names and no values, and redactions stay
  visible.

Events carry ids only: `SecretChanged { secret_id }`, `MembersChanged`,
`KeysChanged`, `VaultRenamed`.

## Build and test

```bash
cargo test -p mero-pass                     # TestHost suite
cargo mero bundle --manifest-path apps/mero-pass/logic/Cargo.toml --dev \
  --app-version 0.0.0 --output /tmp/mero-pass.mpk   # also writes res/abi.json
```

`workflows/e2e.yml` drives two real nodes through admission, key wraps,
concurrent field edits, viewer refusal, trash/restore/purge and removal.
