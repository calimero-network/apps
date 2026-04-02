# KV Store - Development Guide

## Prerequisites

- Rust toolchain with `wasm32-unknown-unknown` target
- `merod` running locally (`merod run`)
- `meroctl` built from source (or installed)
- Node.js + pnpm (for the frontend)

## Quick Start

### Terminal 1: Start dev session (backend)

```bash
# Build WASM + install + create context + local NEAR sandbox
meroctl dev start ./logic --watch
```

This will:
1. Start a local NEAR sandbox (if not already running)
2. Build the WASM contract
3. Install it on your node
4. Create (or reuse) a context
5. Watch `logic/src/` for changes and auto-reload

Copy the printed `ApplicationId` and `ContextId` into `app/.env`.

### Terminal 2: Start frontend

```bash
cp app/.env.example app/.env
# Fill in VITE_APPLICATION_ID and VITE_CONTEXT_ID from Terminal 1
pnpm --dir app dev
```

Open `http://localhost:5173` in your browser.

### Development loop

1. Edit `logic/src/lib.rs`
2. The watcher rebuilds + reinstalls automatically
3. Refresh the browser to test

The `ApplicationId` is stable across rebuilds (same package + dev key),
so you never need to update `app/.env` after the initial setup.

## Manual Commands

```bash
# Build WASM only (no install)
pnpm logic:build

# Install frontend dependencies
pnpm app:install

# Build frontend for production
pnpm app:build
```

## Project Structure

```
kv-store/
├── logic/                      # Rust smart contract
│   ├── src/lib.rs             # Contract code
│   ├── build.sh               # Build script
│   ├── manifest.json          # Package metadata
│   └── res/                   # Build output (gitignored)
│       ├── kv_store.wasm
│       └── abi.json
├── app/                       # React frontend
│   ├── src/
│   │   └── App.tsx            # CalimeroProvider (reads from env)
│   ├── .env.example           # Template — copy to .env
│   └── package.json
├── package.json               # Root scripts
└── DEVELOPMENT.md             # This file
```

## Release (publishing to registry)

```bash
# Generate a release key (once)
mero-sign generate-key --output release-key.json

# Build + sign with release key
pnpm logic:build
mero-sign sign logic/manifest.json --key release-key.json

# Publish (creates a different ApplicationId from dev)
```
