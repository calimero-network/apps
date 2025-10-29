# MeroPass Frontend

React + TypeScript frontend for the MeroPass secret management application.

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite
- **UI Library**: Calimero UI components
- **Routing**: React Router
- **State Management**: React hooks + Calimero context

## Project Structure

```
app/
├── src/
│   ├── api/                    # Generated ABI client
│   ├── components/             # Reusable UI components
│   │   └── SecretForm.tsx     # Secret creation/editing forms
│   ├── pages/                 # Page components
│   │   ├── home/              # Vault list page
│   │   ├── vault/             # Vault dashboard
│   │   └── login/             # Authentication
│   ├── constants/             # App constants
│   └── App.tsx               # Main app with routing
├── public/                    # Static assets
└── package.json              # Dependencies
```

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Key Components

- **VaultList**: Displays all user's vaults with search and filtering
- **VaultDashboard**: Main vault interface with secrets, members, and audit logs
- **SecretForm**: Dynamic form for creating/editing secrets of different types

### Features

- 🔍 **Search & Filter**: Find secrets by name or tags
- 📊 **Dashboard**: Vault statistics and overview
- 📝 **Secret Management**: Create, edit, and delete secrets
- 👥 **Member Management**: View vault members and roles
- 📋 **Audit Logs**: Real-time activity tracking
- 📱 **Responsive**: Works on desktop and mobile

## Building

```bash
# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Environment

The app connects to Calimero network nodes. The application ID is configured in `src/App.tsx` and points to the deployed WASM contract.
