# MeroPixArt

A collaborative image editor built on the Calimero p2p network. Think Photoshop / Photopea — but your project data lives on your own nodes, shared only with the people you invite.

## Features

- **Layers & folders** — raster, text, and fill layers; group layers for nesting, with inherited visibility & opacity
- **Non-destructive adjustments** — brightness, contrast, saturation, hue, exposure, blur, invert — applied live at composite time via the canvas filter pipeline
- **Curves** — per-channel (RGB / R / G / B) spline editor, applied via a LUT
- **Blend modes** (all 16), per-layer opacity, **layer masks** (paint to hide/reveal), and **transforms** (move / scale / rotate)
- **Paint tools** — brush, eraser, bucket fill, eyedropper — re-render the raster layer to a new PNG blob
- **Image upload** — pixels stored as PNG blobs on the node and announced to the context
- **Text layers** with font / size / color / style controls
- **Export** the composited document to PNG or JPG; **project gallery** per team
- **Multi-member projects** — invite teammates via Calimero group invitations
- **Roles via AccessControl** — owner / admin / editor / viewer (read-only by default)
- **Real-time sync & presence** (live cursors) over SSE — no central server
- Undo / redo, zoom & pan, keyboard shortcuts

> Some advanced tools (marquee/lasso selection, crop tool, warp mesh, gradient,
> clone stamp, dedicated shape tool, standalone adjustment layers) are tracked as
> follow-ups in [`TRACKER.md`](./TRACKER.md). The core editor is fully functional
> without them.

## Architecture

```
mero-pixart/
├── logic/          Rust WASM — document state, layers, blob refs, membership, roles (calimero-sdk)
├── app/            React + TypeScript + Vite frontend (canvas compositor)
├── workflows/      merobox bootstrap workflows for dev / CI
├── scripts/        Dev node scripts (start, stop, invite)
└── .github/        CI workflows
```

The WASM contract holds **layer metadata** (kind, transform, opacity, blend mode,
adjustments, text props) and **blob references** — the actual pixels are stored as
PNG **blobs** on the node and announced to the context so they propagate to every
member. Adjustments are **non-destructive**: they are stored as parameters and
applied by the frontend at composite/render time, never baked into the stored
pixels until an explicit destructive edit re-renders the layer. Document metadata
(name, description, size) lives in an `Ownable` register so only the owner can
rename/resize; access is governed by an `AccessControl` role registry (the creator
is the sole initial admin). State changes fan out to members over **SSE** for
real-time collaboration.

## Quick Start

### Prerequisites

- **Rust** (1.89+) with the `wasm32-unknown-unknown` target — `rustup target add wasm32-unknown-unknown`
- **Node 18+** and **pnpm** — `npm i -g pnpm`
- **`merod`** + **`meroctl`** Calimero binaries on your `PATH` (a `merod 0.11.0-rc.x` node)
- **jq** — `brew install jq` / `apt install jq`
- **Docker** + **`merobox`** — *optional*, only for the merobox workflow tests
- Network access on first build (the contract pulls `calimero-sdk` from the core git tag — see [SDK pin](#sdk-pin))

### Run it (single node)

```bash
make setup       # check prereqs + build the WASM contract + install frontend deps
make dev-node    # start node1 on :2460, install the app, create a default Team + Project
make frontend    # start the Vite dev server → http://localhost:5176
```

Open http://localhost:5176, connect to the node (`http://localhost:2460`, user
`admin` / pass `calimero1234`), pick the **Team**, open a **Project**, and start editing.

### Two-node local stack (test real p2p collaboration)

```bash
make dev         # build WASM, start node1 (:2460) + node2 (:2461), auto-invite node2, run the frontend
make stop        # tear everything down and free ports 2460/2461/2560/2561
```

Log into node1 in one browser and node2 in another (or a private window) — edits,
layers, and cursors sync live between them.

### Using the editor

- **Tools** (left rail): move, brush, eraser, bucket, eyedropper, text, transform, hand/zoom — shortcuts `V B E G I T` etc.
- **Layers** (right): add raster/text/fill/group layers, drag to reorder or nest, toggle visibility/lock, set opacity & blend mode, add a mask, group/duplicate/delete.
- **Adjustments** (right): brightness/contrast/saturation/hue/exposure/blur/invert sliders + a Curves editor.
- **File menu**: place an image, export PNG/JPG. **Top bar**: undo/redo, zoom, invite teammates, settings (roles, rename/resize).

### Ports

| | HTTP (RPC/admin) | P2P |
|---|---|---|
| node1 | `2460` | `2560` |
| node2 | `2461` | `2561` |
| frontend (Vite) | `5176` | — |

## Commands

| Command | Description |
|---|---|
| `make setup` | Check prereqs, build logic, install deps |
| `make build` | Build WASM + frontend production bundle |
| `make dev` | Two-node stack + Vite dev server |
| `make frontend` | Frontend only (http://localhost:5176) |
| `make stop` | Stop all dev nodes |
| `make unit` | Vitest unit tests |
| `make e2e` | Playwright mocked e2e tests |
| `make test` | Unit + e2e tests |
| `make workflows` | merobox 2-node workflow tests (needs Docker) |
| `make logic-test` | Contract RPC assertions via merobox (needs Docker) |
| `make clean` | Remove all build artifacts |

Contract tests: `cd logic && cargo test`.

## Testing

- **Contract (Rust):** `cd logic && cargo test` — unit tests for roles, ownership, layer LWW merge, group reparenting, the viewer edit-gate.
- **Frontend unit (Vitest):** `make unit` — raster math, color/curves/blend helpers, store actions, undo/redo.
- **Frontend e2e (Playwright, mocked):** `make e2e` — landing + editor flows with the node mocked, no live node required.
- **Integration / p2p (merobox):** `make workflows` / `make logic-test` — spins up real nodes in Docker via the YAMLs in `workflows/`. CI runs all of the above (`.github/workflows/`).

## SDK pin

The contract pins all Calimero crates to **`0.11.0-rc.6`** via the **core git tag**:

```toml
calimero-sdk = { git = "https://github.com/calimero-network/core", tag = "0.11.0-rc.6" }
```

rc.6 is published only as a git tag (crates.io stops at rc.5) and the workspace
package version at the tag is `0.0.0`, so a plain version requirement can't match —
the git-tag form is required. Uses `borsh` 1.x. The merod runtime image used by the
merobox workflows is `ghcr.io/calimero-network/merod:0.11.0-rc.6`.

## Data Model

Each **Project** is a Calimero context inside a **Team** (namespace/group). Members
are invited the same way as in other Calimero apps and granted roles via
AccessControl. The document state (layers, adjustments, blob refs, members) is
stored in the WASM logic and synced across all member nodes via the Calimero p2p
layer; raster pixels travel as PNG blobs.

## License

[MIT](./LICENSE) © Calimero Network
