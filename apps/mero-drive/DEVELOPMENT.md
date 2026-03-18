# Private Docs - Development Guide

## Quick Start

### Full Development Mode (with Local Registry)

```bash
pnpm dev:full
```

This starts:
- 🌐 **Local registry** (port 8082) - Stores and serves WASM files
- 🎨 **Vite dev server** (port 5173) - Frontend app
- 👀 **File watcher** - Auto-syncs WASM changes to registry

### What Happens When You Edit Logic?

1. Edit `logic/src/lib.rs`
2. Save file
3. Cargo rebuilds WASM (~5-10s)
4. Watcher detects `logic/res/docs_app.wasm` changed
5. **Auto-submits** manifest to local registry with `file://` URI
6. Registry CLI **copies** WASM to local storage
7. Registry **serves** WASM via HTTP
8. App refetches manifest from registry
9. **Test immediately** in browser at `http://localhost:5173`

---

## Development Modes

### Mode 1: Full Stack (Registry + App + Watcher)
```bash
pnpm dev:full
```
Use this for **package-based development** where the app fetches logic from the registry.

### Mode 2: Basic (App + Watcher)
```bash
pnpm dev
```
Use this for **frontend-only development** without registry integration.

### Mode 3: Merobox Network (App + Watcher + Merobox)
```bash
# Terminal 1: Start merobox network
pnpm network:bootstrap

# Terminal 2: Dev with app
pnpm dev
```
Use this for **network testing** with multiple nodes.

---

## Manual Commands

```bash
# Build logic
pnpm logic:build

# Sync to local registry
pnpm registry:sync

# Check registry status
pnpm registry:status

# Start registry manually
pnpm registry:start

# Reset registry (clean slate)
calimero-registry local reset --force

# Generate TypeScript client
pnpm app:generate-client
```

---

## App Features

### Document Management
- Create, edit, and delete documents
- Rich text editing with TipTap editor
- Auto-save with debounce
- Document preview on home page

### Organization
- **Folders**: Create nested folder structure (similar to Notion)
- **Tags**: Categorize documents with tags
- **Search**: Full-text search across documents
- **Archive**: Archive documents to keep workspace clean

### Views
- **Grid View**: Visual card-based layout
- **List View**: Table-based compact layout
- View preference persists in localStorage

### Editor Features
- Rich text formatting (bold, italic, underline)
- Headings (H1, H2, H3)
- Lists (ordered and unordered)
- Text alignment
- Links
- Highlights
- Code blocks
- Blockquotes

---

## File Structure

```
docs-fj2bytsru5m6bjb0/
├── logic/                      # Rust smart contract
│   ├── src/lib.rs             # Contract code
│   ├── build.sh               # Build script
│   └── res/                   # Build output (gitignored)
│       ├── docs_app.wasm      # Compiled WASM
│       └── abi.json           # ABI schema
├── app/                       # React frontend
│   ├── src/
│   │   ├── App.tsx            # Main app (CalimeroProvider)
│   │   ├── api/               # Generated TypeScript client
│   │   ├── components/
│   │   │   ├── editor/        # Document editor components
│   │   │   ├── folders/       # Folder tree components
│   │   │   ├── landing/       # Landing page components
│   │   │   └── ui/            # Shared UI components
│   │   └── pages/
│   │       ├── home/          # Documents dashboard
│   │       ├── editor/        # Document editor page
│   │       ├── landing/       # Landing/marketing page
│   │       └── login/         # Authentication
│   └── package.json
├── scripts/
│   ├── registry-sync.sh       # Syncs WASM to local registry
│   ├── on-res-change.mjs      # Watcher handler
│   └── sync-wasm.sh           # Syncs WASM to merobox nodes
├── manifest.json              # App manifest (for registry)
└── package.json
```

---

## Troubleshooting

### "Registry not running"

```bash
# Start manually:
pnpm registry:start

# Or check if it's already running:
pnpm registry:status
```

### "WASM file not found"

```bash
# Build it first:
pnpm logic:build
```

### "Port 8082 already in use"

```bash
# Use different port:
calimero-registry local start -p 8083

# Then update app to use new port in app/src/App.tsx
```

### "Client code out of sync"

```bash
# Regenerate after logic changes:
pnpm app:generate-client

# This reads logic/res/abi.json and generates app/src/api/*
```

### "Old WASM cached"

```bash
# Reset registry (removes all stored apps/artifacts):
calimero-registry local reset --force

# Then rebuild and sync:
pnpm logic:build
pnpm registry:sync
```

### "TypeScript errors"

```bash
# Clear Vite cache:
rm -rf app/node_modules/.vite

# Reinstall dependencies:
cd app && pnpm install
```

---

## Architecture

### Frontend (React + Vite)

- **React 18** with TypeScript
- **Vite** for fast development builds
- **TailwindCSS** for styling
- **TipTap** for rich text editing
- **React Router** for navigation
- **Calimero Client** for P2P networking

### Backend (Rust + WASM)

- **calimero-sdk** for contract development
- **Borsh** serialization
- CRDT-based data structures for conflict-free sync
- Document storage with metadata (title, content, tags, folder)

### Data Model

```
Document {
    id: String,
    title: String,
    content: String (HTML),
    tags: Vec<String>,
    folder_id: Option<String>,
    created_at: u64,
    updated_at: u64,
    archived: bool
}

Folder {
    id: String,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
    created_at: u64
}
```

---

## Next Steps

1. **Build the logic:** `pnpm logic:build`
2. **Start full dev:** `pnpm dev:full`
3. **Open browser:** http://localhost:5173
4. **Make changes** to `logic/src/lib.rs` and see them auto-sync!

Happy coding! 🚀
