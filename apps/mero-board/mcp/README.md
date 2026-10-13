# @calimero-network/mero-board-mcp

A stdio MCP server that lets an agent (Claude Code, Hyperfeed) manage boards,
lists and cards in mero-board by calling the local Calimero node's `/jsonrpc`
and `/admin-api` endpoints directly (no mero-js dependency).

## Tools

Every board, list and card tool below also takes an optional `folder` param -
the context alias to target within the namespace. Pass it explicitly on each
call when working across more than one folder. Without it, the server falls
back to `BOARD_FOLDER`, then to the namespace's only folder, else it errors
listing what's available.

Positions (`move_card`, `move_list`) are `'top'`, `'bottom'` or
`'after:<id>'`; the server reads the board and computes the fractional rank
the contract expects, so callers never handle ranks. New boards, lists, cards
and checklist items are appended last.

Folders:

- `list_folders` - no params. Every folder (aliased context) in the namespace
  with its `name` and `context_id`.
- `add_folder` - `name`. Creates a context running the `board` service in
  `BOARD_NAMESPACE` and aliases it by name; returns its context id. Requires
  `BOARD_NAMESPACE` (errors under the `BOARD_CONTEXT` direct pin). Rejects a
  name that already exists.

Boards:

- `list_boards` - optional `include_archived` (default `false`).
- `create_board` - `name` (1-64 chars). Returns `{ id }`.
- `rename_board` - `board_id`, `name`.
- `archive_board` - `board_id`, `archived` (`true` archives, `false` restores).
- `delete_board` - `board_id`. Creator only.
- `get_board` - `board_id`. Returns `{ board, lists, cards }`, lists and
  unarchived cards by rank.

Lists:

- `create_list` - `board_id`, `name`. Returns `{ id }`.
- `rename_list` - `list_id`, `name`.
- `move_list` - `list_id`, `position` (`after:<list id>`).
- `delete_list` - `list_id`. Fails while the list holds unarchived cards.

Cards:

- `create_card` - `board_id`, `list_id`, `title`; optional `description`,
  `assignee`, `due_at` (unix ms), `labels`. Returns `{ id }`.
- `list_cards` - optional exact filters `board_id`, `list_id`, `assignee`,
  `label`, plus `include_archived` (default `false`).
- `get_card` - `card_id`. The card with its checklist and comments.
- `move_card` - `card_id`, `list_id` (same board), `position`
  (`after:<card id>` must name a card already in that list).
- `set_card` - `card_id`, any of `title`, `description`, `assignee`,
  `due_at`, `archived`. Omitted fields are untouched; `null` clears
  `assignee` / `due_at`. Returns the updated card.
- `add_label` / `remove_label` - `card_id`, `label` (1-32 chars).
- `add_checklist_item` - `card_id`, `text`. Returns `{ id }`.
- `set_checklist_item_done` - `item_id`, `done`.
- `add_comment` - `card_id`, `body`. Returns `{ id }`.
- `delete_card` - `card_id`. Creator only; prefer `set_card` with
  `archived: true` to hide a card.

## Config (env vars)

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `CALIMERO_NODE_URL` | no | `http://localhost:2428` | Base URL of the local node. |
| `BOARD_NAMESPACE` | yes, unless `BOARD_CONTEXT` is set | - | The workspace namespace id, or a name resolved via `GET /admin-api/namespaces`. Folders are the namespace's aliased contexts (see `folder` above). |
| `BOARD_FOLDER` | no | - | Default folder (context alias) within the namespace, used when a tool call omits `folder`. |
| `BOARD_CONTEXT` | no | - | Direct pin to a single context id or alias. When set, it bypasses namespace/folder resolution entirely and every `folder` param is ignored. |
| `CALIMERO_AUTH_TOKEN` | no | - | Bearer token sent to both `/admin-api` and `/jsonrpc`. |
| `BOARD_EXECUTOR` | no | - | Executor public key for RPC calls. If unset, resolved from the node's first owned identity for the target context (`GET /admin-api/contexts/{id}/identities-owned`). |
| `BOARD_SERVICE` | no | `board` | Service name passed to `createContext` by `add_folder`. |

## Run it

```bash
pnpm --filter @calimero-network/mero-board-mcp start
```

## Wire it into Claude Code

The primary path is `npx`, no clone required (needs the package published to
npm, which is not wired up yet - see "Publishing" below):

```bash
claude mcp add board --scope user \
  --env CALIMERO_NODE_URL=http://localhost:2428 \
  --env BOARD_NAMESPACE=my-team \
  --env BOARD_FOLDER=marketing \
  -- npx -y @calimero-network/mero-board-mcp
```

Or as JSON config:

```json
{
  "mcpServers": {
    "board": {
      "command": "npx",
      "args": ["-y", "@calimero-network/mero-board-mcp"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "BOARD_NAMESPACE": "my-team",
        "BOARD_FOLDER": "marketing"
      }
    }
  }
}
```

If you're contributing to this repo, run it from source instead:

```json
{
  "mcpServers": {
    "board": {
      "command": "pnpm",
      "args": ["--filter", "@calimero-network/mero-board-mcp", "start"],
      "env": {
        "CALIMERO_NODE_URL": "http://localhost:2428",
        "BOARD_NAMESPACE": "my-team",
        "BOARD_FOLDER": "marketing"
      }
    }
  }
}
```

`BOARD_FOLDER` is only a default - pass `folder` on individual tool calls to
target another folder in the same namespace without restarting the server.
Omit it if the namespace has one folder; it's inferred automatically.

Add `CALIMERO_AUTH_TOKEN` / `BOARD_EXECUTOR` to `env` only if you need them -
both are optional (see the table above).

## Tests

```bash
pnpm --filter @calimero-network/mero-board-mcp test       # node:test, mocked fetch
pnpm --filter @calimero-network/mero-board-mcp typecheck
```

Outside the pnpm workspace: `cd mcp && pnpm install --ignore-workspace --no-lockfile`, then `pnpm test`.

## Publishing

Publishing to npm is not wired up yet: there is no release workflow for this
package, so until there is, run it from source (above).

## Live smoke test

`scripts/smoke.mjs` drives the real stdio server against a running node over
the MCP protocol (initialize -> tools/list -> tools/call): it checks the
board tools are registered, then calls `list_folders` and `list_boards`. It is
read-only. Point it at a node with a mero-board namespace:

```bash
CALIMERO_NODE_URL=http://localhost:2428 \
BOARD_NAMESPACE=my-team \
BOARD_FOLDER=marketing \
CALIMERO_AUTH_TOKEN=<token if the node enforces auth> \
node scripts/smoke.mjs
```
