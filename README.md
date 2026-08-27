# Mero Apps

**Monorepo for every application built on the [Calimero network](https://github.com/calimero-network/core).**

Calimero apps have no backend server. A Rust/WASM contract *is* the backend, it runs inside each
participant's own node, and state replicates peer-to-peer as CRDTs. There is no central database, no
API tier, and no operator who can read your data. Every app in here is a demonstration of what that
architecture makes possible — chat, video calls, design tools, spreadsheets, games, AR — built the
same way, on the same stack.

This repository consolidates apps that currently live in their own repos, so they share one toolchain,
one dependency graph, one CI pipeline, and one release process instead of drifting apart in fifteen
places.

> **Status: migrating, one app at a time.** `kv-store` is in. Every other app below still lives in
> its own repository and remains the source of truth until it is moved here. See
> [Migrating an app](#migrating-an-app).

---

## Why a monorepo

The apps are independent products, but they are not independent codebases. They share:

- **The same SDKs** — [`mero-js`](https://github.com/calimero-network/mero-js),
  [`mero-react`](https://github.com/calimero-network/mero-react),
  [`calimero-sdk`](https://github.com/calimero-network/core) (Rust).
- **The same design language** — [`design-system`](https://github.com/calimero-network/design-system).
- **The same build tooling** — [`cargo-mero`](https://github.com/calimero-network/cargo-mero) for
  WASM bundles, Vite + TypeScript for frontends.
- **The same release path** — signed `.mpk` bundles published to the
  [app registry](https://apps.calimero.network/).
- **The same integration surface** — auth/SSO, invite links, desktop deep-linking, node discovery.

Every core release therefore fans out into a dozen near-identical dependency bumps, and every SDK
breaking change has to be discovered fifteen separate times. A monorepo turns that fan-out into a
single atomic change with a single CI signal.

## What it gives us

| | Today (many repos) | Here (one repo) |
| --- | --- | --- |
| SDK bump | N pull requests, N CI runs, N review cycles | one PR, one CI run |
| Breaking SDK change | found app-by-app, over days | found at author time, in one build |
| Shared UI code | copy-pasted or published as a package | imported directly |
| Version skew | routine (apps sit on different core RCs) | impossible by construction |
| Adding an app | new repo, new CI, new secrets, new release workflow | a directory |

## Apps

### In this repo

| App | What it is |
| --- | --- |
| [kv-store](apps/kv-store) | The reference app. An `UnorderedMap<String, LwwRegister<String>>` exercised end to end, with a typed client generated from the contract's own ABI. Start here. |

### Still in their own repos

#### Collaboration & productivity

| App | What it is |
| --- | --- |
| [mero-design](https://github.com/calimero-network/mero-design) | Figma-style infinite canvas — shapes, text, images, SVG blobs, real-time multi-member editing. |
| [mero-pixart](https://github.com/calimero-network/mero-pixart) | Photoshop/Photopea-style image editor — layers, masks, adjustments, curves, collaborative. |
| [p2p-sheets](https://github.com/calimero-network/p2p-sheets) | Collaborative spreadsheet — CRDT inputs, derive-on-read recalc engine, formulas, live cursors. |
| [mero-calendar](https://github.com/calimero-network/mero-calendar) | Shared team calendars in replicated state, plus genuinely private events in node-local storage. |
| [mero-drive](https://github.com/calimero-network/mero-drive) | Peer-to-peer file storage and documents. |
| [mero-issue-tracker](https://github.com/calimero-network/mero-issue-tracker) | Issue tracker for dev teams whose backlog lives on their own nodes. |

#### Communication

| App | What it is |
| --- | --- |
| [mero-chat-pwa](https://github.com/calimero-network/mero-chat-pwa) | Group channels and DMs as an installable PWA, with offline support. |
| [mero-meet](https://github.com/calimero-network/mero-meet) | Video calling — a context is the room, the contract is the signaling relay, media flows direct over WebRTC. No SFU. |

#### Games

| App | What it is |
| --- | --- |
| [mero-blocks](https://github.com/calimero-network/mero-blocks) | Minecraft-style multiplayer voxel sandbox. No game server — the world is a context. |
| [merraria](https://github.com/calimero-network/merraria) | Terraria-style 2D mining sandbox — seed-generated terrain, CRDT tile diff, in a ~45 kB bundle. |
| [battleships](https://github.com/calimero-network/battleships) | Turn-based Battleships, the smallest end-to-end example of contract-mediated game state. |

#### Native / mobile

| App | What it is |
| --- | --- |
| [mero-tag](https://github.com/calimero-network/mero-tag) | AirTag/Find My-style iOS location sharing between your own nodes. SwiftUI + MapKit. |
| [mero-ar](https://github.com/calimero-network/mero-ar) | Collaborative spatial editing — several people scan one room and edit a shared 3D scene. ARKit + RealityKit. |

#### Experiments

| App | What it is |
| --- | --- |
| [mero-stream](https://github.com/calimero-network/mero-stream) | Deliberately wrong-way media capacity probe — an integer-only codec inside the contract, to find the node's ceiling with numbers. Not shippable media. |

<details>
<summary>Deprecated</summary>

| App | Status |
| --- | --- |
| [mero-chat](https://github.com/calimero-network/mero-chat) | Abandoned. Superseded by `mero-chat-pwa`. Not being migrated. |

</details>

## Anatomy of a Mero app

Every app here has the same two halves, and the boundary between them is the ABI:

```
my-app/
├── logic/            # Rust → WASM. The whole backend.
│   ├── src/lib.rs    #   #[app::state] state, #[app::logic] methods, #[app::event] events
│   └── Cargo.toml    #   built and bundled by `cargo mero build`
├── app/              # Frontend. Vite + React + TypeScript.
│   └── src/          #   talks to the local node via mero-js / mero-react
└── e2e/              # merobox-driven multi-node integration tests
```

The frontend never talks to a server. It talks to *its own* node over JSON-RPC, the node executes the
contract locally, and the resulting state delta gossips to the other members of the context. The
"multiplayer" is a property of the network, not of the application code.

## Layout

```
apps/                       one directory per application
└── kv-store/
    ├── logic/              Rust → WASM. A workspace member.
    │   ├── src/lib.rs
    │   ├── tests/          TestHost + convergence, no node needed
    │   ├── res/            abi.json + state-schema.json, emitted by cargo mero
    │   └── workflows/      merobox e2e
    └── app/                Vite + React + TS. A pnpm workspace package.
        └── src/generated/  typed client, generated from res/abi.json

scripts/                    check-app-metadata.sh
.github/workflows/          ci.yml · release.yml · publish-bundle.yml (reusable)

Cargo.toml                  ONE SDK pin, and the release profiles
pnpm-workspace.yaml         ONE version per JS dependency, via catalog:
requirements-e2e.txt        merobox AND calimero-client-py, pinned together
tsconfig.base.json
```

Contracts are a Cargo workspace; frontends are a pnpm workspace; CI path-filters
so touching one app does not rebuild the others — and a change to the workspace
root fans out to all of them, because bumping the SDK changes every contract's
bytes.

## One pin, one place

The problem this repo exists to solve, measured across the nine app repos on
2026-08-26:

| pin | distinct values in the fleet |
| --- | --- |
| `calimero-sdk` tag | **5** — rc.15, rc.23, rc.24, rc.25, `branch = "master"` |
| `merod` image | 3 |
| `merobox` | 3, one repo unpinned |
| `calimero-client-py` | pinned in **1 of 9** |
| `typescript` / `vite` / `vitest` / `react` | 3 / 3 / 4 / 4 |

Thirteen pins × nine apps is up to 117 places to edit for one decision. Here it
is 13.

Two of those rows are not cosmetic. **`calimero-client-py` is a transitive
dependency of merobox that tracks core master** — pinning merobox alone pins
nothing, and 0.6.27 broke `create_namespace` while 0.6.26 broke `join_namespace`,
so a commit changing nothing could turn the e2e red. And every copy of the
release workflow hard-coded its own default branch, so copying it into a repo
whose default was the other name produced a workflow that was valid YAML, passed
lint, and **never ran**. One repo has one default branch.

## Working in here

```bash
pnpm install                          # whole workspace, one lockfile
cargo mero build -p <app>             # contract → wasm + ABI
pnpm -F <app> codegen                 # ABI → typed client
pnpm -F <app> dev

cargo test --workspace                # every app's Rust tests, SDK compiled once
pnpm -r test
bash scripts/check-app-metadata.sh    # registry metadata vs the workspace
```

### Bumping core

Edit the three `calimero-sdk*` tags plus `min-runtime-version` and `merod-image`
in the root `Cargo.toml`, run `cargo update`, push. CI rebuilds every app and the
release workflow republishes all of them, because the SDK pin changes every
contract's bytes.

`scripts/check-app-metadata.sh` fails if any app's `min-runtime-version` drifts
from the workspace value. That check exists because
`[package.metadata.calimero]` **cannot be inherited by cargo** — `.workspace = true`
inside `[package.metadata]` resolves to the literal `{"workspace": true}`, since
`metadata` is not on cargo's inheritable list.

⚠️ **`cargo mero` parses `[workspace.metadata.calimero]` too, with
`deny_unknown_fields`.** Only its own field names may appear there:

```
Error: invalid [..metadata.calimero] table: unknown field `merod-image`,
expected one of `package`, `name`, `description`, `author`, `icon`, `slug`,
`license`, `tags`, `github`, `docs`, `min-runtime-version`, `frontend`, `services`
```

So fleet-wide values that are *ours* rather than cargo-mero's live in
`[workspace.metadata.mero-apps]`, which no tool but ours reads.

### Adding an app

A directory. `apps/<name>/{logic,app}`, `logic/Cargo.toml` with
`.workspace = true` deps and a `[package.metadata.calimero]` block, `app/package.json`
with `catalog:` versions. Both matrices are derived from `cargo metadata`, so
there is no list to update.

⚠️ **Profiles must stay at the workspace root.** Cargo *ignores* `[profile.*]` in
a member and then refuses to build:

```
warning: profiles for the non root package will be ignored
error: profile `app-release` is not defined
```

`cargo mero build` selects `app-release`, so an app that brought its own profile
block simply fails. Delete it on the way in.

## Migrating an app

Apps move one at a time, with git history preserved (`git subtree` / `git filter-repo`).

**Migrate an app at whatever SDK version it is already on, then bump it here.**
Never both in one step — when a build goes red it should have one possible cause.

Each move is mechanical: bring the tree in, delete its workflow files and its
copy of the cargo-mero action, rewrite `logic/Cargo.toml` to `.workspace = true`
and move its profile block to the root, rewrite `app/package.json` to
`catalog:`. No app behaviour changes.

Each source repo is archived with a pointer here once its app lands.

Two apps are out of scope. **mero-chat** was abandoned 2026-08-19 (stuck on
rc.20 / mero-js 7 / mero-react 4) — won't-fix. **mero-ar** and **mero-tag** are
Swift/Xcode projects with no frontend URL; they share neither the pnpm nor the
Cargo surface this repo is built around.

## Related

- [core](https://github.com/calimero-network/core) — the node, the Rust SDK, and `meroctl`
- [mero-js](https://github.com/calimero-network/mero-js) · [mero-react](https://github.com/calimero-network/mero-react) — JS/TS client SDKs
- [swift-sdk](https://github.com/calimero-network/swift-sdk) · [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) — native mobile SDKs
- [design-system](https://github.com/calimero-network/design-system) — shared UI primitives
- [cargo-mero](https://github.com/calimero-network/cargo-mero) — build and publish WASM app bundles
- [merobox](https://github.com/calimero-network/merobox) — spin up multi-node clusters for tests
- [app-registry](https://github.com/calimero-network/app-registry) — signed app distribution ([apps.calimero.network](https://apps.calimero.network/))
- [tauri-app](https://github.com/calimero-network/tauri-app) — Calimero Desktop, which runs these apps
- [documentation](https://github.com/calimero-network/documentation) — [docs.calimero.network](https://docs.calimero.network/)

## License

Each app carries the license of the repository it was migrated from. New shared code is MIT.
