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

> **Status: scaffolding.** The repo exists; the migration has not started. Each app below still lives
> in its own repository and remains the source of truth until it is moved here.

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

### Collaboration & productivity

| App | What it is |
| --- | --- |
| [mero-design](https://github.com/calimero-network/mero-design) | Figma-style infinite canvas — shapes, text, images, SVG blobs, real-time multi-member editing. |
| [mero-pixart](https://github.com/calimero-network/mero-pixart) | Photoshop/Photopea-style image editor — layers, masks, adjustments, curves, collaborative. |
| [p2p-sheets](https://github.com/calimero-network/p2p-sheets) | Collaborative spreadsheet — CRDT inputs, derive-on-read recalc engine, formulas, live cursors. |
| [mero-calendar](https://github.com/calimero-network/mero-calendar) | Shared team calendars in replicated state, plus genuinely private events in node-local storage. |
| [mero-drive](https://github.com/calimero-network/mero-drive) | Peer-to-peer file storage and documents. |
| [mero-issue-tracker](https://github.com/calimero-network/mero-issue-tracker) | Issue tracker for dev teams whose backlog lives on their own nodes. |

### Communication

| App | What it is |
| --- | --- |
| [mero-chat-pwa](https://github.com/calimero-network/mero-chat-pwa) | Group channels and DMs as an installable PWA, with offline support. |
| [mero-meet](https://github.com/calimero-network/mero-meet) | Video calling — a context is the room, the contract is the signaling relay, media flows direct over WebRTC. No SFU. |

### Games

| App | What it is |
| --- | --- |
| [mero-blocks](https://github.com/calimero-network/mero-blocks) | Minecraft-style multiplayer voxel sandbox. No game server — the world is a context. |
| [merraria](https://github.com/calimero-network/merraria) | Terraria-style 2D mining sandbox — seed-generated terrain, CRDT tile diff, in a ~45 kB bundle. |
| [battleships](https://github.com/calimero-network/battleships) | Turn-based Battleships, the smallest end-to-end example of contract-mediated game state. |

### Native / mobile

| App | What it is |
| --- | --- |
| [mero-tag](https://github.com/calimero-network/mero-tag) | AirTag/Find My-style iOS location sharing between your own nodes. SwiftUI + MapKit. |
| [mero-ar](https://github.com/calimero-network/mero-ar) | Collaborative spatial editing — several people scan one room and edit a shared 3D scene. ARKit + RealityKit. |

### Experiments

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

## Planned layout

```
apps/
├── apps/                  # one directory per application
│   ├── mero-design/
│   ├── mero-meet/
│   └── ...
├── packages/              # code shared across apps
│   ├── ui/                #   components above the design system
│   └── testing/           #   shared merobox fixtures + Playwright helpers
├── crates/                # Rust shared by the contracts
├── .github/workflows/     # per-app CI, path-filtered
└── pnpm-workspace.yaml
```

Frontends are a pnpm workspace; contracts are a Cargo workspace; CI path-filters so touching one app
does not rebuild the other fourteen.

## Migration approach

Apps move one at a time, with git history preserved (`git subtree` / `git filter-repo`), and only
when the app is already on the current core RC — the monorepo is not the place to do a version
upgrade. Order runs from the most actively developed to the least, so shared code gets extracted
early rather than retrofitted. Each source repo is archived with a pointer here once its app lands.

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
