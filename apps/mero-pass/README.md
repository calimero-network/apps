# MeroPass - Secret Management App

A secure secret management application built on Calimero that allows teams to share secrets between members with context-level security and multi-device sync.

## Status

🚀 **MeroPass is fully functional and ready for use!**

The application includes a complete secret management system with demo data pre-loaded. All core features are implemented and tested.

## Features

### ✅ Implemented
- **Vault Management**: Create vaults and invite members with different roles (owner, admin, member)
- **Secret Types**: Support for 5 different secret types:
  - 🔐 **Login**: Username/password with URL
  - 📝 **Secure Note**: Free-form text notes
  - ⏰ **TOTP**: Time-based one-time passwords
  - 🔑 **SSH Key**: Private/public key pairs with optional passphrase
  - 💳 **Payment Card**: Credit card information
- **Search & Filtering**: Search secrets by name or tags, filter by secret type
- **Audit Logging**: Track all vault activities with timestamps and member information
- **Version Control**: CRDT-based versioning for conflict-free edits
- **Real-time Sync**: Multi-device synchronization via Calimero
- **Modern UI**: Built with React and Calimero UI components

### 🚧 Planned Features
- Auto-lock UI after inactivity
- Export functionality (disabled in MVP for security)
- Advanced member management
- Secret sharing between vaults
- Enhanced audit log filtering

## Architecture

### Backend (Rust → WASM)
- **Location**: `logic/`
- **Framework**: Calimero SDK
- **Storage**: UnorderedMap for efficient key-value storage
- **Features**:
  - Vault creation and management
  - Member invitation and role management
  - Secret CRUD operations with versioning
  - Tag-based organization
  - Comprehensive audit logging

### Frontend (React + TypeScript)
- **Location**: `app/`
- **Framework**: Vite + React + TypeScript
- **UI Library**: Calimero UI components
- **Features**:
  - Vault dashboard with statistics
  - Secret management forms for all types
  - Search and filtering capabilities
  - Real-time audit log viewing
  - Responsive design

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm
- Rust (for building WASM)
- Docker (for running Calimero network)

### Installation

1. **Clone and install dependencies**:
   ```bash
   git clone git@github.com:calimero-network/mero-pass.git
   cd mero-pass
   pnpm install
   ```

2. **Build the Rust logic**:
   ```bash
   pnpm logic:build
   ```

3. **Generate ABI client**:
   ```bash
   pnpm app:generate-client
   ```

4. **Install frontend dependencies**:
   ```bash
   pnpm app:install
   ```

### Running the Full Stack

1. **Start Calimero network** (requires Docker):
   ```bash
   pnpm network:bootstrap
   ```

2. **Start frontend** (the application ID is already configured):
   ```bash
   pnpm app:dev
   ```

The application will be available at `http://localhost:5173` with demo data pre-loaded.

### Demo Data

The workflow creates a demo vault with the following secrets:
- **GitHub Account** (login type) - Development credentials
- **Google Authenticator** (TOTP type) - 2FA secret
- **Production Server SSH** (SSH key type) - Server access key

**Current Application ID**: `B7ujbnvVAFEHD9DxbnHYyk2UoQkwYkmnxh2KkAKVSSrF`  
**Demo Vault ID**: `1`

## Project Structure

```
mero-pass/
├── app/                          # Frontend (React + Vite)
│   ├── README.md                # Frontend documentation
│   ├── src/
│   │   ├── api/                  # Generated ABI client
│   │   ├── components/           # Reusable UI components
│   │   ├── pages/               # Page components
│   │   │   ├── home/            # Vault list page
│   │   │   └── vault/           # Vault dashboard
│   │   └── App.tsx              # Main app with routing
│   └── package.json
├── logic/                        # Backend (Rust → WASM)
│   ├── README.md                # Backend documentation
│   ├── src/lib.rs               # Main logic implementation
│   ├── Cargo.toml               # Rust dependencies
│   └── build.sh                 # Build script
├── workflows/                    # Calimero workflow definitions
│   └── workflow-example.yml     # Demo data bootstrap
├── .gitignore                   # Git ignore rules
└── package.json                 # Top-level scripts
```

### Documentation

- **[Main README](README.md)** - This file, project overview and setup
- **[Frontend README](app/README.md)** - React frontend documentation
- **[Backend README](logic/README.md)** - Rust/WASM backend documentation

## Key Scripts

- `pnpm logic:build` - Build WASM + ABI
- `pnpm app:generate-client` - Generate typed client from ABI
- `pnpm app:dev` - Run frontend dev server
- `pnpm network:bootstrap` - Start Calimero network with demo data

## Secret Types

### Login
```json
{
  "username": "user@example.com",
  "password": "secure_password",
  "url": "https://example.com",
  "notes": "Additional notes"
}
```

### TOTP
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "issuer": "Google",
  "account": "user@example.com"
}
```

### SSH Key
```json
{
  "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----...",
  "public_key": "ssh-rsa AAAAB3NzaC1yc2E...",
  "passphrase": "optional_passphrase"
}
```

### Payment Card
```json
{
  "card_number": "1234 5678 9012 3456",
  "expiry_date": "12/25",
  "cvv": "123",
  "cardholder_name": "John Doe",
  "notes": "Work credit card"
}
```

### Secure Note
```json
{
  "content": "Your secure note content here",
  "notes": "Additional context"
}
```

## Security Features

- **Context-level Security**: Each vault is isolated in its own Calimero context
- **Member Roles**: Granular permissions (owner, admin, member)
- **Audit Logging**: Complete activity tracking
- **Version Control**: CRDT-based conflict resolution
- **No Plaintext Exports**: Exports disabled in MVP to prevent data leakage

## Development

### Quick Start for Development

1. **Start the development environment**:
   ```bash
   pnpm app:dev
   ```
   This runs both the frontend dev server and watches for WASM changes.

2. **Make changes to Rust logic**:
   - Edit `logic/src/lib.rs`
   - The WASM will automatically rebuild and the ABI client will regenerate

3. **Make changes to frontend**:
   - Edit files in `app/src/`
   - Hot reload is enabled for instant feedback

### Adding New Secret Types

1. Update the secret type validation in `logic/src/lib.rs` (around line 246)
2. Add the new type to the `SecretForm.tsx` component
3. Add UI icons and labels in the form component

### Extending Vault Features

1. Add new methods to the Rust logic in `logic/src/lib.rs`
2. The ABI will automatically regenerate when you save
3. Update the frontend components to use new methods

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

[Add your license here]

## Support

For questions or issues, please open a GitHub issue or contact the development team.