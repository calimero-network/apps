# Mero Drive - Calimero Application

A private, multi-workspace document management application built on the Calimero P2P network. Create, edit, and organize documents across isolated workspaces — each with its own encrypted CRDT state.

## Features

- **Multi-workspace**: Create or join workspaces backed by Calimero context groups; switch between them from the sidebar
- **Top-level Folders as Contexts**: Each top-level folder is an independent Calimero context with its own CRDT document state; folder names are shared via the General context's registry
- **Restricted Folders**: Mark folders as open or restricted; non-members see a lock icon and cannot enter
- **Subfolders & Tags**: Hierarchical subfolder tree and tag-based filtering within each context
- **Create Documents**: Add new documents with title, content, and tags
- **Edit Documents**: Rich-text editing with real-time CRDT sync
- **Search**: Find documents by title, content, or tags
- **Archive**: Archive documents you no longer need actively
- **Real-time Sync**: Documents sync across all nodes in the network via CRDT

## Project Structure

```
mero-drive/
├── logic/          # Rust smart contract (compiled to WASM)
└── app/
    └── src/
        ├── api/
        │   ├── AbiClient.ts          # WASM method wrappers (context-aware)
        │   ├── WorkspaceManager.ts   # Workspace CRUD via admin API
        │   └── FolderContextManager.ts # Folder-context lifecycle
        ├── context/
        │   └── WorkspaceContext.tsx  # Active workspace/context React state
        ├── components/
        │   ├── workspace/
        │   │   └── WorkspaceSwitcher.tsx
        │   └── folders/
        │       ├── FolderTree.tsx        # Two-tier: contexts + subfolders
        │       ├── FolderSettingsPanel.tsx
        │       └── FolderDialog.tsx
        └── pages/
            └── home/                 # Main dashboard
```

## Prerequisites

- Node.js 18+ and npm
- Rust toolchain + wasm target: `rustup target add wasm32-unknown-unknown`
- Optional: `wasm-opt` for WASM size optimization

## Quick Start

### 1. Install Dependencies

```bash
npm install
cd app && npm install && cd ..
```

### 2. Build the Logic (Rust)

```bash
npm run logic:build
```

This compiles the Rust contract to WASM and generates the ABI.

### 3. Bootstrap the Network

```bash
npm run network:bootstrap
```

This starts local Calimero nodes and deploys the application.

### 4. Start the Development Server

```bash
npm run app:dev
```

Open your browser and connect to a running node. On first load, create or join a workspace using the switcher in the sidebar.

## API Reference

### Document Operations

| Method | Description |
|--------|-------------|
| `create_document(title, content, tags)` | Create a new document |
| `update_document(doc_id, title?, content?, tags?)` | Update an existing document |
| `delete_document(doc_id)` | Delete a document |
| `get_document(doc_id)` | Get a specific document |
| `list_documents(include_archived)` | List all documents |
| `search_documents(query, include_archived)` | Search documents |
| `get_documents_by_tag(tag, include_archived)` | Filter by tag |
| `set_archived(doc_id, archived)` | Archive/unarchive a document |
| `get_all_tags()` | Get all unique tags |
| `get_stats()` | Get document statistics |
| `get_document_count()` | Get total document count |

### Folder Operations

| Method | Description |
|--------|-------------|
| `create_folder(name, parent_id?, color?)` | Create a subfolder |
| `rename_folder(folder_id, name)` | Rename a subfolder |
| `delete_folder(folder_id, recursive?)` | Delete a subfolder |
| `get_folder_tree()` | Get full subfolder hierarchy |
| `move_document(doc_id, folder_id)` | Move document to a folder |

### Context Group Operations (multi-workspace)

| Method | Description |
|--------|-------------|
| `set_context_name(name)` | Set the human-readable name for a context |
| `get_context_name()` | Get the name of the current context |
| `register_folder(context_id, name, color?)` | Register a folder context in the General registry |
| `update_folder_name(context_id, name)` | Update a folder's name in the registry |
| `unregister_folder(context_id)` | Remove a folder from the registry |
| `get_folder_registry()` | List all registered folder contexts |

### Events

- `DocumentCreated` — emitted when a document is created
- `DocumentUpdated` — emitted when a document is updated
- `DocumentDeleted` — emitted when a document is deleted
- `DocumentArchived` — emitted when archive status changes
- `FolderCreated` / `FolderUpdated` / `FolderDeleted` — subfolder lifecycle
- `ContextNameSet` — emitted when a context name is set
- `FolderRegistered` / `FolderNameUpdated` / `FolderUnregistered` — folder registry events

## Development Workflow

### Rebuild Logic

```bash
npm run logic:build
```

### Run Dev Server with Watchers

```bash
npm run app:dev
```

This runs the web app alongside watchers that:
- Regenerate the TypeScript client when `abi.json` changes
- Sync WASM files to data nodes when they change

### Clean Build

```bash
npm run logic:clean
npm run logic:build
```

## Troubleshooting

### Missing Dependencies

```bash
npm install -D concurrently chokidar-cli
```

### WASM Build Fails

Ensure you have the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

### TypeScript Errors

Clear the Vite cache:

```bash
rm -rf app/node_modules/.vite
```

### Network Issues

Restart the merobox:

```bash
npm run network:bootstrap
```

## Documentation

- [Calimero Documentation](https://docs.calimero.network)
- [Calimero GitHub](https://github.com/calimero-network)
- [Calimero Website](https://calimero.network)

## License

MIT
