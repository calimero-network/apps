# Mero Drive

A private, end-to-end encrypted document workspace on the [Calimero](https://calimero.network) P2P network. Namespaces hold folders; folders hold documents. Everything is a CRDT, nothing leaves your device in plaintext.

## What ships in this repo

- **`logic/`** — Rust workspace (v9) that compiles to a **multi-service WASM bundle** (`.mpk`)
  - `crates/registry` — folder metadata & the group-context registry for a namespace
  - `crates/docs` — document CRUD + tags + archive inside a folder context
  - `crates/types` — shared types (`FolderId`, `ContextId`, `Visibility`, `DriveError`) + ABI-stable constants
- **`app/`** — React + Tiptap web app; talks to a Calimero node via `@calimero-network/mero-react` hooks
- **`e2e/`** — five merobox workflows exercising the full user surface (see [CI](#ci))

## Feature set

- **Namespaces** — each namespace is a Calimero group hierarchy; switch between them from the top bar
- **Folders as contexts** — each folder is a subgroup with its own CRDT state; members inherit from the parent unless visibility is `Restricted`
- **Rich-text docs** — Tiptap editor, HTML-stored, autosave with ordering-safe sequence guard
- **Fine-grained permissions** — per-member capability bitmask (`READ | WRITE | CREATE_GROUP | MANAGE_GROUP | INVITE_MEMBERS | MANAGE_MEMBERS`) layered on top of coarse roles (Admin / Member / ReadOnly)
- **Member management** — invite, role transitions, per-member capability overrides, namespace-wide defaults
- **Tags & archive** — tag docs, filter by tag, archive without deleting
- **Cross-node sync** — every namespace and folder is a CRDT; writes converge without conflict

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io) 9
- Rust stable + `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Docker (for local merobox nodes)
- [merobox](https://calimero-network.github.io/merobox) for the e2e workflows

## Quick start

```bash
# 1. Install
pnpm install
pnpm --dir app install

# 2. Build the WASM bundle (.mpk)
pnpm run logic:build
pnpm run logic:bundle           # produces logic/dist/com.calimero.mero-drive-docs-9.0.0.mpk

# 3. Bootstrap a local node + install the bundle
pnpm run network:bootstrap

# 4. Generate the TypeScript client from the ABI
pnpm run app:generate-client

# 5. Start the dev server
pnpm run app:dev
```

Open the browser, connect to your local node, create a namespace, and you're in.

## Project layout

```
mero-drive/
├── logic/
│   ├── Cargo.toml                  # workspace root
│   ├── manifest.json               # multi-service bundle manifest
│   ├── build-bundle.sh             # .mpk build + signing
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
└── e2e/
    ├── workflow-mero-drive-e2e.yml                  # main registry+docs integration
    ├── workflow-mero-drive-reconciliation.yml       # drift scenarios
    ├── workflow-mero-drive-docs-lifecycle.yml       # DocsClient full coverage
    ├── workflow-mero-drive-members.yml              # member lifecycle + bitmask roundtrips
    └── workflow-mero-drive-namespace-lifecycle.yml  # rename / delete / multi-ns isolation
```

## Backend surface (WASM service methods)

### Docs service — one context per folder

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

### Registry service — one context per namespace

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

- **Role** (`Admin` / `Member` / `ReadOnly`) — coarse tier. Admins bypass the capability check; role changes never mutate the capability column.
- **Capability bitmask** (u32) — per-member delegation of specific bits. `get_member_capabilities` returns only this override (0 if never set), never a role-derived "effective" mask.

Admin-only operations (`update_member_role`, `add_group_members` admin path, `set_member_capabilities` itself) require role=Admin; they cannot be delegated via capability bits. Cap-delegatable operations (`create_group_invitation`, `create_context`) pass if the caller is Admin OR has the relevant bit.

UI helpers:
- [`useFolderPermissions`](app/src/hooks/useFolderPermissions.ts) — wraps the role+caps read for a specific folder
- [`useNamespacePermissions`](app/src/hooks/useNamespacePermissions.ts) — same at the namespace root

## Development workflow

```bash
# Logic
pnpm run logic:build                          # cargo build + ABI emit
pnpm run logic:bundle                         # .mpk build (signed if test key available)
pnpm run logic:clean                          # rm target + res

# App
pnpm run app:dev                              # Vite + WASM watcher
pnpm run app:build                            # production build
pnpm --dir app lint
pnpm --dir app test                           # Vitest unit tests

# Generated client
pnpm run app:generate-client                  # regenerate DocsClient/RegistryClient from logic/res/abi.json
```

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every PR:

- **Frontend** — lint + vitest + build
- **Logic (Rust)** — `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`, WASM build for both crates
- **Bundle** — assembles the `.mpk` artifact and uploads it for reviewers + the e2e job
- **E2E (matrix)** — five parallel merobox cells (`main`, `reconciliation`, `docs-lifecycle`, `members`, `namespace-lifecycle`), each with 2-attempt retry and per-cell `docker logs` collection

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
pnpm run logic:build && pnpm run logic:bundle && pnpm run network:bootstrap
```

## Links

- [Calimero docs](https://docs.calimero.network)
- [Calimero on GitHub](https://github.com/calimero-network)
- [Merobox workflow reference](https://calimero-network.github.io/merobox)

## License

MIT
