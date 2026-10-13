# mero-board

A private, real-time kanban board for any team, built on
[Calimero](https://calimero.network). Boards replicate directly between team
members' nodes: no central server, no shared database.

The model is four levels deep:

- **Workspace** - a Calimero namespace: the team.
- **Folder** - one context in the workspace, running the `board` service. Every
  board in a folder replicates to everyone who joined that folder; boards
  nobody else should see go in another folder.
- **Board** - a set of lists, ordered by rank within its folder.
- **List** - a column you define (Todo, Doing, Done, or whatever you work in).
- **Card** - a title, description, optional assignee and due date, labels, a
  checklist and a comment thread. Drag it within a list or across lists.

Any member may edit, move, archive or relabel anything. Only a board's creator
may delete the board, only a card's creator may delete the card, and only a
comment's author may edit or delete the comment. Order is a short `rank` string
between neighbours, so two people reordering different cards never collide.
`logic/GUIDE.md` is the full contract reference.

The app also ships an **MCP server** (`mcp/`): a stdio
[Model Context Protocol](https://modelcontextprotocol.io) server that lets an
agent list folders and boards, file cards, move them by position, set
assignees and due dates, tick checklist items and comment, by talking to your
local node.

## Quickstart: use it from Claude Code

You need a running Calimero node with the app installed and a workspace with at
least one folder (create them in the app), then paste this prompt into Claude
Code - it gets your token and registers the MCP server for you:

```text
Set up the mero-board MCP server for me.

It is on npm as @calimero-network/mero-board-mcp and runs over stdio;
register it with `claude mcp add board --scope user -- npx -y
@calimero-network/mero-board-mcp`, passing these as --env values:

- CALIMERO_NODE_URL: my local node's URL (ask me; it is often
  http://localhost:2428, but confirm the port).
- BOARD_NAMESPACE: my workspace name exactly as it appears in the app's
  workspace switcher (ask me).
- BOARD_FOLDER: my default folder name (ask me; optional, skip if the
  workspace only has one folder).
- CALIMERO_AUTH_TOKEN: my node access token. To get it, tell me to open the
  app tab, open the browser devtools console, and run:
  JSON.parse(localStorage.getItem('mero-tokens')).access_token
  then paste the result back to you. This token expires about hourly; if tools
  later return 401, re-run `claude mcp add` (or `claude mcp remove board
  -s user` then add again) with a fresh token.

After registering, run `claude mcp get board` and confirm it shows
Connected, then list the folders and boards to verify it works end to end.
```

Then just talk to it: "list the boards in folder marketing", "add a card
'Write the launch post' to Todo on the Q4 launch board", "move it to the top of
Doing", "tick the first checklist item". The full tool and env-var reference is
in [`mcp/README.md`](mcp/README.md).

Publishing the package to npm is not wired up yet. Until it is, `npx` cannot
fetch it: run the server from source instead, as `mcp/README.md` shows.

## Layout

| Path | What |
| ---- | ---- |
| `logic/` | Rust WASM contract (`board` service): boards, lists, cards, checklists, labels, comments, rank ordering and the ownership rules. `GUIDE.md` is the agent-facing reference; `tests/converge.rs` checks replicas converge; `workflows/smoke.yml` is the merobox smoke. Built into a signed `.mpk` bundle. |
| `logic/crates/types` | Shared types and validation used by the contract. |
| `app/` | React (Vite) frontend: folders, boards, lists and cards with drag and drop and a card detail modal, members and aliases. Includes the generated landing page (`src/pages/landing/`, from `scripts/landing/`). |
| `mcp/` | The stdio MCP server, `@calimero-network/mero-board-mcp` (see `mcp/README.md`). |
| `recipes/` | Logic-only reference modules for patterns the base does not use (subgroup rooms, authored feeds, counters, DMs, context metadata). Not wired into the build. |

## Prerequisites

- Node 22 and `pnpm`.
- Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).
- `cargo mero` on `PATH`, for the bundle build. CI installs the pinned release
  through `.github/actions/setup-cargo-mero`; locally grab the prebuilt binary
  from a [core release](https://github.com/calimero-network/core/releases) or
  `cargo install --path tools/cargo-mero` from a core checkout.
- A Calimero node: a `merod` binary, the Calimero Desktop app, or
  [`merobox`](https://github.com/calimero-network/merobox).

## Setup

From the repo root:

```bash
pnpm install
cd apps/mero-board
pnpm logic:build     # compile the wasm + ABI and sign the .mpk bundle
pnpm app:codegen     # regenerate the typed client from the ABI
pnpm app:dev         # vite dev server on http://localhost:5173
```

`pnpm logic:build` writes `logic/dist/com.calimero.mero-board.mpk`, signed with
`$MERO_SIGN_KEY_FILE`, else `$STUDIO_DEV_SIGNING_KEY`, else
`~/.calimero-studio/studio-dev-signing.key.json`. The version comes from
`appVersion` in `studio.config.json`: bump it to release, since the registry
rejects a version it already has. Re-run `pnpm app:codegen` whenever the
contract's public methods change.

To use the app: install the bundle on your node, open the app, connect to the
node, create a workspace, add a folder, then a board and its lists.

## Tests

```bash
cargo test -p mero-board -p board-types                       # contract unit + converge tests
pnpm --filter ./app test                                      # app unit tests (vitest)
pnpm --filter @calimero-network/mero-board-mcp test           # MCP server tests (node:test)
pnpm test:smoke                                               # merobox smoke (needs Docker)
```

End-to-end (Playwright) starts merod nodes, installs the bundle and drives the
real UI across peers. It needs a `merod` binary and the bundle built first:

```bash
pnpm logic:build
cd app
MEROD_BINARY=/path/to/merod pnpm test:e2e       # boards, lists, cards, replication
MEROD_BINARY=/path/to/merod pnpm test:journey   # the CI login-to-board journey
```

On macOS the Calimero Desktop app bundles one at
`/Applications/Calimero Desktop.app/Contents/Resources/merod/merod`.
