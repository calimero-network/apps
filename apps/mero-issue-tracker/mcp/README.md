# issue-tracker-mcp

A stdio MCP server that lets Claude Code manage issues in this app's tracker
by calling the local Calimero node's `/jsonrpc` and `/admin-api` endpoints
directly (no mero-js dependency).

## Tools

- `create_issue` — required `title`, `summary`, `impact`, `repro`,
  `resolution_criteria`; optional `priority` (`low`/`medium`/`high`/`urgent`,
  default `medium`) and `labels` (string array).
- `list_issues` — optional `status`, `assignee`, `label` filters.
- `get_issue` — `id`.
- `add_comment` — `issue_id`, `body`.
- `assign_issue` — `issue_id`, `assignee`.
- `get_fix_prompt` — `id`. Placeholder until task 7 authors the real
  template (`src/fixPrompt.ts`).

## Config (env vars)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `CALIMERO_NODE_URL` | no | `http://localhost:2428` | Base URL of the local node. |
| `TRACKER_CONTEXT` | yes | — | The tracker's context id, or an alias resolved via `POST /admin-api/alias/lookup/context/{name}` (falls back to the raw value if the lookup fails). |
| `CALIMERO_AUTH_TOKEN` | no | — | Bearer token sent to both `/admin-api` and `/jsonrpc`. |
| `TRACKER_EXECUTOR` | no | — | Executor public key for RPC calls. If unset, resolved from the node's first owned identity for the context (`GET /admin-api/contexts/{id}/identities-owned`), mirroring `useWorkspace.ts`. |

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
      "command": "npx",
      "args": ["tsx", "mcp/src/index.ts"],
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

Drop the `CALIMERO_AUTH_TOKEN` / `TRACKER_EXECUTOR` keys entirely if you
don't need them — both are optional.

## Tests

```bash
pnpm --filter issue-tracker-mcp test       # node:test, mocked fetch
pnpm --filter issue-tracker-mcp typecheck
```
