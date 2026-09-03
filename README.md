# Mero Apps

**Monorepo for every application built on the [Calimero network](https://github.com/calimero-network/core).**

Calimero apps have no backend server. A Rust/WASM contract *is* the backend, it runs inside each
participant's own node, and state replicates peer-to-peer as CRDTs. There is no central database, no
API tier, and no operator who can read your data. Every app in here is a demonstration of what that
architecture makes possible — design tools, spreadsheets, video calls, a secret manager, document
signing, games — built the same way, on the same stack.

This repository consolidates apps that used to live in their own repos, so they share one toolchain,
one dependency graph, one CI pipeline, and one release process instead of drifting apart in sixteen
places.

> **Status: migration complete.** All **16** apps are here and this repo is the source of truth.
> Fifteen of the sixteen source repositories are archived with a pointer back — several under their
> older names (`p2p-sheets`, `only-peers-client`, `meropass`, `MeroSign`,
> `scaffolding-e2e-application`); only [`kv-store`](https://github.com/calimero-network/kv-store)
> is still open. Three projects stayed out by design — see [Out of scope](#out-of-scope).

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

Every core release used to fan out into a dozen near-identical dependency bumps, and every SDK
breaking change had to be discovered sixteen separate times. The monorepo turns that fan-out into a
single atomic change with a single CI signal.

## What it gives us

| | Before (many repos) | Now (one repo) |
| --- | --- | --- |
| SDK bump | N pull requests, N CI runs, N review cycles | one PR, one CI run |
| Breaking SDK change | found app-by-app, over days | found at author time, in one build |
| Shared UI code | copy-pasted or published as a package | imported directly |
| Version skew | routine (apps sit on different core RCs) | impossible by construction |
| Adding an app | new repo, new CI, new secrets, new release workflow | a directory |

## Apps

Sixteen apps, each `apps/<name>/{logic,app}`. **Package** is the registry id; the linked name is the
live deployment. Versions are owned by the registry, not by `Cargo.toml` — the release workflow
increments them on publish.

### Reference

Start here. These two exist to be read, not shipped.

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [kv-store](apps/kv-store) | [↗](https://mero-kv-store.vercel.app) | An `UnorderedMap<String, LwwRegister<String>>` exercised end to end, with a typed client generated from the contract's own ABI. | `com.calimero.kv-store` |
| [scaffolding-e2e](apps/scaffolding-e2e) | [↗](https://scaffolding-e2e-application.vercel.app/) | Full-stack scaffold — KV, CRDTs, blobs, private storage and namespace management behind an interactive test suite that exercises every SDK surface. | `com.calimero.scaffolding-e2e` |

### Collaboration & productivity

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-design](apps/mero-design) | [↗](https://mero-design.vercel.app/) | Figma-style infinite canvas — shapes, text, images, SVG blobs, real-time multi-member editing. | `com.calimero.mero-design` |
| [mero-pixart](apps/mero-pixart) | [↗](https://mero-pixart.vercel.app/) | Photoshop-style image editor — layers, folders, masks, adjustments, free transform, collaborative. | `com.calimero.mero-pixart` |
| [mero-sheets](apps/mero-sheets) | [↗](https://mero-sheets.vercel.app) | Collaborative spreadsheet — CRDT inputs, derive-on-read recalc, formula autocomplete, live cursors, CSV download. | `com.calimero.mero-sheets` |
| [mero-calendar](apps/mero-calendar) | [↗](https://mero-calendar.vercel.app) | Shared team calendars in replicated state, plus genuinely private events in node-local storage. | `com.calimero.mero-calendar` |
| [mero-drive](apps/mero-drive) | [↗](https://mero-drive.vercel.app) | Namespace-scoped document workspace — a multi-service bundle pairing a registry with the docs themselves. | `com.calimero.mero-drive-docs` |
| [mero-issue-tracker](apps/mero-issue-tracker) | [↗](https://mero-issue-tracker-app.vercel.app) | Issue board for a small engineering team whose backlog lives on their own nodes. | `com.calimero.mero-issue-tracker` |
| [mero-forum](apps/mero-forum) | [↗](https://mero-forum.vercel.app) | Threads and comments replicated across your own nodes, with no server in the middle. | `com.calimero.mero-forum` |

### Secrets & documents

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-pass](apps/mero-pass) | [↗](https://mero-pass.vercel.app) | Secret manager — a vault is a context. Credentials stay on member nodes, versioned and attributed, with no master password to phish. | `com.calimero.mero-pass` |
| [mero-sign](apps/mero-sign) | [↗](https://mero-sign.vercel.app) | Document signing — upload a PDF, collect signatures from namespace members, verify them peer-to-peer. | `com.calimero.mero-sign` |

### Communication

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-meet](apps/mero-meet) | [↗](https://mero-meet.vercel.app) | Video calling — a context is the room and the contract carries signaling. Media flows direct over WebRTC; no SFU, no signaling server. | `com.calimero.mero-meet` |

### Games

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-blocks](apps/mero-blocks) | [↗](https://mero-blocks.vercel.app/) | Minecraft-style multiplayer voxel sandbox. No game server — the world is a context: seed + block-edit diff + player presence. | `com.calimero.mero-blocks` |
| [merraria](apps/merraria) | [↗](https://merraria.vercel.app/) | Terraria-style 2D mining sandbox — seed-generated terrain, CRDT tile diff, player presence. | `com.calimero.merraria` |
| [battleships](apps/battleships) | [↗](https://battleships-fawn.vercel.app) | Two-player Battleships — a lobby service for matchmaking and one game service per match, with commit-reveal ship placement. | `com.calimero.battleships` |

### Experiments

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-stream](apps/mero-stream) | [↗](https://mero-stream-neon.vercel.app) | Media capacity probe. `/stream` runs a toy integer codec inside the contract; `/live` stores opaque browser-encoded H.264. Deliberately the wrong way round, to find the node's ceiling with numbers. **Not shippable media, and web-only — it does not run in Calimero Desktop.** | `com.calimero.mero-stream` |

### Out of scope

Three projects stayed in their own repositories, and one was abandoned.

| Project | Why |
| --- | --- |
| [mero-tag](https://github.com/calimero-network/mero-tag) | SwiftUI + MapKit iOS app. Shares neither the pnpm nor the Cargo surface this repo is built around. |
| [mero-ar](https://github.com/calimero-network/mero-ar) | ARKit + RealityKit iOS app, same reason. |
| [mero-chat-pwa](https://github.com/calimero-network/mero-chat-pwa) | Installable PWA with offline support; still developed on its own. |
| [mero-chat](https://github.com/calimero-network/mero-chat) | **Abandoned** 2026-08-19, stuck on rc.20 / mero-js 7 / mero-react 4. Superseded by `mero-chat-pwa`. Won't-fix; exclude it from fleet sweeps. |

## Anatomy of a Mero app

Every app here has the same two halves, and the boundary between them is the ABI:

```
apps/my-app/
├── logic/                # Rust → WASM. The whole backend.
│   ├── src/lib.rs        #   #[app::state] state, #[app::logic] methods, #[app::event] events
│   ├── Cargo.toml        #   [package.metadata.calimero] — the registry manifest
│   ├── tests/            #   TestHost + convergence. No node needed.
│   ├── res/              #   abi.json + state-schema.json, emitted by cargo mero
│   └── workflows/        #   merobox scenarios: real multi-node integration
└── app/                  # Frontend. Vite + React + TypeScript.
    ├── src/              #   talks to the local node via mero-js / mero-react
    │   └── generated/    #   typed client, generated from ../logic/res/abi.json
    ├── e2e/              #   Playwright, against a real node
    ├── public/           #   icon-512.png and friends — the registry + Dock icon
    └── vercel.json       #   outputDirectory + the SPA rewrite
```

The frontend never talks to a server. It talks to *its own* node over JSON-RPC, the node executes the
contract locally, and the resulting state delta gossips to the other members of the context. The
"multiplayer" is a property of the network, not of the application code.

## Layout

```
apps/                       sixteen directories, one per application
                            (see Anatomy above for what each contains)

scripts/
  app-packages.sh           the CI matrices, derived from cargo metadata
  check-app-metadata.sh     registry manifest vs the workspace pins
  check-app-icons.py        real icons, not cargo-mero's "default" placeholder
  check-desktop-sso.py      every app anchors node trust for the desktop hand-off
  check-live-frontends.py   the deployed <title> matches the committed one
  check-lockfile.py         pnpm-lock.yaml has no duplicated keys
  check-vercel-output.sh    vercel.json names the directory the build wrote
  check-registry-sync.py    published wasm vs what this tree builds (manual)
  lockfile-fanout.py        which apps a lockfile change can actually affect
  tests/                    unit tests for the gates above

docs/
  SESSION-AND-INVITES.md    the login / desktop hand-off / invitation audit
  VERCEL.md                 one deploy convention for all sixteen apps

.github/workflows/          ci.yml · release.yml · publish-bundle.yml (reusable)

Cargo.toml                  ONE SDK pin, the release profiles, and
                            [workspace.metadata.mero-apps] for fleet-wide values
pnpm-workspace.yaml         ONE version per JS dependency, via catalog:
requirements-e2e.txt        merobox AND calimero-client-py, pinned together
tsconfig.base.json
```

Contracts are a Cargo workspace; frontends are a pnpm workspace; CI path-filters
so touching one app does not rebuild the others — and a change to the workspace
root fans out to all of them, because bumping the SDK changes every contract's
bytes.

## One pin, one place

The problem this repo was built to solve, as measured across the nine app repos
that existed on 2026-08-26 — all sixteen now share a single value for each row:

| pin | distinct values in the fleet |
| --- | --- |
| `calimero-sdk` tag | **5** — rc.15, rc.23, rc.24, rc.25, `branch = "master"` |
| `merod` image | 3 |
| `merobox` | 3, one repo unpinned |
| `calimero-client-py` | pinned in **1 of 9** |
| `typescript` / `vite` / `vitest` / `react` | 3 / 3 / 4 / 4 |

Thirteen pins × nine apps was up to 117 places to edit for one decision. Here it
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
pnpm -r typecheck                     # `tsc -b`, never --noEmit (see below)
pnpm -r test
```

The gates CI runs, all runnable locally — the first five are in the always-on
`metadata` job, so they fire on every pull request:

```bash
bash   scripts/check-app-metadata.sh      # manifest vs the workspace pins
python3 scripts/check-app-icons.py        # a real icon, square, opaque, >=512²
python3 scripts/check-desktop-sso.py      # node trust anchored for the hand-off
python3 scripts/check-live-frontends.py   # deployed <title> vs the committed one
python3 scripts/check-lockfile.py         # no duplicated keys in pnpm-lock.yaml
bash   scripts/check-vercel-output.sh --build   # vercel.json vs the real output
python3 scripts/check-registry-sync.py    # published wasm vs this tree (manual)
```

⚠️ **Use `tsc -b`, never `tsc --noEmit`.** Each app's `tsconfig.json` is a
*solution file* — it only references sub-projects — and `--noEmit` on one checks
nothing and exits 0. An app can carry hundreds of type errors behind a green
`--noEmit`.

`docs/SESSION-AND-INVITES.md` is the current audit of the three flows every app
is meant to share — login, the desktop hand-off, and invitations — with a
per-app table and a list of which invariants CI actually holds.

### The CI signal

`ci.yml` has seven jobs. `changes` runs first and decides which of the rest run,
and over which apps:

| Job | Runs when | Does |
| --- | --- | --- |
| `changes` | always | path-filters the diff into per-app matrices |
| `metadata` | always | the manifest / icon / SSO / frontend / lockfile gates, plus their own unit tests |
| `rust` | contract or workspace | `cargo test --workspace` |
| `wasm` | frontend **or** contract or workspace | `cargo mero build` per app; the ABI is regenerated and diffed |
| `frontend` | frontend or contract or workspace | typecheck, codegen diff, unit tests, build, `check-vercel-output.sh` |
| `browser` | frontend or contract or workspace | Playwright per app against a real node |
| `e2e` | contract or workspace | merobox multi-node scenarios per app |

`wasm` is deliberately the broadest of those — it is a *producer*, and it runs on
frontend-only changes precisely so that `browser` and `e2e`, which need it, are
not skipped out from under themselves:

⚠️ **A job whose `needs:` was skipped is skipped too — `if:` cannot rescue it.**
`browser` and `e2e` both `needs: wasm`, so a producer gate narrower than its
consumer's silently disables the consumer. That is how the browser suite went
from running on frontend-only PRs to running on none of them, green by absence.
`scripts/tests/producer-gate-test.py` asserts no producer is narrower than a
consumer.

⚠️ **`Cargo.lock` and `pnpm-lock.yaml` are flat filters** — a one-app change
touching either fans CI out to all sixteen. `scripts/lockfile-fanout.py` answers
the narrower question of which apps a given lockfile diff can actually affect.

### Bumping core

The fleet currently sits on **`0.11.0-rc.28`**. All SDK crates must carry the
*exact* same tag — a version string cannot express it, because core's workspace
version at a tag is `0.0.0`. In the root `Cargo.toml` edit these three, then
`min-runtime-version` and `merod-image` in `[workspace.metadata.mero-apps]`:

```toml
calimero-sdk            = { git = "…/core.git", tag = "0.11.0-rc.28" }
calimero-storage        = { git = "…/core.git", tag = "0.11.0-rc.28" }
calimero-storage-macros = { git = "…/core.git", tag = "0.11.0-rc.28" }
```

Run `cargo update`, push. CI rebuilds every app and the release workflow
republishes all of them, because the SDK pin changes every contract's bytes.

⚠️ **Prove a bump is safe by diffing the built WASM's import set.** A newer SDK
can import host functions an older `merod` has no implementation for; such a
bundle installs happily and then fails at context creation with `unknown
import`. That is what `min-runtime-version` guards, so keep it equal to the tag
rather than inheriting a floor from an older template.

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
`.workspace = true` deps and a `[package.metadata.calimero]` block,
`app/package.json` with `catalog:` versions, and an `app/vercel.json` matching
the convention in `docs/VERCEL.md`. Both CI matrices are derived from
`cargo metadata`, so there is no list to update.

To pass the always-on gates it also needs a real icon at `app/public/icon-512.png`
(square, opaque, ≥512²; **not** cargo-mero's `icon = "default"` placeholder), a
`<title>` matching what it deploys, and node trust anchored so the desktop
hand-off works.

⚠️ **Name the directory exactly like the crate.** `publish-bundle.yml` uses the
answer from `app-packages.sh` as *both* a path (`apps/$APP/logic`) and a cargo
package name (`select(.name == $app)`). All sixteen currently agree; the first
app where they differ fails with `no [package.metadata.calimero].package`, and
only on the changed-app path — never on a manual dispatch, which is the one you
would reach for to reproduce it.

⚠️ **Profiles must stay at the workspace root.** Cargo *ignores* `[profile.*]` in
a member and then refuses to build:

```
warning: profiles for the non root package will be ignored
error: profile `app-release` is not defined
```

`cargo mero build` selects `app-release`, so an app that brought its own profile
block simply fails. Delete it on the way in.

## How the apps got here

The migration is finished — this section is kept because the same shape applies
to anything moved in later, and because two of its lessons cost real time.

Apps moved one at a time, with git history preserved (`git subtree` /
`git filter-repo`), each at whatever SDK version it was already on and bumped
only afterwards. **Never both in one step** — when a build goes red it should
have one possible cause.

Each move was mechanical: bring the tree in, delete its workflow files and its
copy of the cargo-mero action, rewrite `logic/Cargo.toml` to `.workspace = true`
and move its profile block to the root, rewrite `app/package.json` to
`catalog:`. No app behaviour changed. Fifteen of the sixteen source repositories
are now archived with a pointer back here; `kv-store`'s is still open.

⚠️ **`git subtree` loses path history.** A subtree merge rewrites paths without
recording the rename, so `git log --follow` on a migrated file stops at the
merge. Use `git filter-repo` when the history matters.

⚠️ **Two failure modes hid behind green CI during the moves**, both worth
checking on any future one: merobox scenarios landing at a path CI never globs
(the job passes in seconds having run *nothing* — an `E2E (<app>)` leg green in
~20s ran zero scenarios), and an inherited `.gitignore` swallowing the committed
`res/abi.json`, so codegen silently had nothing to check against.

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
