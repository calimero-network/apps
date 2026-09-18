# MeroPass Logic

Rust-based backend logic compiled to WASM for the MeroPass secret management application.

## Overview

This module implements the core secret management functionality using the Calimero SDK, providing:
- A named vault, whose name replicates to every member's node
- Secret CRUD operations with versioning
- Search and tagging capabilities
- Comprehensive audit logging

## Architecture

### Data Structures

- **MeroPassApp**: the state of ONE vault — its name, its secrets, its audit log
- **SecretItem**: an individual secret with metadata and versioning
- **AuditLogEntry**: activity logging for compliance

There is no `Vault` or `VaultMember` type. A context is a vault, so the vault's
members are the context's members and there is nothing for the contract to
store about them.

### Secret Types

1. **Login**: Username/password with URL
2. **Secure Note**: Free-form text content
3. **TOTP**: Time-based one-time password secrets
4. **SSH Key**: Private/public key pairs with optional passphrase
5. **Payment Card**: Credit card information

### Key Features

- **CRDT Versioning**: Conflict-free editing with automatic versioning
- **Membership is the context's**: everyone in the vault's context can read and
  write its secrets. There is no in-contract role registry
- **Audit Logging**: Complete activity tracking
- **Search & Tags**: Advanced filtering and organization
- **Multi-device Sync**: Real-time synchronization via Calimero

## Development

### Prerequisites
- Rust 1.70+
- WASM target: `rustup target add wasm32-unknown-unknown`

### Building

```bash
# Build the WASM, emit res/abi.json and res/state-schema.json, and bundle.
# There is no build.sh: cargo-mero replaced the per-app build scripts.
cargo mero build -p mero-pass
```

### Testing

`cargo test -p mero-pass` drives the contract through `TestHost`. The two-node
behaviour — including the creator's vault name arriving on the invited node — is
covered by the merobox scenario in `workflows/e2e.yml`.

## API Methods

⚠️ This section used to list an API that does not exist in this crate and, as
far as the git history goes, never did — `create_vault`, `invite_member`,
`join_vault`, and every read taking a `vault_id`. There is no vault record in
the contract to take an id of: **a Calimero context IS a vault**, membership is
the context's membership, and inviting someone is an admin-API operation the
frontend performs, not a contract method. What follows is the real surface, as
`res/abi.json` records it.

### The vault itself
- `init(name)` — the vault's name, taken from `createContext`'s
  `initializationParams`. This is the only copy of the name that reaches another
  member's node; a frontend-side label does not.
- `vault_name()` → `String`
- `rename_vault(name)` — any member; concurrent renames resolve
  last-writer-wins, and the change is audited.

### Secrets
- `add_secret(name, secret_type, data, tags)` → `secret_id`
- `update_secret(secret_id, name, data, tags)`
- `delete_secret(secret_id)`
- `get_secret(secret_id)` → `Option<SecretItem>`
- `list_secrets()` → `Vec<SecretItem>`
- `search_secrets(query)` → `Vec<SecretItem>` — name and tags, case-insensitive
- `get_secrets_by_tag(tag)` → `Vec<SecretItem>` — exact tag, not substring

### Audit
- `get_audit_logs()` → `Vec<AuditLogEntry>`, newest first

## Security

- **Context-level Isolation**: Each vault is isolated in its own Calimero context
- **Membership is the context's**: access is granted by joining the vault's
  context, which is an admin-API operation, not a contract call
- **Audit Trail**: Complete activity logging
- **No Plaintext Storage**: All sensitive data is encrypted at the context level

## Dependencies

- `calimero-sdk`: Core Calimero functionality
- `calimero-storage`: storage collections (`UnorderedMap`, `LwwRegister`)
- `serde`: Serialization
- `borsh`: Binary serialization for WASM
- `thiserror`: Error handling
