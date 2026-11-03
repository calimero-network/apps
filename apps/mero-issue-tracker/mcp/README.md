# @calimero-network/mero-issue-tracker-mcp

A stdio MCP server that lets Claude Code manage issues in the Mero Issue
Tracker. It talks to a Calimero 1.0 cluster through mero-js's
`CalimeroClient` (every node attested before anything is sent to it),
authenticated by an API key that acts for your account: the `merod local`
nodes in development, a Calimero Cloud cluster by name in production.

A **workspace** is an organization, a **repo** is an instance of the tracker
in it (named after the repository).

## Tools

Every issue tool below also takes an optional `repo` param: the repo's name
within the workspace. Without it the server falls back to `TRACKER_REPO`,
then to the workspace's only repo, else it errors listing what's available.

- `create_issue` - required `title`, `summary`, `impact`, `repro`,
  `resolution_criteria`; optional `priority` (`low`/`medium`/`high`/`urgent`,
  default `medium`), `labels` (string array), and `repo`.
- `list_issues` - optional `status`, `assignee`, `label`, `repo`.
- `get_issue` - `id`, optional `repo`.
- `add_comment` - `issue_id`, `body`, optional `repo`.
- `assign_issue` - `issue_id`, `assignee`, optional `repo`.
- `set_status` - `issue_id`, `status` (`Open`/`In progress`/`Blocked`/`Done`), optional `repo`.
- `set_priority` - `issue_id`, `priority` (`low`/`medium`/`high`/`urgent`), optional `repo`.
- `delete_issue` - `issue_id`, optional `repo`. Only the issue's creator
  (`createdBy`) may delete it; its comments and labels go with it.
- `get_fix_prompt` - `id`, optional `repo`. Renders a ready-to-paste fix
  prompt filled with the issue's sections plus the repo's `Repository:` line
  (`src/fixPrompt.ts`).
- `list_repos` - no params. Every repo in the workspace with its name and
  `repo_url`.
- `add_repo` - `name`, `github_url`. Creates a repo (an instance of the
  tracker in the workspace's organization) and sets its URL. Requires
  `TRACKER_WORKSPACE`; rejects a name that already exists.

The tool arguments are the same as before the move to Calimero 1.0. What the
tools answer is what the contract answers: camelCase fields (`resolutionCriteria`,
`createdBy`, `issueId`), and 64-bit integers (`createdAt`, counts) as decimal
strings.

## Config (env vars)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `CALIMERO_API_KEY` | yes | - | An API key acting for your account. Create it in the app: **Members -> Agent key** (a passkey step-up). |
| `TRACKER_WORKSPACE` | yes, unless `TRACKER_APP` is set | - | The workspace: its organization id or its name. |
| `TRACKER_REPO` | no | - | Default repo name, used when a tool call omits `repo`. |
| `TRACKER_APP` | no | - | Pins one repo by its app instance id; workspace/repo resolution is skipped and every `repo` param ignored. |
| `CALIMERO_TARGET` | no | `local` | `local` (the `merod local` nodes), `cloud` (a cluster by name) or `node` (an attested node the operator runs, by URL). |
| `CALIMERO_NODES` | for `node` | `http://127.0.0.1:2501,…2502,…2503` | The nodes, in failover order: local ones, or a `node` target's `https` URLs. |
| `CALIMERO_CLUSTER` | for `cloud` | - | The cluster's name in the cloud's node directory. |
| `CALIMERO_MIN_RELEASE` | for `cloud` and `node` | - | The lowest mero-tee release a node may run. |
| `CALIMERO_ZONE`, `CALIMERO_DIRECTORY` | no | - | Try this zone first; another node directory. |
| `TRACKER_PACKAGE` | no | `com.calimero.mero-issue-tracker` | The package repos are instances of. |
| `TRACKER_BUNDLE` | no | - | On `merod local`: the dev bundle hash `pnpm dev:local` uploaded (repos created from it are not package instances). |

## Run it

```bash
cd apps/mero-issue-tracker/mcp && npm install && npm start
```

## Wire it into Claude Code

```json
{
  "mcpServers": {
    "issue-tracker": {
      "command": "npx",
      "args": ["-y", "@calimero-network/mero-issue-tracker-mcp"],
      "env": {
        "CALIMERO_TARGET": "cloud",
        "CALIMERO_CLUSTER": "eu-shared-1",
        "CALIMERO_MIN_RELEASE": "<release>",
        "CALIMERO_API_KEY": "<from Members -> Agent key>",
        "TRACKER_WORKSPACE": "my-team",
        "TRACKER_REPO": "frontend"
      }
    }
  }
}
```

Against `pnpm dev:local mero-issue-tracker`, drop the four `CALIMERO_*`
cluster lines (local is the default) and add `TRACKER_BUNDLE` with the
`VITE_CALIMERO_BUNDLE` value from `app/.env.development.local`.

## Tests

```bash
npm test         # node:test, a fake CalimeroClient
npm run typecheck
```

## Publishing

`npm run build` then `npm publish` (semantic-release config in
`.releaserc.json`). This repository has no workflow that publishes it yet.

## Live smoke test

`scripts/smoke.mjs` drives the real stdio server against a cluster: it speaks
the MCP protocol (initialize -> tools/list -> tools/call) through
create_issue with all four sections, list_issues, get_issue (the sections
survive), add_comment and get_fix_prompt (the filled template).

```bash
pnpm merod-local up                       # another terminal; or a Cloud cluster
CALIMERO_API_KEY=<key> TRACKER_APP=<repo app id> node scripts/smoke.mjs
```
