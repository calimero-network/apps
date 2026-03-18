# Private Docs - Calimero Application

A private document management application built on the Calimero P2P network. Create, edit, and organize your documents securely.

## Features

- **Create Documents**: Add new documents with title, content, and tags
- **Edit Documents**: Update existing documents with new content
- **Search**: Find documents by title, content, or tags
- **Tag-based Organization**: Categorize documents with tags
- **Archive**: Archive documents you no longer need actively
- **Real-time Sync**: Documents sync across all nodes in the network

## Project Structure

This repository contains two independent parts:

- `logic/` — Rust smart-contract (compiled to WASM)
- `app/` — React frontend (Vite) that talks to the contract via ABI client

## Prerequisites

- Node.js 18+ and pnpm
- Rust toolchain + wasm target: `rustup target add wasm32-unknown-unknown`
- Optional: `wasm-opt` for WASM size optimization

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
cd app && pnpm install && cd ..
```

### 2. Build the Logic (Rust)

```bash
pnpm run logic:build
```

This compiles the Rust contract to WASM and generates the ABI.

### 3. Bootstrap the Network

```bash
pnpm run network:bootstrap
```

This starts local Calimero nodes and deploys the application. Save the `applicationId` and `contextId` from the output.

### 4. Configure the Frontend

Update `app/src/config.json` with the IDs from the bootstrap:

```json
{
  "applicationId": "<your-application-id>",
  "contextId": "<your-context-id>"
}
```

### 5. Start the Development Server

```bash
pnpm run app:dev
```

Open your browser and connect to a running node.

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

### Events

- `DocumentCreated` - Emitted when a document is created
- `DocumentUpdated` - Emitted when a document is updated
- `DocumentDeleted` - Emitted when a document is deleted
- `DocumentArchived` - Emitted when archive status changes

## Development Workflow

### Rebuild Logic

```bash
pnpm run logic:build
```

### Run Dev Server with Watchers

```bash
pnpm run app:dev
```

This runs the web app alongside watchers that:
- Regenerate the TypeScript client when `abi.json` changes
- Sync WASM files to data nodes when they change

### Clean Build

```bash
pnpm run logic:clean
pnpm run logic:build
```

## Troubleshooting

### Missing Dependencies

```bash
pnpm add -D concurrently chokidar-cli
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
pnpm run network:bootstrap
```

## Documentation

- [Calimero Documentation](https://docs.calimero.network)
- [Calimero GitHub](https://github.com/calimero-network)
- [Calimero Website](https://calimero.network)

## License

MIT
