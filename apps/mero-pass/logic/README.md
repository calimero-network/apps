# MeroPass Logic

Rust-based backend logic compiled to WASM for the MeroPass secret management application.

## Overview

This module implements the core secret management functionality using the Calimero SDK, providing:
- Vault creation and management
- Member invitation and role management
- Secret CRUD operations with versioning
- Search and tagging capabilities
- Comprehensive audit logging

## Architecture

### Data Structures

- **MeroPass**: Main state containing vaults and audit logs
- **Vault**: Individual vault with members, secrets, and tags
- **SecretItem**: Individual secret with metadata and versioning
- **VaultMember**: Member information with role and activity tracking
- **AuditLogEntry**: Activity logging for compliance

### Secret Types

1. **Login**: Username/password with URL
2. **Secure Note**: Free-form text content
3. **TOTP**: Time-based one-time password secrets
4. **SSH Key**: Private/public key pairs with optional passphrase
5. **Payment Card**: Credit card information

### Key Features

- **CRDT Versioning**: Conflict-free editing with automatic versioning
- **Role-based Access**: Owner, admin, and member permissions
- **Audit Logging**: Complete activity tracking
- **Search & Tags**: Advanced filtering and organization
- **Multi-device Sync**: Real-time synchronization via Calimero

## Development

### Prerequisites
- Rust 1.70+
- WASM target: `rustup target add wasm32-unknown-unknown`

### Building

```bash
# Build WASM + ABI
cargo build --target wasm32-unknown-unknown --profile app-release

# Or use the build script
bash build.sh
```

### Testing

The logic is tested through the Calimero workflow system. See `../workflows/workflow-example.yml` for integration tests.

## API Methods

### Vault Management
- `create_vault(name, description, creator_public_key)` → vault_id
- `invite_member(vault_id, member_public_key, role, inviter_public_key)`
- `join_vault(vault_id, member_public_key)`

### Secret Management
- `add_secret(vault_id, name, secret_type, data, tags, member_public_key)` → secret_id
- `update_secret(vault_id, secret_id, name, data, tags, member_public_key)`
- `delete_secret(vault_id, secret_id, member_public_key)`

### View Functions
- `get_vault(vault_id)` → Vault
- `get_vaults_for_member(member_public_key)` → Vec<Vault>
- `get_secrets_in_vault(vault_id)` → Vec<SecretItem>
- `search_secrets(vault_id, query)` → Vec<SecretItem>
- `get_secrets_by_tag(vault_id, tag)` → Vec<SecretItem>
- `get_audit_logs(vault_id)` → Vec<AuditLogEntry>

## Security

- **Context-level Isolation**: Each vault is isolated in its own Calimero context
- **Role-based Permissions**: Granular access control
- **Audit Trail**: Complete activity logging
- **No Plaintext Storage**: All sensitive data is encrypted at the context level

## Dependencies

- `calimero-sdk`: Core Calimero functionality
- `calimero-storage`: Storage collections (UnorderedMap)
- `serde`: Serialization
- `borsh`: Binary serialization for WASM
- `thiserror`: Error handling
