# @calimero-network/mero-issue-tracker-mcp

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
- `set_status` - `issue_id`, `status` (`Open`/`In progress`/`Blocked`/`Done`), optional `repo`.
- `set_priority` - `issue_id`, `priority` (`low`/`medium`/`high`/`urgent`), optional `repo`.
- `delete_issue` - `issue_id`, optional `repo`. Author-gated (only the
  issue's `created_by` may delete it); cascade-removes its comments and labels.
- `get_fix_prompt` - `id`, optional `repo`. Renders a ready-to-paste fix
  prompt filled with the issue's sections plus the repo's `Repository:` line
  (`src/fixPrompt.ts`).
- `list_repos` - no params. Lists every repo (aliased context) in the
  namespace with its name and `repo_url`.
- `add_repo` - `name`, `github_url`. Onboards a new repo: creates a context
  in `TRACKER_NAMESPACE`, sets its `repo_url`, and aliases it by name.
  Requires `TRACKER_NAMESPACE` (errors under the `TRACKER_CONTEXT` direct
  pin, which has no namespace to create a repo in). Rejects a name that
  already exists.

## Config (env vars)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `CALIMERO_NODE_URL` | no | `http://localhost:2428` | Base URL of the local node. |
| `TRACKER_NAMESPACE` | yes, unless `TRACKER_CONTEXT` is set | - | The tracker's namespace id, or a name resolved via `GET /admin-api/namespaces`. Repos are the namespace's aliased contexts (see `repo` above). |
| `TRACKER_REPO` | no | - | Default repo (context alias) within the namespace, used when a tool call omits `repo`. |
| `TRACKER_CONTEXT` | no | - | Direct pin to a single context id or alias (backward compat). When set, it bypasses namespace/repo resolution entirely and every `repo` param is ignored. |
| `CALIMERO_AUTH_TOKEN` | no | - | Bearer token sent to both `/admin-api` and `/jsonrpc`. |
| `TRACKER_EXECUTOR` | no | - | Executor public key for RPC calls. If unset, resolved from the node's first owned identity for the target context (`GET /admin-api/contexts/{id}/identities-owned`), mirroring `useWorkspace.ts`. |
| `TRACKER_SERVICE` | no | `issue-tracker` | Service name passed to `createContext` by `add_repo`. |

## Run it

```bash
pnpm --filter @calimero-network/mero-issue-tracker-mcp start
```

## Wire it into Claude Code

The primary path is `npx`, no clone required (needs the package published to
npm - see "Publishing" below):

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "npx",
      "args": ["-y", "@calimero-network/mero-issue-tracker-mcp"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "TRACKER_NAMESPACE": "my-team",
        "TRACKER_REPO": "frontend"
      }
    }
  }
}
```

If you're contributing to this repo, run it from source instead:

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "pnpm",
      "args": ["--filter", "@calimero-network/mero-issue-tracker-mcp", "start"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "TRACKER_NAMESPACE": "my-team",
        "TRACKER_REPO": "frontend"
      }
    }
  }
}
```

`pnpm --filter @calimero-network/mero-issue-tracker-mcp start` runs the
package's own `start` script (`tsx src/index.ts`, using the `tsx` installed
in `mcp/`'s `node_modules`), so it works from the repo root without a global
install.

`TRACKER_REPO` is only a default - pass `repo` on individual tool calls to
target a different repo in the same namespace without restarting the server.
Omit `TRACKER_REPO` entirely if the namespace has (or will only ever have)
one repo; it's inferred automatically.

Add `CALIMERO_AUTH_TOKEN` / `TRACKER_EXECUTOR` to `env` only if you need them -
both are optional (see the table above).

## Tests

```bash
pnpm --filter @calimero-network/mero-issue-tracker-mcp test       # node:test, mocked fetch
pnpm --filter @calimero-network/mero-issue-tracker-mcp typecheck
```

## Publishing

`.github/workflows/publish-mcp.yml` releases this package automatically:
merging a conventional commit that touches `mcp/` into `main` runs
semantic-release, which bumps the version, writes `CHANGELOG.md`, tags the
release (`mero-issue-tracker-mcp-v<version>`), and publishes to npm via
trusted publishing (GitHub Actions OIDC - no token secret). It can also be
triggered manually from the Actions tab. Commit types map to release types
per `mcp/.releaserc.json` (`feat` = minor, `fix`/`chore`/`docs`/`refactor`/
`perf` = patch, `test`/`build`/`ci` = no release).

This requires the package's trusted publisher to be configured on
npmjs.com to point at this repo and the `publish-mcp.yml` workflow filename
before the first publish will work.

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
TRACKER_CONTEXT=core \
CALIMERO_AUTH_TOKEN=<token if the node enforces auth> \
node scripts/smoke.mjs
```

See the root README's "MCP setup (team)" section for a step-by-step guide to
running this server against your team's node.
