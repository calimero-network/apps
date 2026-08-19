# MeroPixArt

A collaborative image editor built on the Calimero p2p network. Think Photoshop / Photopea — but your project data lives on your own nodes, shared only with the people you invite.

## Features

- **Layers & folders** — raster, text and fill layers inside real folders: a collapsible tree in the layers panel, drag-and-drop nesting, renameable, with inherited visibility & opacity. Selecting a folder selects its contents, so dragging it moves the whole group
- **Non-destructive adjustments** — brightness, contrast, saturation, hue, exposure, blur, invert — applied live at composite time via the canvas filter pipeline
- **Curves** — per-channel (RGB / R / G / B) spline editor, applied via a LUT
- **Blend modes** (all 16), per-layer opacity, **layer masks** (paint to hide/reveal)
- **Free transform** — move, scale, rotate, **shear** (skew X/Y), **mirror** (flip H/V) and a **corner-pin warp**, from either the on-canvas gizmo or the numeric Transform panel. Everything stays live transform params until you explicitly bake them with *Apply*
- **Paint tools** — brush, eraser, bucket fill, eyedropper — re-render the raster layer to a new PNG blob
- **Image upload** — pixels stored as PNG blobs on the node and announced to the context
- **Text layers** with font / size / color / style controls
- **Export** the composited document to PNG or JPG; **project gallery** per team
- **Showcase projects** — four complete documents (a product ad, an illustrated landscape, a geometric poster and a transform reference sheet) that load into a project from *File ▸ Open Showcase Project…*, or when you start a new project from one
- **Multi-member projects** — invite teammates via Calimero group invitations
- **Roles via AccessControl** — owner / admin / editor / viewer (read-only by default)
- **Real-time sync & presence** (live cursors) over SSE — no central server
- Undo / redo, zoom & pan, keyboard shortcuts

> Remaining follow-ups (standalone adjustment layers, a finer warp mesh than four
> corner pins, per-parent layer ordering) are tracked in
> [`TRACKER.md`](./TRACKER.md).

### Showcase projects

The gallery in *File ▸ Open Showcase Project…* ships four documents. They are not
bitmaps: each one is a **recipe** — a list of paint operations per layer — rendered
in the browser when you open it (`app/src/showcase/`). That keeps them a few kB in
the bundle, crisp at any canvas size, and readable: you can see that the reflection
in *Sunset Ridge* is the mountain layer again with `flipV` and a gradient mask.

| Project | What it demonstrates |
| --- | --- |
| **Aurora Edition** | Screen-blended gradients, a perspective-warped product card, a live text layer, grain + vignette |
| **Sunset Ridge** | Mirrored reflections (`flipV`), gradient layer masks, non-destructive blur adjustments |
| **Bauhaus Grid** | A warped title, a 22° sheared bar, rotated type, multiply blending |
| **Transform Lab** | The same tile under ten transforms, side by side, with nested folders |

Opening one goes through the same contract calls a person would make by hand
(`update_document`, `add_layer`, `update_layer_content`, `move_layers`), so every
layer lands in WASM and reaches every other member.

To see them without booting a node:

```bash
cd app && pnpm dev
# then open http://localhost:5176/scripts/showcase-preview.html
```

CI renders them too, and uploads the PNGs as the `showcase-renders` artifact.

## Architecture

```
mero-pixart/
├── logic/          Rust WASM — document state, layers, blob refs, membership, roles (calimero-sdk)
├── app/            React + TypeScript + Vite frontend (canvas compositor)
│   ├── src/utils/transform.ts   one definition of a layer's matrix + warp mesh
│   ├── src/utils/layerTree.ts   the folder tree read off `parentId`
│   └── src/showcase/            the bundled demo documents, as paint recipes
├── workflows/      merobox bootstrap workflows for dev / CI
├── scripts/        Dev node scripts (start, stop, invite)
└── .github/        CI workflows
```

