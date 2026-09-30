# Mero Docs

A private, end-to-end encrypted document workspace on the [Calimero](https://calimero.network) P2P network. Namespaces hold folders; folders hold documents. Everything is a CRDT, nothing leaves your device in plaintext.

## What ships in this repo

- **`logic/`** - Rust workspace (v9) that compiles to a **multi-service WASM bundle** (`.mpk`)
  - `crates/registry` - folder metadata & the group-context registry for a namespace
  - `crates/docs` - document CRUD + tags + archive inside a folder context
  - `crates/types` - shared types (`FolderId`, `ContextId`, `Visibility`, `DriveError`) + ABI-stable constants
- **`app/`** - React + Tiptap web app; talks to a Calimero node via `@calimero-network/mero-react` hooks
- **`logic/workflows/`** - the merobox scenarios CI runs (see [CI](#ci))

## Feature set

- **Namespaces** - each namespace is a Calimero group hierarchy; switch between them from the top bar
- **Folders as contexts** - each folder is a subgroup with its own CRDT state; members inherit from the parent unless visibility is `Restricted`
- **Rich-text docs** - Tiptap editor, HTML-stored, autosave with ordering-safe sequence guard
- **Fine-grained permissions** - per-member capability bitmask (`READ | WRITE | CREATE_GROUP | MANAGE_GROUP | INVITE_MEMBERS | MANAGE_MEMBERS`) layered on top of coarse roles (Admin / Member / ReadOnly)
- **Member management** - invite, role transitions, per-member capability overrides, namespace-wide defaults
- **Tags & archive** - tag docs, filter by tag, archive without deleting
- **Cross-node sync** - every namespace and folder is a CRDT; writes converge without conflict

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io) 9
- Rust stable + `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- A `merod` binary on PATH or in `MEROD_BINARY`
- [merobox](https://calimero-network.github.io/merobox) for the e2e workflows

## Quick start

```bash
pnpm install
pnpm run app:generate-client          # TypeScript client from the ABI
MEROD_BINARY=/path/to/merod scripts/local-rig.sh up
pnpm run app:dev
```

`scripts/local-rig.sh up` builds the bundle, starts three merod nodes on ports 3920-3925 under `/tmp/merodocs-rig`, installs the bundle on each, creates the namespace, the folder group and its docs context, joins the other two nodes, waits for them to agree on one context state hash, and writes `app/.env.integration`.
`RIG_BUNDLE=<path.mpk>` installs that bundle instead of building one.
It stops only the processes it started, recorded in `/tmp/merodocs-rig/rig.pids`.

```bash
scripts/local-rig.sh status           # per node: URL, pid, online or offline
scripts/local-rig.sh offline 2        # stop node 2, keeping its home
scripts/local-rig.sh online 2         # start it again on the same home and ports
scripts/local-rig.sh down             # stop every node this script started
```

The dev server serves the rig to the browser under `/__dev` (dev builds only): `GET /__dev/nodes` is the node list, `POST /__dev/node/<n>/offline` and `/online` are the switch.
The dev panel in the bottom right shows which node this window talks to, toggles any node, and portals an inspector into `#dev-inspector`.

`?node=<n>` points a window at rig node n.
Two windows need two origins, because one origin is one `localStorage`: open `http://localhost:5179/app?node=1` and `http://127.0.0.1:5179/app?node=2`.

## Project layout

```
mero-docs/
├── logic/
│   ├── Cargo.toml                  # workspace root; [workspace.metadata.calimero] drives `cargo mero bundle`
│   ├── assets/                     # bundle icon (keep in sync with app/public/icons/)
│   └── crates/
│       ├── types/                  # FolderId, ContextId, Visibility, DriveError
│       ├── registry/               # per-namespace folder registry
│       └── docs/                   # per-folder document store
├── app/
│   └── src/
│       ├── api/                    # thin admin-API client + generated DocsClient/RegistryClient
│       ├── hooks/                  # useDocs, useFolderPermissions, useNamespacePermissions,
│       │                           # useWorkspaceBootstrap, useFolderOperations, useDocEvents, …
│       ├── context/                # WorkspaceContext + RegistryContext providers
│       ├── components/
│       │   ├── workspace/          # NamespaceSwitcher, WorkspaceLayout, NamespaceMembersPanel,
│       │   │                       # NamespaceSettingsPanel, NamespaceCreateDialog
│       │   ├── folders/            # FolderTree, FolderBreadcrumb, FolderSharingPanel
│       │   ├── docs/               # DocumentList, DocumentEditor
│       │   ├── editor/             # EditorShell, EditorHeader, EditorToolbar, EditorStatusBar
│       │   ├── admin/              # MemberRoleSelect, NamespaceMemberRow, WorkspaceSettingsPanel
│       │   └── ui/                 # shadcn-style primitives + ConfirmDialog
│       └── constants/              # app-id, service ids, capability bits
└── scripts/
    └── local-rig.sh                # three local merod nodes + app/.env.integration
```

## Backend surface (WASM service methods)

### Docs service - one context per folder

| Method | Description |
|---|---|
| `create_doc(title, content)` | Create a new document; returns the generated id |
| `get_doc(id)` | Read a document |
| `list_docs(include_archived)` | List documents in this folder's context |
| `edit_doc(id, { title?, content? })` | Update title and/or content |
| `archive_doc(id)` / `unarchive_doc(id)` | Toggle archive state |
| `delete_doc(id)` | Hard-delete |
| `add_tag(id, tag)` / `remove_tag(id, tag)` | Mutate tag set (remove is idempotent) |

Events: `DocCreated`, `DocEdited`, `DocArchived`, `DocUnarchived`, `DocDeleted`, `DocTagsChanged`.

### Registry service - one context per namespace

| Method | Description |
|---|---|
| `register_folder(id, alias, parent?, color?, visibility)` | Announce a folder in the namespace registry |
| `unregister_folder(id)` | Drop a folder from the registry |
| `get_folder(id)` / `get_folders()` | Read one or all folder records |
| `bind_folder_context(folder_id, context_id)` | Attach a Calimero context to a folder entry |
| `get_folder_context(folder_id)` | Resolve folder → context |
| `set_visibility(id, Inherit \| Restricted)` | Change member-inheritance behavior |
| `set_color(id, color)` | Set the UI color accent |
| `move_folder(id, new_parent?)` / `reorder(...)` / `get_sort_order(...)` | Tree structural ops |

### Admin-API surface (via Calimero node, not this bundle)

The app uses admin-API endpoints directly for namespace, group and member management:

- `create_namespace`, `delete_namespace`, `list_namespaces`
- `list_namespace_groups`, `create_group_in_namespace`, `set_group_alias`, `delete_group`
- `add_group_members`, `remove_group_members`, `list_group_members`
- `update_member_role`, `set_member_capabilities`, `get_member_capabilities`
- `set_default_capabilities`, `set_default_visibility`
- `create_context`, `join_context`, `delete_context`
- `/alias/create/context`, `/alias/lookup/context/{name}` (bootstrap)

See [`useWorkspaceBootstrap`](app/src/hooks/useWorkspaceBootstrap.ts) for the lookup→create→alias-set race-recovery pattern.

## Permissions model

Two-axis authorization, enforced server-side in `calimero-network/core`:

- **Role** (`Admin` / `Member` / `ReadOnly`) - coarse tier. Admins bypass the capability check; role changes never mutate the capability column.
- **Capability bitmask** (u32) - per-member delegation of specific bits. `get_member_capabilities` returns only this override (0 if never set), never a role-derived "effective" mask.

Admin-only operations (`update_member_role`, `add_group_members` admin path, `set_member_capabilities` itself) require role=Admin; they cannot be delegated via capability bits. Cap-delegatable operations (`create_group_invitation`, `create_context`) pass if the caller is Admin OR has the relevant bit.

One layer sits on top: the per-folder **document role** (`Viewer` / `Editor` / `Manager`, stored in the registry service).
The docs service never reads it, so the sharing panel's "Read only" also makes the member core `ReadOnly` in the folder's group, and in each Open sub-folder reached through it, stopping at a Restricted sub-folder.
A Restricted sub-folder someone was invited to directly keeps the role its admin gave them.
Core reads only the direct row of each folder's group, so a member who only inherits an Open folder gets a direct `ReadOnly` row there.
While the member holds those rows, nodes refuse their writes to those folders' docs, comments included, with a `ReadOnlyWriteRefused` error; an editor page that still offered the edit drops it and shows the node's text.
Read only lasts while the member stays in the folder: someone who leaves and comes back through a fresh invite is a normal member again.
Setting them back to Editor or Manager ends Read only across the same sub-folders; each sub-folder goes back to Editor, since the role a member held there before Read only is not recorded.
The rows Read only wrote in Open sub-folders stay as direct Member rows after that, so restricting such a folder or making the person a Guest leaves them in with write access; remove them from the folder to take it away (the Make restricted confirmation names them).
A Read only member who is the admin of a sub-folder keeps writing there: core does not demote a folder's admin.
When an existing folder is opened, the parent's Read only members can write in it and its Open sub-folders, and a Read only person restored to an Open folder can write in its Open sub-folders, for the moment before their Read only rows are written; writing those rows first would add them to folders that are still Restricted, or that still ban them. A folder created Open gets the rows before it opens.
An Open sub-folder created or opened later takes Read only from its parent, and its admin re-applies it when opening its sharing panel, which covers two admins acting at once.
Removing someone from a folder also removes them from the Open sub-folders reached through it, stopping at a Restricted folder.
In an Open folder a removal is a ban: it lasts until an admin restores them from that folder's Removed list (each folder has its own), and a workspace re-invite does not lift it; someone the parent holds Read only comes back Read only.
Only the folder's admin can change a folder role, since core takes the role and caps change from its admin alone.

UI helpers:
- [`useFolderPermissions`](app/src/hooks/useFolderPermissions.ts) - wraps the role+caps read for a specific folder
- [`useNamespacePermissions`](app/src/hooks/useNamespacePermissions.ts) - same at the namespace root

## Development workflow

```bash
# Logic
pnpm run logic:build                          # build both crates + package the .mpk bundle
pnpm run logic:clean                          # rm target + per-crate res/ + dist/

# App
pnpm run app:dev                              # Vite + WASM watcher
pnpm run app:build                            # production build
pnpm --dir app lint
pnpm --dir app test                           # Vitest unit tests
pnpm --dir app exec playwright test           # browser e2e: starts two merod ($MEROD_BINARY) with the logic:build bundle

# Generated client
pnpm run app:generate-client                  # regenerate DocsClient/RegistryClient from logic/res/abi.json
```

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every PR:

- **Frontend** - lint + vitest + build
- **Logic (Rust)** - `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`, WASM build for both crates
- **Bundle** - assembles the `.mpk` artifact and uploads it for reviewers + the e2e job
- **E2E (mero-docs)** - every scenario in `logic/workflows/`, each retried against the cold-join race, with node logs collected per scenario
- **Browser E2E (mero-docs)** - the Playwright projects; `single-node` and `two-node` run against nodes the suite starts itself, or against the rig when `app/.env.integration` exists
- **Browser E2E rich (mero-docs)** - the `rich` Playwright project, the live collab session, against a three-node rig brought up with CI's bundle

Known upstream merobox gaps that block additional coverage are tracked as [calimero-network/merobox#214](https://github.com/calimero-network/merobox/issues/214) (`expected_failure` not honored by group_management step classes), [#215](https://github.com/calimero-network/merobox/issues/215) (context-alias steps), [#216](https://github.com/calimero-network/merobox/issues/216) (wait-for-SSE-event), and [#217](https://github.com/calimero-network/merobox/issues/217) (generic admin-API HTTP step).

## Troubleshooting

**WASM build fails**
```bash
rustup target add wasm32-unknown-unknown
```

**Vite cache stale after regenerating the client**
```bash
rm -rf app/node_modules/.vite
```

**Local node + bundle out of sync**
```bash
scripts/local-rig.sh down && scripts/local-rig.sh up
```

## Links

- [Calimero docs](https://docs.calimero.network)
- [Calimero on GitHub](https://github.com/calimero-network)
- [Merobox workflow reference](https://calimero-network.github.io/merobox)

## Owned keys are per owner (core 0.11.0-rc.57)

Since core 0.11.0-rc.57 every owned collection (`Authored…`, `WriteOnce`, `Moderated`,
`ModeratedOnce`) is one namespace per account: two accounts writing one key hold two
independent entries, and a key-only `get`, `contains`, `owner_of`, `owned_by_me` or `remove`
acts on the CALLER's own entry only. This app was migrated:

- **Registry.** Every read of a folder by id goes through the entry of the **lowest
  account** holding it, and its context binding is that account's own (`get_by`).
  `register_folder` refuses an id **any** account holds (it used to rely on the key being
  taken). A moderator's `unregister_folder` removes every holder's entry with `remove_by`.
- **Docs.** A doc's creator is the one origin entry whose owner carries the doc id's
  account tag; with none or several the doc has no known creator. Comments are read by id
  through the lowest holder, a listed comment's author is matched among its id's holders,
  `comment_schema_version` reads the holder's entry by name, and a moderator's
  `delete_comment` removes every holder's comment with `remove_by`.

## License

MIT
