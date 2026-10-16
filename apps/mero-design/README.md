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

## App layout

Every signed-in screen is one frame (`app/src/components/shell/DesignShell.tsx`):

- **Top bar** — team switcher (with "New team" in the menu), the open board's
  name, who is on the board, Present, Invite, the theme switch, and an account
  menu with Team settings and Logout.
- **Boards rail** — the team's boards with live thumbnails, "+" for a new board,
  and each board's ⋯ (Rename, Settings, Delete). A drawer on a phone.
- **Main** — the board, or the team's home grid when no board is open.
- **Settings** — a panel beside the board, addressed by the URL, with Team
  (members, roles, remove, your name) and Board (name, canvas access) sections.

| URL | Screen |
|---|---|
| `/teams` | Resumes the team and board you had open last on this node (else the first team) |
| `/teams/:teamId/projects` | The team's home grid (`/teams/:teamId` redirects here) |
| `/teams/:teamId/projects/:contextId` | A board |
| `/boards/:contextId` | A board, its team looked up (the desktop app's deep link) |
| `…?settings=team` / `…?settings=board` | Settings open on any of the above |

A new team or board opens as soon as it is created.

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

The landing page's two clips — the hero loop (`app/public/landing/hero.webm`)
and the chaptered demo (`demo.webm`), each with a poster — are recorded from the
real editor against the mocked node the e2e specs use. The teammate in them is
driven through the app's own SSE event path, not drawn on:

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

## Undo and redo

Undo (Ctrl/⌘+Z) and redo (Ctrl/⌘+Shift+Z or Ctrl+Y) take back **your own**
steps, and write the result to the node, so every member sees it. A step records
only the elements you changed (as they were before, and as you left them), and
undoing it writes back only the fields you changed: a teammate's shape, or their
recolour of a shape you then moved, survives your undo. A shape a teammate has
deleted since stays deleted. See `app/src/store/history.ts`.

## Lock and hide

Each row in the **Layers** tab has a padlock and an eye; on a group row they
act on every layer in it. **Shift+⌘/Ctrl+L** locks and **Shift+⌘/Ctrl+H**
hides the selection, and pressing again reverses it.

- **Hidden** layers are not painted, cannot be clicked, and are left out of
  every export (PNG, SVG, a group's export, a merge into one image, the HTML
  code export, project thumbnails) and of presenting. A hidden screen is not
  presented.
- **Locked** layers are painted and exported, but the canvas will not select,
  move, resize or delete them (a marquee skips them too). Select one in the
  Layers tab to unlock it. A lock is a convenience, not a permission: any
  editor can unlock.

Both are synced to every member and are undoable. Like stroke style, groups and
screens, they ride the element's `label` (`app/src/utils/elementMeta.ts`)
rather than contract fields: adding a field to the Borsh-stored `Element` would
need a migration of every element on every board. So there is no contract
change, and a board saved before this feature loads with everything unlocked
and shown.

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

## Owned keys are per owner (core 0.11.0-rc.57)

Since core 0.11.0-rc.57 every owned collection (`Authored…`, `WriteOnce`, `Moderated`,
`ModeratedOnce`) is one namespace per account: two accounts writing one key hold two
independent entries, and a key-only `get`, `contains`, `owner_of`, `owned_by_me` or `remove`
acts on the CALLER's own entry only. This app was migrated:

`get_cursors` labels each pointer with its entry's own owner (`entries_with_owners`); a
key-only `owner_of` would only ever name the caller, so every other member's pointer
would have been dropped.

## License

MIT OR Apache-2.0
