# issue-tracker

A peer-to-peer issue tracker built on [Calimero](https://calimero.network).
The board and every issue live in a Calimero context and replicate directly
between team members' nodes: no central server, no shared database.

Issues use a structured format built for handing bugs to a coding agent:

- **Summary** - what is wrong, in one or two sentences.
- **Impact** - who or what it affects and how badly.
- **Repro** - the steps, logs, or conditions that trigger it.
- **Resolution criteria** - what "fixed" must satisfy.

Plus status, priority, assignee, labels, and a per-issue comment thread.

Two extra surfaces make it agent-friendly:

- **Copy fix prompt** - each issue has a button (and an MCP tool) that renders a
  ready-to-paste prompt filled with the four sections, so you can drop a tracked
  bug straight into a coding-agent session.
- **MCP server** (`mcp/`) - a stdio [Model Context Protocol](https://modelcontextprotocol.io)
  server that lets an agent create, list, read, comment on, and assign issues,
  and fetch the fix prompt, by talking to a local node.

## Layout

| Path   | What |
| ------ | ---- |
| `logic/` | Rust WASM backend: the issue schema, statuses, priorities, labels, comments, and `list_issues` filters. Built into a signed `.mpk` bundle. |
| `app/`   | React (Vite) frontend: a dark, Linear-style board with list, board, filters, routed issue detail, members, and aliases. |
| `mcp/`   | The stdio MCP server (see `mcp/README.md`). |

## Prerequisites

- Node 22 (`.nvmrc`) and `pnpm`.
- Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).
- `jq` and `mero-sign` (from `calimero-network/core`) on `PATH`, for the bundle build.
- A Calimero node. For local runs a `merod` binary or [`merobox`](https://github.com/calimero-network/merobox) (Docker) works; the e2e harness provisions its own nodes (see below).

## Setup

```bash
pnpm install          # workspace deps (app + mcp)
pnpm logic:build      # compile the wasm + ABI and sign the .mpk bundle
pnpm app:codegen      # regenerate the typed client from the ABI (logic/crates/*/res/abi.json)
```

`pnpm logic:build` writes `logic/res/issue-tracker-<version>.mpk`. Re-run
`pnpm app:codegen` whenever the logic's public methods change.

## Run the app

1. Start a Calimero node and install the built bundle on it (via the node's
   admin API / Calimero Studio, or a `merobox` workflow like
   `test/smoke.workflow.yml`).
2. Start the frontend:

   ```bash
   pnpm app:dev        # vite dev server on http://localhost:5173
   ```

3. Open the app, authenticate against your node, and it bootstraps a context
   (registering the `issue-tracker` context alias) or joins one via an invite.

## MCP integration

The MCP server lets a coding agent drive the tracker. Add it to `.mcp.json` at
the repo root (see `mcp/README.md` for the full env-var reference):

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "pnpm",
      "args": ["--filter", "issue-tracker-mcp", "start"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "TRACKER_CONTEXT": "issue-tracker"
      }
    }
  }
}
```

`TRACKER_CONTEXT` accepts the `issue-tracker` context alias or a raw context id.
`CALIMERO_AUTH_TOKEN` and `TRACKER_EXECUTOR` are optional env vars, add them
only if your node needs them (see `mcp/README.md`).
A live round-trip check is in `mcp/scripts/smoke.mjs`.

## Tests

```bash
pnpm --filter ./app test               # app unit tests (vitest)
pnpm --filter issue-tracker-mcp test   # MCP server tests (node:test)
```

End-to-end (Playwright) spins up merod nodes, installs the bundle, and drives
the real UI across peers. It needs a `merod` binary (set `MEROD_BINARY` or put
it on `PATH`) and the bundle built first:

```bash
pnpm logic:build
MEROD_BINARY=/path/to/merod pnpm --filter ./app test:e2e
```

`NODE_COUNT` (1-3, default 3) controls how many peers the harness starts.
