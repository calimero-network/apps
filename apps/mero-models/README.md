# Mero Models

A Blender-style 3D modeller where the scene is not hosted anywhere.

A scene is a Calimero context: objects, meshes, materials and lights replicated
between its members' own nodes. Everyone in the scene sees every change as it
lands, sees what the others have selected and where they are looking from, and
the scene's admin decides who may edit — enforced by the contract on every node.

```
apps/mero-models/
├── logic/                     Rust → WASM. The whole backend.
│   ├── src/lib.rs             #[app::state] objects, meshes, environment, members, roles
│   ├── src/tests.rs           TestHost tests: roles, validation, stamps, the hierarchy rule
│   ├── tests/converge.rs      two replicas editing one object at the same instant
│   ├── res/                   abi.json + state-schema.json, emitted by `cargo mero build`
│   └── workflows/             merobox: two real nodes sharing, refusing and granting edits
└── app/                       Vite + React + TypeScript + three.js
    ├── src/editor/            the modeller: no React in here except hooks.ts
    │   ├── model.ts           kinds, limits, hierarchy rules (mirrors the contract)
    │   ├── geometry.ts        primitives, welding, subdivide/smooth/extrude/merge/decimate
    │   ├── store.ts           zustand store: the scene, selection, undo/redo
    │   ├── sync.ts            optimistic writes, the outbox, read-back without flicker
    │   ├── viewport.ts        three.js: rendering, picking, gizmo, edit mode, peers
    │   ├── commands.ts        every menu item and shortcut, as one undoable change each
    │   ├── io.ts              OBJ/STL/glTF import, glTF/OBJ/STL/JSON export
    │   └── hooks.ts           sync, join and ephemeral presence, as React hooks
    ├── src/studio/            the panels: menu bar, toolbar, outliner, properties, share
    └── src/generated/         the typed client — generated, committed, diffed in CI
```

## Run it

```bash
pnpm install                         # once, at the repo root
cargo mero build -p mero-models      # emits res/mero_models.wasm + res/abi.json
pnpm -F mero-models codegen          # regenerates src/generated from that ABI
pnpm -F mero-models dev              # http://localhost:5173
```

Install the bundle on a node, open the app, connect, and press **New scene**.
Under `AppMode.MultiContext` the auth callback returns tokens and an application
id and nothing else, so picking a scene is the app's job. **Share** mints an
invite link; tick **Can edit** beside someone to let them build.

## Using it

| | |
| --- | --- |
| **Navigate** | left-drag orbits (middle-drag with the Select tool), right-drag pans, scroll zooms; the axis gizmo top-right snaps to a view |
| **Add** | `Shift+A`, the Add menu, or the toolbar: cube, UV/ico sphere, cylinder, cone, torus, plane, capsule, point/spot/sun lights, empty |
| **Transform** | `G` move · `R` rotate · `S` scale · `W` box select; hold `Ctrl` to snap; Global/Local space; numbers in Properties scrub when dragged and take arithmetic when typed |
| **Edit** | `Shift+D` duplicate · `X`/`Delete` delete · `H` hide, `Alt+H` show · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · Array… |
| **Hierarchy** | drag rows in the outliner · `Ctrl+G` group · `Ctrl+P` parent to active · `Alt+P` clear parent |
| **Mesh** | `Tab` edit vertices (converts a primitive) · `A` select all · `E` extrude faces · `M` merge · subdivide, smooth, decimate, flip normals, `Ctrl+J` join, `Ctrl+A` apply transforms, origin to geometry, mirror |
| **View** | `F` frame selected · `Home` frame all · `1`/`3`/`7` front/right/top (`Shift` for the opposite) · `5` ortho · `Z` cycles wireframe/solid/material |
| **Files** | import OBJ, STL, glTF/GLB, or a scene `.json`; export GLB, OBJ, STL or scene `.json`; `F12` renders a PNG |

## How it stores a scene

| field | tier | why |
| --- | --- | --- |
| `objects` | `PermissionedStorage<UnorderedMap<id, SceneObject>>` | one record per object, whole-record LWW; only editors can write, checked on every node |
| `meshes` | `PermissionedStorage<UnorderedMap<id, MeshData>>` | vertex data apart from the object, so a move never rewrites 30 000 vertices |
| `environment` | `PermissionedStorage<UnorderedMap<…>>` | the scene's name, background and ambient light |
| `members` | `UserStorage<Member>` | each person's display name, written only by them |
| `roles` | `AccessControl` | the creator is admin; editors are granted, and projected onto the collections above |

Three decisions carry the design:

- **One record per object, merged whole.** Two people dragging the same cube
  resolve to one of their writes on every node — never a cube that took its
  position from one and its colour from the other (`tests/converge.rs`).
- **The hierarchy is the reader's.** Two concurrent re-parents can form a loop
  that no write-time check could prevent. Every reader resolves a missing
  parent or a loop to the root, the same way (`resolve_parents`, mirrored in
  `model.ts`).
- **Presence is not state.** Selections and cameras stream over the node's
  ephemeral channel. Moving the camera is never a transaction; moving an object
  is one, sent once when the drag ends.

The frontend is optimistic: an edit shows at once and goes out through an
outbox that writes one change at a time and folds queued ones together. A read
from the node never drags back an object whose write is still in flight
(`sync.ts`, `sync.test.ts`).

## Limits

2 000 objects a scene, 200 per call, 30 000 vertices and 60 000 triangles a
mesh. An import over the mesh limit is decimated to fit, and the status bar
says by how much.

## Tests

```bash
cargo test -p mero-models            # contract rules + two-replica convergence
pnpm -F mero-models test             # geometry, hierarchy, store, sync, codegen drift
pnpm -F mero-models test:e2e         # Playwright against a real merod (needs the .mpk)
```

`logic/workflows/edit-a-scene.yml` is the two-node merobox scenario: a viewer
refused, an editor granted, edits read back on the other node.
