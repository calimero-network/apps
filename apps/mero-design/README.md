# MeroDesign

A collaborative design tool built on the Calimero p2p network. Think Figma — but your design data lives on your own nodes, shared only with the people you invite.

## Features

- Infinite canvas with pan and zoom
- Shapes: rectangles, circles, lines, arrows, freehand paths
- Images and SVGs — stored as blobs on the node
- Text elements with font controls
- Multi-member projects — invite teammates via Calimero group invitations
- Export canvas to PNG or SVG
- Screens + presentation mode (Figma-style "Present") — see below
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

## Landing page media

The demo clip on the landing page (`app/public/landing/demo.webm` and its poster)
is recorded from the real editor against the mocked node the e2e specs use:

```bash
cd app && pnpm landing:media
```

The chapter times shown beside the clip live in `scripts/landing/apps.config.mjs`
at the repo root and must match `CHAPTERS` in `app/e2e/media/capture-landing-media.spec.ts`.

## Screens and presenting

A **screen** is one slide: a rectangle whose layer name sits in the top-level
`screen` group (`screen/01 Sign in`). Its area is the slide — everything painted
inside it is shown, clipped at its edge, exactly like a Figma frame.

- **Make one:** select the layers that belong together, open the **Screens** tab
  and choose **Create screen from selection**. A backdrop sized to the selection
  is added behind it. Select a single rectangle instead and that rectangle
  becomes the screen.
- **Present:** **▶ Present** in the toolbar (or the Screens tab) plays the
  screens, starting from the one the selection is on.
- **Order:** screens play in reading order — left to right, then top to bottom —
  until you **drag them into a different order** in the Screens tab (or use
  *Move up / Move down* in a row's ⋯ menu, or Alt+↑/↓ on a focused row). A
  reordered screen carries its place on the end of its name
  (`screen/Pricing @3`); the suffix is hidden in the UI and survives a rename.
- **Navigate:** → / Space / PageDown forward, ← / Shift+Space / PageUp back,
  Home / End, F for full screen, Esc to leave. **All screens** shows a filmstrip.
- **Long screens scroll:** a screen much taller than the window is shown at a
  readable width and scrolls; Space pages through it before moving on. Zoom
  can also be set to *Fill width* or *100%*.

Screens ride the element `label` like groups do, so there is no contract change:
every member sees the same screens and the same order, and the web design
starter (whose five screens were already labelled this way) presents out of the
box.

## Starter projects

**Options → Starter projects** loads one into the board (an admin action; an
occupied board asks once before it is replaced):

- **Web design** — five app screens and a design system (`scripts/build-starter.mjs`).
- **Presentation** — an 8-slide deck about Calimero, one of them a tall
  scrolling screen; press **▶ Present** (`scripts/build-starter-presentation.mjs`).

`pnpm starter` regenerates both into `app/src/starter/`. The
presentation reads the live board, so a teammate's edit lands on the slide
being shown.

## Data Model

Each **Project** is a Calimero context inside a **Team** (namespace/group). Members are invited the same way as in other Calimero apps. The canvas state (elements, layers, blobs) is stored in the WASM logic and synced across all member nodes via the Calimero p2p layer.

## License

MIT OR Apache-2.0
