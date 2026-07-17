# issue-tracker-mcp

A stdio MCP server that lets Claude Code manage issues in this app's tracker
by calling the local Calimero node's `/jsonrpc` and `/admin-api` endpoints
directly (no mero-js dependency).

## Tools

Every issue tool below also takes an optional `repo` param - the context
alias to target within the namespace. Pass it explicitly on each call when
managing more than one repo; that's the expected Claude Code usage. Without
it, the server falls back to `TRACKER_REPO`, then to the namespace's only
repo, else it errors listing what's available.

- `create_issue` - required `title`, `summary`, `impact`, `repro`,
  `resolution_criteria`; optional `priority` (`low`/`medium`/`high`/`urgent`,
  default `medium`), `labels` (string array), and `repo`.
- `list_issues` - optional `status`, `assignee`, `label`, `repo`.
- `get_issue` - `id`, optional `repo`.
- `add_comment` - `issue_id`, `body`, optional `repo`.
- `assign_issue` - `issue_id`, `assignee`, optional `repo`.
- `get_fix_prompt` - `id`, optional `repo`. Renders a ready-to-paste fix
  prompt filled with the issue's sections plus the repo's `Repository:` line
  (`src/fixPrompt.ts`).
- `list_repos` - no params. Lists every repo (aliased context) in the
  namespace with its name and `repo_url`.

## Config (env vars)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `CALIMERO_NODE_URL` | no | `http://localhost:2428` | Base URL of the local node. |
| `TRACKER_NAMESPACE` | yes, unless `TRACKER_CONTEXT` is set | - | The tracker's namespace id, or a name resolved via `GET /admin-api/namespaces`. Repos are the namespace's aliased contexts (see `repo` above). |
| `TRACKER_REPO` | no | - | Default repo (context alias) within the namespace, used when a tool call omits `repo`. |
| `TRACKER_CONTEXT` | no | - | Direct pin to a single context id or alias (backward compat). When set, it bypasses namespace/repo resolution entirely and every `repo` param is ignored. |
| `CALIMERO_AUTH_TOKEN` | no | - | Bearer token sent to both `/admin-api` and `/jsonrpc`. |
| `TRACKER_EXECUTOR` | no | - | Executor public key for RPC calls. If unset, resolved from the node's first owned identity for the target context (`GET /admin-api/contexts/{id}/identities-owned`), mirroring `useWorkspace.ts`. |

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
        "TRACKER_NAMESPACE": "my-team",
        "TRACKER_REPO": "frontend"
      }
    }
  }
}
```

`pnpm --filter issue-tracker-mcp start` runs the package's own `start`
script (`tsx src/index.ts`, using the `tsx` installed in `mcp/`'s
`node_modules`), so it works from the repo root without a global or
unpinned `npx` install.

`TRACKER_REPO` is only a default - pass `repo` on individual tool calls to
target a different repo in the same namespace without restarting the server.
Omit `TRACKER_REPO` entirely if the namespace has (or will only ever have)
one repo; it's inferred automatically.

Add `CALIMERO_AUTH_TOKEN` / `TRACKER_EXECUTOR` to `env` only if you need them -
both are optional (see the table above).

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
filled template). It runs the server against `TRACKER_CONTEXT` (the direct
pin), so it doesn't exercise namespace/repo resolution. Point it at a node
with the tracker context provisioned:

```bash
CALIMERO_NODE_URL=http://localhost:2428 \
TRACKER_CONTEXT=issue-tracker \
CALIMERO_AUTH_TOKEN=<token if the node enforces auth> \
node scripts/smoke.mjs
```
