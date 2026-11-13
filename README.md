# Mero Apps

**Twenty-seven real apps on [Calimero](https://github.com/calimero-network/core), built so the host
can't read them.**

Calimero is your app's whole backend, like Firebase. Except nobody can read your data, not even us.
An app gets auth (passkeys, sessions, scoped API keys), a database (replicated app state: maps, sets,
tables with indexes, rich text), functions, realtime (events, presence), storage (sealed blobs),
search, hosting (its frontend served from the node) and typed clients, all running inside attested
Intel TDX hardware; clients verify the node before they send anything.

This repository is the apps built on it: chat, documents, spreadsheets, a design canvas, a CRM, a
secret manager, document signing, private polls, games. Each is a Rust contract on `calimero-sdk`,
compiled to a `calimero:app` WebAssembly component that *is* its backend, plus a frontend on
[mero-js](https://github.com/calimero-network/mero-js)'s `CalimeroClient`. [Apps](#apps) is the
catalogue; [Anatomy of a Mero app](#anatomy-of-a-mero-app) shows how the two halves fit.

It consolidates apps that used to live in their own repos, so they share one toolchain,
one dependency graph, one CI pipeline, and one release process instead of drifting apart in sixteen
places.

> **Status: migration complete.** All **16** migrated apps are here and this repo is the source of
> truth; apps written since — [mero-chess](apps/mero-chess), [mero-kombat](apps/mero-kombat), [mero-models](apps/mero-models) among them — were born in it.
> Fifteen of the sixteen source repositories are archived with a pointer back — several under their
> older names (`p2p-sheets`, `only-peers-client`, `meropass`, `MeroSign`,
> `scaffolding-e2e-application`); only [`kv-store`](https://github.com/calimero-network/kv-store)
> is still open. Three projects stayed out by design — see [Out of scope](#out-of-scope).

---

## Why a monorepo

The apps are independent products, but they are not independent codebases. They share:

- **The same SDKs** — [`calimero-sdk`](https://github.com/calimero-network/core) (Rust, the
  component SDK) and [`mero-js`](https://github.com/calimero-network/mero-js)'s `CalimeroClient`.
- **The same design language** — [`design-system`](https://github.com/calimero-network/design-system).
- **The same build tooling** — core's `meroctl`: `meroctl app pack` builds each contract for
  `wasm32-wasip2` and packs it from its `[package.metadata.calimero]`, `meroctl app codegen` writes
  the typed client, `meroctl local dev` runs it on a local cluster; Vite + TypeScript for
  frontends. (CI still packs with [`tools/component-bundle`](tools/component-bundle), which
  writes the same `.mpk` from the same table.)
- **The same release path** — signed `.mpk` packages published to the
  [app registry](https://apps.calimero.network/).
- **The same integration surface** — passkey sign-in, organizations and invitations, a local
  cluster (`merod local`) in development and Calimero Cloud in production.

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

Twenty-seven apps, each `apps/<name>/{logic,app}`, every one a component app (Calimero 1.0). **Package** is the registry id; the linked name is the
live deployment. Versions are owned by the registry, not by `Cargo.toml` — the release workflow
increments them on publish.

### Reference

Start here. These exist to be read, not shipped.

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [kv-store](apps/kv-store) | [↗](https://mero-kv-store.vercel.app) | The first component app (Calimero 1.0): a string key-value store on `calimero-sdk`, developed on `merod local`, its frontend on mero-js `CalimeroClient` (Cloud in production). | `com.calimero.kv-store` |
| [conformance](apps/conformance) | — | Not a product: the conformance matrix. Every call a component app's client (mero-js `CalimeroClient`) makes, run as two accounts on `merod local` with one report row per check, and the contract it calls; the 0.x rig it replaces is kept beside it in `v0/`. | `com.calimero.conformance` |
| [scaffolding-e2e](apps/scaffolding-e2e) | [↗](https://scaffolding-e2e-application.vercel.app/) | The SDK test bench, on the component SDK: KV, collections, per-user, frozen and shared storage, roles and a workspace directory, every method reachable from the UI behind an interactive test suite, and scenarios run on `merod local`. | `com.calimero.scaffolding-e2e` |

### Collaboration & productivity

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-home](apps/mero-home) | — | Calimero Home: one organization's apps, who is in each, invitations to one app or several, and removing someone from every app at once. Frontend over core's org and app-team routes; served by every cluster. | `com.calimero.mero-home` |
| [mero-design](apps/mero-design) | [↗](https://design.hyperfeed.me/) | A component app (Calimero 1.0): a Figma-style infinite canvas — shapes, text, images, board roles, live multi-member editing — in an app instance its team's members share, on `calimero-sdk`, its frontend on mero-js `CalimeroClient`. | `com.calimero.mero-design` |
| [mero-pixart](apps/mero-pixart) | [↗](https://mero-pixart.vercel.app/) | A component app (Calimero 1.0): a Photoshop-style image editor with layers, folders, masks, adjustments and free transform, edited together; pixels are blobs of the document. | `com.calimero.mero-pixart` |
| [mero-models](apps/mero-models) | — | Blender-style 3D modeller — primitives, meshes, edit mode with extrude, materials and lights, a transform gizmo, undo, OBJ/STL/glTF in and out; co-edited live with presence, editors enforced by the contract. A component app (Calimero 1.0) on `calimero-sdk`: meshes and textures are the scene's own blobs (core #4815, at most 47.25 MiB each); frontend on mero-js `CalimeroClient`. | `com.calimero.mero-models` |
| [mero-sheets](apps/mero-sheets) | [↗](https://mero-sheets.vercel.app) | A component app (Calimero 1.0): a collaborative spreadsheet — derive-on-read recalc, formula autocomplete, live cursors, roles and protected ranges — in an app instance its organization's members share, on `calimero-sdk`, its frontend on mero-js `CalimeroClient`. | `com.calimero.mero-sheets` |
| [mero-calendar](apps/mero-calendar) | [↗](https://mero-calendar.vercel.app) | A component app (Calimero 1.0): shared team calendars whose events only their owner and invitees read, private events only their owner reads, and booking links for people with no account. | `com.calimero.mero-calendar` |
| [mero-docs](apps/mero-docs) | [↗](https://mero-docs.vercel.app) | A component app (Calimero 1.0): a document workspace of folders (teams of an organization) and collaboratively edited rich-text documents (Fugue text), on `calimero-sdk`, its frontend on mero-js `CalimeroClient`. | `com.calimero.mero-drive-docs` |
| [mero-crm](apps/mero-crm) | — | Sales CRM — drag-and-drop pipeline, deals, people, activities, stage automations, insights, and a local deal assistant (health score, next best step, email draft). A component app (Calimero 1.0): `calimero-sdk` tables, `merod local` in dev, mero-js `CalimeroClient` on Calimero Cloud. | `com.calimero.mero-crm` |
| [mero-issue-tracker](apps/mero-issue-tracker) | [↗](https://mero-issue-tracker-app.vercel.app) | Issue board for a small engineering team, with a fix prompt for coding agents. A component app (Calimero 1.0): `calimero-sdk` tables, `merod local` in dev, mero-js `CalimeroClient` on Calimero Cloud. | `com.calimero.mero-issue-tracker` |
| [mero-forum](apps/mero-forum) | [↗](https://mero-forum.vercel.app) | A component app (Calimero 1.0): threads, comments, votes and moderators in an app instance its organization's members share, on `calimero-sdk`, its frontend on mero-js `CalimeroClient`. | `com.calimero.mero-forum` |
| [mero-updates](apps/mero-updates) | — | Investor updates, two-way: categories, KPI deltas, asks answered in one click, investor Q&A and read receipts. A component app (Calimero 1.0): `calimero-sdk` tables, `merod local` in dev, mero-js `CalimeroClient` on Calimero Cloud. | `com.calimero.mero-updates` |
| [mero-chat](apps/mero-chat) | [↗](https://chat.hyperfeed.me) | A component app (Calimero 1.0): team chat with workspaces, public and private channels, threads, reactions and DMs, each channel an app instance its members reach, on `calimero-sdk`, its frontend on mero-js `CalimeroClient`. | `com.calimero.chat` |
| [mero-standup](apps/mero-standup) | — | Async standups and a decision log for a small team: each member's own update per day (started from yesterday's), help on blockers, a weekly digest, and tagged write-once decisions superseded rather than edited. A component app (Calimero 1.0) on `calimero-sdk`: v1's storage-tier write rules as method checks, tables with indexes and counts; frontend on mero-js `CalimeroClient`. | `com.calimero.mero-standup` |
| [mero-forms](apps/mero-forms) | — | A component app (Calimero 1.0): forms with typed questions the contract checks, responses with a summary and CSV, filled in by hand, through a public link or by a website's API key that can answer one form; any response goes on to [Mero CRM](apps/mero-crm) as a contact and a deal. | `com.calimero.mero-forms` |

### Secrets, documents & governance

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-pass](apps/mero-pass) | [↗](https://mero-pass.vercel.app) | Secret manager on Calimero 1.0 (component SDK) — a vault is an app instance in your team's org. Secrets are sealed in the browser, versioned and attributed, with no master password to phish. | `com.calimero.mero-pass` |
| [mero-sign](apps/mero-sign) | [↗](https://mero-sign.vercel.app) | A component app (Calimero 1.0): upload a PDF, collect signatures from the members of your organization and keep every signed version, on `calimero-sdk` with the PDFs as app blobs, its frontend on mero-js `CalimeroClient`. | `com.calimero.mero-sign` |
| [mero-vote](apps/mero-vote) | — | Private polls with verifiable tallies — ballots encrypted in the browser (ElGamal on ristretto255) with zero-knowledge well-formedness proofs, t-of-n threshold-decrypted totals (distributed key generation, no trusted dealer), and a tally every member re-verifies in their own browser. A component app (Calimero 1.0) on `calimero-sdk`: v1's storage-tier write rules as method checks; frontend on mero-js `CalimeroClient`. | `com.calimero.mero-vote` |

### Games

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-blocks](apps/mero-blocks) | [↗](https://mero-blocks.vercel.app/) | Minecraft-style multiplayer voxel sandbox, a component app (Calimero 1.0). No game server — a world is an app instance: seed + block-edit diff + player presence. Its native iOS/Android apps move to 1.0 in #700. | `com.calimero.mero-blocks` |
| [merraria](apps/merraria) | [↗](https://merraria.vercel.app/) | Terraria-style 2D mining sandbox — seed-generated terrain, tile-edit diff, player presence. A component app (`calimero-sdk`, `merod local`, `CalimeroClient`); its native iOS and Android apps run on 1.0 too (#702). | `com.calimero.merraria` |
| [battleships](apps/battleships) | [↗](https://battleships-fawn.vercel.app) | Two-player Battleships with commit-reveal ship placement: boards stay on the device, every answer is audited at the reveal. A component app (Calimero 1.0) on `calimero-sdk`: the lobby and every match in one app instance, the result recorded by the call that decides it; frontend on mero-js `CalimeroClient`. | `com.calimero.battleships` |
| [mero-chess](apps/mero-chess) | [↗](https://mero-chess.vercel.app) | Two-player chess, a component app (Calimero 1.0). A table is an app instance: every move is a transaction ordered by its log, and the rules — legal moves, check, mate, the draws — run inside the contract. | `com.calimero.mero-chess` |
| [mero-kombat](apps/mero-kombat) | [↗](https://mero-kombat.vercel.app) | One-on-one arcade fighter, a component app (Calimero 1.0). An arena is an app instance: movement streams over ephemeral presence, every punch and kick is a contract transaction, and the contract keeps health, rounds and the winner. | `com.calimero.mero-kombat` |

### Experiments

| App | Live | What it is | Package |
| --- | --- | --- | --- |
| [mero-stream](apps/mero-stream) | [↗](https://mero-stream-neon.vercel.app) | Media capacity probe, on the component runtime. `/stream` runs a toy integer codec inside the contract; `/live` carries browser-encoded H.264 over the node's presence channel. Deliberately the wrong way round, to find the platform's ceiling with numbers. **Not shippable media, and web only.** | `com.calimero.mero-stream` |
| [hyperfeed](apps/hyperfeed) | — | Prototype. One feed for your agent and your apps: every action an agent took on your behalf (with its warrant's intent hash and executor) beside every notification your other apps emitted, with approvals, undo, per-app agent modes and "always ask" guards enforced by the contract. `/demo` runs with no node. A component app (Calimero 1.0): `calimero-sdk`, `merod local` in dev, mero-js `CalimeroClient` on Calimero Cloud. | `com.calimero.hyperfeed` |

### Out of scope

Three projects stayed in their own repositories, and one was abandoned.

| Project | Why |
| --- | --- |
| [mero-tag](https://github.com/calimero-network/mero-tag) | SwiftUI + MapKit iOS app. Shares neither the pnpm nor the Cargo surface this repo is built around. |
| [mero-ar](https://github.com/calimero-network/mero-ar) | ARKit + RealityKit iOS app, same reason. |
| [mero-chat-pwa](https://github.com/calimero-network/mero-chat-pwa) | Installable PWA with offline support; still developed on its own. |
| [mero-chat](https://github.com/calimero-network/mero-chat) | **Abandoned** 2026-08-19, stuck on rc.20 / mero-js 7 / mero-react 4. Superseded by `mero-chat-pwa`. Won't-fix; exclude it from fleet sweeps. |

## Component apps (Calimero 1.0)

Every app here is on core's **component SDK** (`calimero-sdk`, a
`calimero:app` component built for `wasm32-wasip2` and run on the node's
wasmtime runtime, pinned at `component-core-tag` in the root `Cargo.toml`),
develops on **`merod local`** (`packages/merod-local`, which replaced
merobox), and talks to its nodes through mero-js's **`CalimeroClient`** in the
frontend: a Calimero Cloud cluster in production, the local nodes in
development.

```bash
meroctl app new my-app             # start a new app: a copy of apps/kv-store (the default template)
meroctl local dev apps/kv-store    # cluster + build + upload + the app's dev server on :5173, rebuilt on save
pnpm dev:local kv-store            # the monorepo's own equivalent (packages/merod-local)
pnpm merod-local e2e kv-store      # the app's scenarios as real accounts on the cluster
```

`meroctl` is core's command line (1.0.0-rc.24 or later):
`curl -fsSL https://raw.githubusercontent.com/calimero-network/core/master/scripts/install.sh | sh`
puts it in `~/.local/bin` (`sh -s -- merod meroctl` adds `merod`, Linux only).

[**`docs/COMPONENT-APPS.md`**](docs/COMPONENT-APPS.md) has the layout, the
build and bundle tool (`tools/component-bundle`), local development
(`packages/merod-local`), the frontend helper (`packages/connect`), CI
(`.github/workflows/components.yml`), the v1 → component SDK migration guide
and the porting checklist that moved each app off the v1 SDK.

## Anatomy of a Mero app

Every app here has the same two halves, and the boundary between them is the ABI:

```
apps/my-app/
├── logic/                # Rust → a calimero:app component (wasm32-wasip2). The whole backend.
│   ├── src/lib.rs        #   #[app::state] state, #[app::logic] methods, #[app::event] events
│   ├── Cargo.toml        #   calimero-sdk @ component-core-tag; [package.metadata.calimero],
│   │                     #   the registry manifest; its own [workspace] and Cargo.lock
│   ├── tests/            #   TestApp: the component on core's wasmtime engine. No node needed.
│   ├── scenarios/        #   steps run by cargo test AND as real accounts on merod local
│   └── res/abi.json      #   the component's ABI, emitted by mero-component build, committed
└── app/                  # Frontend. Vite + React (or vanilla) + TypeScript.
    ├── src/              #   mero-js CalimeroClient, through @calimero-apps/connect
    │   └── generated/    #   typed client, meroctl app codegen from ../logic/res/abi.json
    ├── e2e/              #   Playwright, against merod local (where the app has a suite)
    ├── public/           #   icon-512.png and friends — the registry icon
    └── vercel.json       #   outputDirectory + the SPA rewrite
```

The frontend never talks to a server of its own. It verifies a node's attestation, opens a sealed
channel to it and signs the person in with a passkey; any node of the cluster takes the call and
forwards it to the leader of that app instance's Raft group, which runs the contract and appends the
call with its state diff to the instance's log; the other replicas apply the diff, and events reach
everyone the app instance reaches. The "multiplayer" is a property of the platform, not of the
application code.

**Every write runs the contract.** One leader applies every call in one log, so an `if` inside a
`#[app::logic]` method holds for everyone: a rule is a method check against `env::caller()`, and who
reaches an app instance at all is its organization's business (members, admins, guests, the owner).
That was not true of the v1 SDK, where a receiving peer folded a delta into storage without running
the contract;
[**`apps/mero-chess/docs/trust-model.md`**](apps/mero-chess/docs/trust-model.md) is that design and
the fourteen real defects it fixed, kept for the record, and
[Mero Chess's Trust section](apps/mero-chess/README.md#trust) shows what each became as a method
check under one log.

## Layout

```
apps/                       one directory per application
                            (see Anatomy above for what each contains)

scripts/
  app-packages.sh           v1 app packages from cargo metadata (release.yml; none remain)
  ci-scope.py               which apps / jobs a change reaches (both CI workflows)
  check-app-metadata.sh     registry manifest vs the workspace pins
  check-app-icons.py        real icons, not the "default" placeholder
  check-live-frontends.py   the deployed <title> matches the committed one
  check-lockfile.py         pnpm-lock.yaml has no duplicated keys
  check-vercel-output.sh    vercel.json names the directory the build wrote
  check-registry-sync.py    published wasm vs what this tree builds (manual)
  lockfile-fanout.py        which apps a lockfile change can actually affect
  vercel-ignore-build.py    Vercel skips an app's deploy when a push does not reach it
  component-apps.sh         the component-app matrix (logic/ depends on calimero-sdk)
  check-component-pins.py   every component crate pins component-core-tag
  tests/                    unit tests for the gates above

tools/
  component-bundle/         writes res/abi.json; CI packs releases with it (locally: meroctl app pack)

packages/
  connect/                  frontend: merod local in dev, Calimero Cloud in production
  merod-local/              pnpm dev:local / merod-local: local cluster, deploy, e2e
  passkey/ · members/ · …   shared sign-in, membership and UI pieces the apps import

docs/
  COMPONENT-APPS.md         component apps: build, merod local, Cloud, CI, migration guide
  SESSION-AND-INVITES.md    sign-in and invitations, and how each is tested
  VERCEL.md                 one deploy convention for every app

.github/workflows/          ci.yml · components.yml · conformance.yml · release.yml ·
                            publish-component.yml (reusable) · per-app mobile workflows

Cargo.toml                  ONE core pin (component-core-tag) and the other fleet-wide
                            values, in [workspace.metadata.mero-apps]
pnpm-workspace.yaml         ONE version per JS dependency, via catalog:
tsconfig.base.json
```

Each contract is a standalone crate with its own `[workspace]` and `Cargo.lock`
(excluded from the root workspace, which has no members left; the pin is checked
rather than inherited, by `scripts/check-component-pins.py`); frontends are a
pnpm workspace. CI path-filters so touching one app does not rebuild the others
— and a change to the core pin fans out to all of them, because bumping the SDK
changes every contract's bytes.

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
The `merobox` and `calimero-client-py` rows have since gone with the merobox
e2e job itself: merobox is retired, and component apps run their scenarios on
`merod local`.

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
rustup target add wasm32-wasip2       # once
scripts/install-meroctl.sh            # once: core's meroctl at the pinned release, for codegen

M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/<app>/logic/Cargo.toml                 # TestApp harness + scenarios
cargo run --release --manifest-path $M -- build apps/<app>/logic        # component + res/abi.json
pnpm -F <app> codegen                 # ABI → typed client (meroctl app codegen)
meroctl local dev apps/<app>          # local cluster + build + upload + the dev server on :5173
pnpm dev:local <app>                  # the same through packages/merod-local
meroctl app pack apps/<app>/logic     # a dev-signed .mpk in logic/dist/ (--key for a release)

pnpm -r typecheck                     # `tsc -b`, never --noEmit (see below)
pnpm -r test
```

The gates CI runs, all runnable locally — the first four are in `ci.yml`'s
always-on `metadata` job and the component pins in `components.yml`'s `checks`,
so they fire on every pull request:

```bash
bash   scripts/check-app-metadata.sh      # manifest vs the workspace pins
python3 scripts/check-app-icons.py        # a real icon, square, opaque, >=512²
python3 scripts/check-live-frontends.py   # deployed <title> vs the committed one
python3 scripts/check-lockfile.py         # no duplicated keys in pnpm-lock.yaml
python3 scripts/check-component-pins.py   # every component crate pins component-core-tag
bash   scripts/check-vercel-output.sh --build   # vercel.json vs the real output
python3 scripts/check-registry-sync.py    # published wasm vs this tree (manual)
```

⚠️ **Use `tsc -b`, never `tsc --noEmit`.** Each app's `tsconfig.json` is a
*solution file* — it only references sub-projects — and `--noEmit` on one checks
nothing and exits 0. An app can carry hundreds of type errors behind a green
`--noEmit`.

`docs/SESSION-AND-INVITES.md` describes the two flows every app shares, passkey
sign-in and invitations (`@calimero-apps/connect`, `@calimero-apps/passkey`),
and which tests cover each step: the shared packages', each app's vitest and
the browser suites on `merod local`.

### The CI signal

Two workflows, each with a `changes` job that decides what the rest run, and
an aggregate `… OK` job that is the one check to require (a job skipped because
the change does not reach it counts as a pass):

| Workflow | Job | Runs on a pull request when | Does |
| --- | --- | --- | --- |
| `ci.yml` | `metadata` | always | the manifest / icon / node-wire / org-module / live-frontend / lockfile gates, plus their own unit tests |
| `ci.yml` | `frontend` | a member's frontend, contract or a package it imports changed, or a workspace-wide JS change | lint, typecheck, codegen diff, unit tests, build, `check-vercel-output.sh`, over those members only |
| `ci.yml` | `conformance` | the rig, a package or a JS pin changed | `conformance.yml` |
| `components.yml` | `checks` | always | pins, `tools/component-bundle`, `packages/connect` + `passkey` + `merod-local` |
| `components.yml` | `rust` | per app whose **contract** changed | fmt, clippy, `cargo test` (scenarios), release build, ABI current, dev `.mpk` |
| `components.yml` | `e2e` | per app whose contract changed, or every app when `packages/merod-local` / a mero-js pin changed | scenarios on `merod local` |
| `components.yml` | `browser` | per app with a Playwright suite whose frontend, contract or harness inputs changed | the suite on `merod local` |
| `components.yml` | `cross-app` | Chat, Home or KV Store (or what they import) changed | `e2e/cross-app` |

A push to `main` and a dispatch run everything. `scripts/ci-scope.py` makes the
per-app call for both workflows; see what a diff would run with

```bash
git diff --name-only origin/main... | python3 scripts/ci-scope.py      # ci.yml frontend dirs
python3 scripts/ci-scope.py components --explain --base origin/main     # components.yml, per job
```

A change under an app's `mobile/`, its README or `docs/` runs nothing per-app
(the mobile workflows are path-filtered per app on their own).

⚠️ **A job whose `needs:` was skipped is skipped too — `if:` cannot rescue it**
unless it carries a status function. `components.yml`'s `e2e` downloads `rust`'s
wasm, and runs on changes `rust` does not (then it builds the wasm itself);
`scripts/tests/producer-gate-test.py` asserts that link.

⚠️ **`Cargo.lock` and `pnpm-lock.yaml` are flat filters** — a one-app change
touching either fans CI out to every one of them. `scripts/lockfile-fanout.py` answers
the narrower question of which apps a given lockfile diff can actually affect.

### Bumping core

The fleet currently sits on **`1.0.0-rc.23`** (`component-core-tag`; bundles still
declare `1.0.0-rc.20` as their `component-min-runtime-version`, see below). Every core crate must carry the
*exact* same tag — a version string cannot express it, because core's workspace
version at a tag is `0.0.0`. The steps (`docs/COMPONENT-APPS.md`, "Moving to a
new core release"):

1. `component-core-tag` and `component-min-runtime-version` in
   `[workspace.metadata.mero-apps]` of the root `Cargo.toml` (and the
   `[workspace.dependencies]` tags and `min-runtime-version` / `merod-image`
   beside them, which move together).
2. The tag in `tools/component-bundle/Cargo.toml` and in each app's
   `logic/Cargo.toml` (`python3 scripts/check-component-pins.py` lists every
   one left), then `cargo update` in each crate.
3. `"@calimero-network/mero-js"` in the `component` catalog of
   `pnpm-workspace.yaml`, to the release that speaks that node's API.
4. Rebuild each app's `res/abi.json` and regenerate its client
   (`pnpm -r codegen`); CI's e2e job downloads the new `merod`.

CI rebuilds every app and the release workflow republishes all of them, because
the SDK pin changes every contract's bytes.

⚠️ **Keep `min-runtime-version` equal to the tag**, unless the new release added
no host function (rc.21 to rc.23 did not, which is why it stays at rc.20). A newer SDK can import host
functions an older `merod` has no implementation for; such a package installs
happily and then fails when an app instance is created with `unknown import`.
That is what `min-runtime-version` guards, so keep each app's equal to
`component-min-runtime-version` rather than inheriting a floor from an older
template.

`[package.metadata.calimero]` **cannot be inherited by cargo** — `.workspace = true`
inside `[package.metadata]` resolves to the literal `{"workspace": true}`, since
`metadata` is not on cargo's inheritable list — and a standalone crate cannot
inherit `[workspace.dependencies]` either. So the fleet-wide values live once in
`[workspace.metadata.mero-apps]` (a table no tool but ours reads; v1's
cargo-mero claimed `[workspace.metadata.calimero]` with `deny_unknown_fields`)
and checks, not inheritance, hold every app to them.

### Adding an app

A directory. `apps/<name>/{logic,app}` in the shape of
[`apps/kv-store`](apps/kv-store) (`docs/COMPONENT-APPS.md`, "Layout of a
component app"): `logic/Cargo.toml` a standalone `cdylib` crate with an empty
`[workspace]`, `calimero-sdk` at `component-core-tag` and a
`[package.metadata.calimero]` block; `apps/<name>/logic` added to
`[workspace].exclude` in the root `Cargo.toml`; `app/package.json` with
`catalog:` versions (`"@calimero-network/mero-js": "catalog:component"`), and an
`app/vercel.json` matching the convention in `docs/VERCEL.md`. The CI matrices
come from `scripts/component-apps.sh` (every `apps/*/logic` that depends on
`calimero-sdk`), so there is no list to update.

To pass the always-on gates it also needs a real icon at `app/public/icon-512.png`
(square, opaque, ≥512²; **not** the `icon = "default"` placeholder) and a
`<title>` matching what it deploys.

⚠️ **The `package` id is forever.** The release workflow finds an app by its
directory (`apps/$APP/logic`) and publishes under the `package` its
`[package.metadata.calimero]` names; the registry pins that id's signer and the
node derives the application id from (package, signer), so a changed `package`
is a different app, not a new version of this one.

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
Those moves were of v1 apps (cargo-mero, merobox); each was then ported to the
component SDK in a PR of its own, by the checklist in `docs/COMPONENT-APPS.md`.

⚠️ **`git subtree` loses path history.** A subtree merge rewrites paths without
recording the rename, so `git log --follow` on a migrated file stops at the
merge. Use `git filter-repo` when the history matters.

⚠️ **Two failure modes hid behind green CI during the moves**, both worth
checking on any future one: merobox scenarios landing at a path CI never globs
(the job passed in seconds having run *nothing* — an `E2E (<app>)` leg green in
~20s ran zero scenarios; that job is gone now, with merobox), and an inherited `.gitignore` swallowing the committed
`res/abi.json`, so codegen silently had nothing to check against.

## Related

- [core](https://github.com/calimero-network/core) — the node (`merod`), the Rust SDK and `meroctl` (app build, pack, codegen, the local cluster); its docs are at [calimero-network.github.io/core](https://calimero-network.github.io/core/)
- [mero-js](https://github.com/calimero-network/mero-js) — the JS/TS client (`CalimeroClient`); [mero-react](https://github.com/calimero-network/mero-react) only in the conformance app's 0.x rig
- [swift-sdk](https://github.com/calimero-network/swift-sdk) · [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) — native mobile SDKs
- [design-system](https://github.com/calimero-network/design-system) — shared UI primitives
- [app-registry](https://github.com/calimero-network/app-registry) — signed app distribution ([apps.calimero.network](https://apps.calimero.network/))

## License

Each app carries the license of the repository it was migrated from. New shared code is MIT.
