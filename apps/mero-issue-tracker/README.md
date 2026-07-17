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

3. Open the app, authenticate against your node, create or join a workspace
   (namespace), then add a repo. Repo names come from "Add repo" - that's
   the context alias the MCP server resolves by name.

## MCP setup (team)

The MCP server (`mcp/`) lets a coding agent (Claude Code) create, list, read,
comment on, and assign issues, and fetch the fix prompt, by talking directly
to your local node. This is the quickstart; `mcp/README.md` has the full
tool and env-var reference.

### Prerequisites

- A local Calimero node running (`merod`), reachable at `CALIMERO_NODE_URL`.
- The app installed on that node and a workspace (namespace) created or
  joined through the app - the MCP server resolves repos inside it, it does
  not create them.
- At least one repo added via "Add repo" in the app.

### Register the server

Add to `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "pnpm",
      "args": ["--filter", "issue-tracker-mcp", "start"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "TRACKER_NAMESPACE": "my-team",
        "TRACKER_REPO": "core"
      }
    }
  }
}
```

From another repo, point pnpm at this checkout with `-C`:

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "pnpm",
      "args": ["-C", "/path/to/issue-tracker", "--filter", "issue-tracker-mcp", "start"],
      "env": { "CALIMERO_NODE_URL": "http://localhost:2428", "TRACKER_NAMESPACE": "my-team" }
    }
  }
}
```

Or register it with the CLI instead of hand-editing `.mcp.json`:

```bash
claude mcp add issue-tracker --scope project \
  --env CALIMERO_NODE_URL=http://localhost:2428 \
  --env TRACKER_NAMESPACE=my-team \
  -- pnpm -C /path/to/issue-tracker --filter issue-tracker-mcp start
```

### Env vars

| Var | Meaning |
| --- | --- |
| `CALIMERO_NODE_URL` | Base URL of your local node (default `http://localhost:2428`). |
| `CALIMERO_AUTH_TOKEN` | Bearer token for a node with auth enabled. Get it from the app: open devtools console on the app tab and run `JSON.parse(localStorage.getItem('mero-tokens')).access_token`. It expires roughly hourly - re-run the one-liner and update `.mcp.json` when calls start 401ing. |
| `TRACKER_NAMESPACE` | The workspace name as created/joined in the app (or its namespace id). |
| `TRACKER_REPO` | Default repo name, used when a tool call omits `repo`. Optional - omit it if the workspace has (or will only ever have) one repo. |
| `TRACKER_CONTEXT` | Advanced: pins a single context id/alias directly, bypassing namespace/repo resolution. Rarely needed. |

### Tools

- `create_issue` - file a new issue (`title`, `summary`, `impact`, `repro`,
  `resolution_criteria`, optional `priority`/`labels`/`repo`).
- `list_issues` - list issues, optionally filtered by `status`/`assignee`/`label`/`repo`.
- `get_issue` - fetch one issue by `id`, optional `repo`.
- `add_comment` - comment on `issue_id`, optional `repo`.
- `assign_issue` - set the assignee on `issue_id`, optional `repo`.
- `set_status` - move `issue_id` to a status (Open, In progress, Blocked, Done), optional `repo`.
- `set_priority` - set the priority (low, medium, high, urgent) on `issue_id`, optional `repo`.
- `get_fix_prompt` - render a ready-to-paste fix prompt for `id`, optional `repo`.
- `list_repos` - list every repo in the namespace with its name and `repo_url`.

Every tool above takes an optional `repo` param (the repo name). Pass it
explicitly when managing more than one repo; without it the server falls
back to `TRACKER_REPO`, then the namespace's only repo, else it errors.

### Example prompts

- "List the repos in the issue tracker."
- "File an issue in repo core: login fails with a 500 when the session token is expired."
- "Move ISS-42 to In progress and set its priority to high."
- "Get the fix prompt for ISS-42."
- "Show me all open, high-priority issues assigned to me in repo core."

### Troubleshooting

- **401 Unauthorized** - `CALIMERO_AUTH_TOKEN` is stale; re-copy it from
  `mero-tokens` in the app's localStorage.
- **"No repos found"** - either no repo has been added in the app yet, or
  `TRACKER_NAMESPACE` doesn't match a real workspace name; the error lists
  what repos/namespaces actually exist, use one of those.
- **Title rejected as too long at 64 characters** - the logic caps issue
  titles at 64 characters, but the error text says "label must be at most 64
  characters" (title validation reuses the label validator); shorten the
  title.
- A live round-trip check against a real node is in `mcp/scripts/smoke.mjs`.

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
