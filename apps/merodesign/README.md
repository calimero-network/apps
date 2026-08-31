# MeroDesign

A collaborative design tool built on the Calimero p2p network. Think Figma — but your design data lives on your own nodes, shared only with the people you invite.

## Features

- Infinite canvas with pan and zoom
- Shapes: rectangles, circles, lines, arrows, freehand paths
- Images and SVGs — stored as blobs on the node
- Text elements with font controls
- Multi-member projects — invite teammates via Calimero group invitations
- Export canvas to PNG or SVG
- Real-time sync via SSE (no central server)
- White-label landing page with team (namespace) selector

## Architecture

```
MeroDesign/
├── logic/          Rust WASM — board state, elements, membership (calimero-sdk)
├── app/            React + TypeScript + Vite frontend (Fabric.js canvas)
├── workflows/      merobox bootstrap workflows for dev / CI
├── scripts/        Dev node scripts (start, stop, invite)
└── .github/        CI workflows
```

## Quick Start

### Prerequisites

- Rust + `wasm32-unknown-unknown` target
- Node 18+ and pnpm
- `merod` + `meroctl` binaries
- `merobox` (optional, for workflow tests)

```bash
make setup       # check prereqs + build WASM + install frontend deps
make dev-node    # start node1 + install app
make dev         # start Vite dev server → http://localhost:5173
```

### Two-node local stack

```bash
make start       # node1 + node2 (auto-invited) + frontend
make stop        # tear everything down
```

## Commands

| Command | Description |
|---|---|
| `make setup` | Check prereqs, build logic, install deps |
| `make build` | Build WASM + frontend production bundle |
| `make dev` | Start Vite dev server |
| `make start` | Two-node stack + frontend |
| `make stop` | Stop all dev nodes |
| `make test` | Unit + e2e tests |
| `make workflows` | merobox workflow tests |
| `make clean` | Remove all build artifacts |

## Data Model

Each **Project** is a Calimero context inside a **Team** (namespace/group). Members are invited the same way as in other Calimero apps. The canvas state (elements, layers, blobs) is stored in the WASM logic and synced across all member nodes via the Calimero p2p layer.

## License

MIT OR Apache-2.0
