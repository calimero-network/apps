# issue-tracker-mcp

A stdio MCP server that lets Claude Code manage issues in this app's tracker
by calling the local Calimero node's `/jsonrpc` and `/admin-api` endpoints
directly (no mero-js dependency).

## Tools

- `create_issue` - required `title`, `summary`, `impact`, `repro`,
  `resolution_criteria`; optional `priority` (`low`/`medium`/`high`/`urgent`,
  default `medium`) and `labels` (string array).
- `list_issues` - optional `status`, `assignee`, `label` filters.
- `get_issue` - `id`.
- `add_comment` - `issue_id`, `body`.
- `assign_issue` - `issue_id`, `assignee`.
- `get_fix_prompt` - `id`. Renders a ready-to-paste fix prompt filled with the
  issue's four sections (`src/fixPrompt.ts`).

## Config (env vars)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `CALIMERO_NODE_URL` | no | `http://localhost:2428` | Base URL of the local node. |
| `TRACKER_CONTEXT` | yes | - | The tracker's context id, or an alias resolved via `POST /admin-api/alias/lookup/context/{name}` (falls back to the raw value if the lookup fails). |
| `CALIMERO_AUTH_TOKEN` | no | - | Bearer token sent to both `/admin-api` and `/jsonrpc`. |
| `TRACKER_EXECUTOR` | no | - | Executor public key for RPC calls. If unset, resolved from the node's first owned identity for the context (`GET /admin-api/contexts/{id}/identities-owned`), mirroring `useWorkspace.ts`. |

## Run it

```bash
pnpm --filter issue-tracker-mcp start
```

## Wire it into Claude Code

Add to `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "pnpm",
      "args": ["--filter", "issue-tracker-mcp", "start"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "TRACKER_CONTEXT": "issue-tracker",
        "CALIMERO_AUTH_TOKEN": "",
        "TRACKER_EXECUTOR": ""
      }
    }
  }
}
```

`pnpm --filter issue-tracker-mcp start` runs the package's own `start`
script (`tsx src/index.ts`, using the `tsx` installed in `mcp/`'s
`node_modules`), so it works from the repo root without a global or
unpinned `npx` install.

Drop the `CALIMERO_AUTH_TOKEN` / `TRACKER_EXECUTOR` keys entirely if you
don't need them - both are optional.

## Tests

```bash
pnpm --filter issue-tracker-mcp test       # node:test, mocked fetch
pnpm --filter issue-tracker-mcp typecheck
```

## Live smoke test

`scripts/smoke.mjs` drives the real stdio server against a running node: it
speaks the MCP protocol (initialize -> tools/list -> tools/call) through the
full round-trip - create_issue with all four sections, list_issues, get_issue
(verifies the sections survive), add_comment, get_fix_prompt (verifies the
filled template). Point it at a node with the tracker context provisioned:

```bash
CALIMERO_NODE_URL=http://localhost:2428 \
TRACKER_CONTEXT=issue-tracker \
CALIMERO_AUTH_TOKEN=<token if the node enforces auth> \
node scripts/smoke.mjs
```