The compositor caches each layer's prepared pixels (mask + adjustment filter),
keyed by a signature that deliberately excludes position, rotation and opacity —
so dragging one layer re-prepares only that layer. Without it, a `blur`
adjustment re-ran a full gaussian pass per layer on every pointer move
(`utils/compositor.ts` documents the measurements).

The WASM contract holds **layer metadata** (kind, `parentId` for folder nesting,
transform — position, scale, rotation, shear, mirror, corner-pin warp — opacity,
blend mode, adjustments, text props) and **blob references** — the actual pixels are stored as
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
- **Layers** (right): a folder tree. Add raster/text/fill layers and folders, drag a row onto a folder to nest it (or onto the strip below the list to lift it out), click a folder's twirl to collapse its contents, double-click a name to rename. ⌘G groups the selection, ⌘⇧G ungroups. Selecting a folder selects everything inside it, so a drag on the canvas moves the group as one.
- **Transform** (right, collapsed by default — open it from its header or *Edit ▸ Transform Numerically…*): numeric position, angle, skew X/Y, mirror and the four warp corner pins, plus presets and *Apply* to bake. With the Transform tool the canvas gizmo does the same thing by hand — corners scale, edge grips shear, the top knob rotates (Shift constrains), and *Warp* mode swaps the handles for corner pins.
- **Adjustments** (right): brightness/contrast/saturation/hue/exposure/blur/invert sliders + a Curves editor.
- **File menu**: open a showcase project, place an image, export PNG/JPG. **Top bar**: undo/redo, zoom, invite teammates, settings (roles, rename/resize).

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

- **Contract (Rust):** `cd logic && cargo test` — roles, ownership, layer LWW merge, folder reparenting (including the nested case), the transform patch/clamp rules, `move_layers`' cycle guard, and the viewer edit-gate.
- **Frontend unit (Vitest):** `make unit` — the transform algebra (matrix compose/invert, shear, mirror, warp mesh), the folder tree (nesting, cycle survival, selection expansion, bounds), the compositor's decisions (paint order, inherited opacity, blend mapping), raster pixel math (curves, levels, flood fill), the four showcase documents, the store, and the Layers/Transform panels via Testing Library.
  jsdom ships no 2D canvas, so the suite installs a stub (`src/test/canvasStub.ts`) with a real pixel buffer behind `getImageData`/`putImageData` and a recorded draw log — read its header comment before asserting on pixels, because it does not rasterise shapes.
- **Frontend e2e (Playwright, mocked):** `make e2e` — the editor chrome, the folder tree, free transform, every editor operation checked against the RPCs it issues, the showcase gallery and the projects page, all against a fake node (`e2e/support/mocks.ts`). One spec renders every showcase full-size and uploads the PNGs.
- **Integration / p2p (merobox):** `make workflows` / `make logic-test` — spins up real nodes in Docker via the YAMLs in `workflows/`. CI runs all of the above (`.github/workflows/`).

## SDK pin

The contract pins all Calimero crates to **`0.11.0-rc.24`** via the **core git tag**:

```toml
calimero-sdk = { git = "https://github.com/calimero-network/core", tag = "0.11.0-rc.24" }
```

The rc is published only as a git tag (crates.io stops at rc.5) and the workspace
package version at the tag is `0.0.0`, so a plain version requirement can't match —
the git-tag form is required. Uses `borsh` 1.x. The merod runtime image used by the
merobox workflows is `ghcr.io/calimero-network/merod:0.11.0-rc.24`.

## Data Model

Each **Project** is a Calimero context inside a **Team** (namespace/group). Members
are invited the same way as in other Calimero apps and granted roles via
AccessControl. The document state (layers, adjustments, blob refs, members) is
stored in the WASM logic and synced across all member nodes via the Calimero p2p
layer; raster pixels travel as PNG blobs.

## License

[MIT](./LICENSE) © Calimero Network
