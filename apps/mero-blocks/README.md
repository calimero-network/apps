# mero-blocks

**A browser-playable, Minecraft-style multiplayer voxel sandbox with no game
server — the world lives on [Calimero](https://calimero.network).**

A contract on core's **component SDK** (`calimero-sdk`, a `calimero:app`
WebAssembly component on the node's wasmtime runtime), developed on
**`merod local`**, with a frontend on mero-js's **`CalimeroClient`** that talks
to a **Calimero Cloud** cluster in production and to the local nodes in
development. The game itself runs entirely in the browser (TypeScript +
Three.js, custom voxel engine).

```
apps/mero-blocks/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           #[app::state], #[app::logic], #[app::event], #[app::error]
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           world-lifecycle, access, devices (+ .org.json): harness AND merod local
│   ├── res/abi.json         the component's ABI (committed, diffed in CI)
│   └── GUIDE.md             the agent guide the bundle carries
├── app/                     the game: vanilla TS + Three.js; @calimero-apps/connect + mero-js CalimeroClient
└── mobile/                  native iOS/Android shells + the game page they bundle (moving to 1.0 in #700)
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## What it showcases

1. **An app instance as a game world.** No dedicated server, no matchmaking
   infra. Creating a world = creating an app instance (in an organization of
   its own, so you can invite friends); joining = redeeming an org invite.
2. **The seed + diff trick.** The contract never stores terrain. Every client
   generates the identical 128×64×128 world from a seed; the contract carries
   only the *override diff* (place = block id, break = explicit `0` — keys are
   never removed, so "edited to air" never looks like "terrain"). A world with
   thousands of edits is a few KB of state, and joining costs two reads.
3. **Skew-proof presence.** Heartbeats are stamped on a *room clock* (max of
   the caller's clock and the newest row, ignoring rows more than 15 minutes
   ahead of it) — a machine with a fast or backwards clock can never knock live
   players offline. A player who vanishes without `leave` simply ages out of
   the 10 s TTL; nobody writes another player's row.
4. **Derived state costs nothing.** Lighting (flood-fill sunlight + torch
   light) is recomputed locally from block events; the day/night cycle is a
   pure function of the world's `createdAt`. Both are synchronized across
   players with zero network traffic.

## How it works

```
 browser A                         cluster (one leader, one log)                browser B
┌────────────┐  setBlocks (150ms)  ┌─────────────────────────────┐  event stream ┌────────────┐
│ voxel      │ ──────────────────▶ │ mero-blocks component        │ ────────────▶ │ re-read    │
│ engine     │                     │ overrides + players          │  BlocksChanged│ overrides  │
│ + Three.js │ ◀────────────────── └─────────────────────────────┘ ◀──────────── │ + remesh   │
└────────────┘  getPlayers / heartbeat (0.5s/2s)                                   └────────────┘
```

- **Contract** (`logic/`): `meta: Cell<WorldMeta>` (written by `init` only),
  `overrides: UnorderedMap<"x,y,z", u8>` (public on purpose — anyone in the
  world may build anywhere), and `players: UnorderedMap<(account, device),
  Player>`, keyed by the caller's own account, so an account writes only its
  own avatars, with `stamps: UnorderedMap<(updatedAt, account, device), bool>`
  beside it so the room clock is one reverse read, not a scan. Both growing
  collections are read a page at a time (`getOverrides`, `getPlayers` answer
  `{ items, next }`).
- **Engine** (`app/src/engine/`, pure TS — unit-testable without a GPU):
  deterministic terrain (value noise + trees + ores), culled chunk mesher with
  per-vertex baked light, Amanatides–Woo raycast, AABB physics, day/night.
- **Renderer** (`app/src/renderer.ts`, the only Three.js file).
- **Net** (`app/src/net/`): `session.ts` (target → client → passkey, the stored
  session), `worlds.ts` (worlds as app instances, org invites), `blocks.ts`
  (`MeroBlocksClient`, generated from `res/abi.json` into `src/generated/`,
  adapted to the engine: u64s, paging, the device label), `client.ts`
  (the world's event stream, resumed after a drop), `sync.ts` (150 ms edit
  batching with echo suppression, coalesced pulls, heartbeats, and a reconcile
  pass on every (re)connect).

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local mero-blocks       # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), **create a world** (name + seed), and play.
**Invite friends** (or **Copy world invite** in the in-game menu) copies a link
carrying an org invite (approved with your passkey); a second browser profile
with its own passkey opening it signs in, is asked "Join {inviter}'s game as
{account}?" and, on **Join**, lands in the same world (an account made from the
invitation joins in that one step). A lapsed session, a rate limit or a network
failure keeps the invite to try again; only the node's word that it is used up
or expired drops it.

**Controls:** click to lock the mouse · WASD + Space · LMB **or Q** break ·
RMB **or E** place · 1–9/wheel select · **M** live world map · **O** options
(mouse sensitivity, key reference) · torches and glowstone are real light
sources. Everything works from the keyboard, so a trackpad never needs a
right-click.

`make` wraps the same commands (`make dev-local`, `make logic-test`, `make e2e`, …).

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-blocks/logic/Cargo.toml` | v1's `TestHost` tests method for method, v1's storage write rules as method checks tried as another account, devices, access and wire checks, and every `scenarios/*.json`, on core's wasmtime engine (34 harness tests + 3 scenarios) | no |
| `pnpm -F mero-blocks test` | the engine (terrain, mesher, lighting, raycast, physics), sync batching/echo/reconcile, the generated client against the committed ABI (every method, sent as a call or a view with its parameter names, the session synced after each), the adapter's wire conversions, session, worlds and invites, the event stream, the launcher's screens (mocked client) — 177 tests | no |
| `pnpm merod-local e2e mero-blocks` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

The scenarios: `world-lifecycle.json` is the merobox workflow
(`logic/workflows/e2e.yml`) — both players join and see each other, Alice builds
a three-block tower, Bob reads it and breaks the top block (an explicit `b: 0`,
never a removal), Alice reads the break, the count stays 3, the meta is the
same for both. `access.json` adds what merobox never could: a guest builds,
anonymous callers and accounts outside the org are refused, naming another
account's avatar is refused (v1's "forged write" into another `UserStorage`
slot), typed errors, malformed arguments, v1's snake_case names unknown.
`devices.json` pins one account on two devices being two avatars.

## Contract API

| method | kind | args | answer | notes |
|---|---|---|---|---|
| `init` | init | `name?`, `seed?`, `now?` | — | all optional: defaults `"overworld"`, a random seed in [0, 2^32), the leader's clock |
| `worldMeta` | view | — | `{name, seed, createdAt}` | `seed`, `createdAt` decimal strings |
| `setBlocks` | call | `edits: [{x,y,z,b}]`, `now`, `device?` | applied count (number) | ≤512 per call, out-of-bounds skipped; emits `BlocksChanged {id}` |
| `getOverrides` | view | `cursor?`, `limit?` | `{items: [{k: "x,y,z", b}], next}` | one page (≤1,000, `limit` smaller) of the edits, breaks included, in key order; `next` is `null` after the last page |
| `overrideCount` | view | — | number | a stored count |
| `worldStats` | view | — | `{overrides, players}` | new; decimal strings |
| `join` | call | `name`, `now`, `device?` | `PlayerView` | emits `PlayerJoined {id}` |
| `heartbeat` | call | `t: {name,x,y,z,yaw,pitch,sel}`, `now`, `device?` | `null` | `PlayerJoined` only for a new or returning avatar |
| `leave` | call | `now`, `device?` | `null` | emits `PlayerLeft {id}`; no-op for an avatar that never joined |
| `getPlayers` | view | `now`, `cursor?`, `limit?` | `{items: [PlayerView], next}` | one page (≤1,000) of `{id, account, device, name, x, y, z, yaw, pitch, sel, online}`, in (account, device) order |
| `myAccount` | view | — | string | new: the caller's account, the frontend's "me" |

Errors (`422 APP_ERROR`, `{ code, fields }`): `TooManyEdits { max, got }`,
`BadDevice { device }`, `TooManyDevices { max }` (8 avatars per account),
`Uninitialized`.

## What changed in the port, and why

Same methods, same arguments (plus an optional `device`), same answers and
event names. What a client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `world_meta`, `set_blocks`, `get_overrides`, `override_count`, `get_players` | `worldMeta`, `setBlocks`, `getOverrides`, `overrideCount`, `getPlayers` (`join`, `heartbeat`, `leave` unchanged) | the ABI names methods and arguments in camelCase |
| transport | JSON-RPC `execute` on your node (or the account relay), a context id | `POST /apps/{app}/intents` (calls) and `/views` (reads) on any node of the cluster, an app id | one app per replicated log; any node serves any request |
| `now`, `seed` arguments | numbers | decimal strings (`"1700000000"`) | `u64` travels as a decimal string (no precision loss in JSON) |
| `worldMeta` answer | `seed`, `createdAt` numbers | decimal strings | same rule |
| `init` | `name`, `seed`, `now` required | each optional, with defaults | `merod local`'s scenario runner and the harness create an instance without init arguments |
| who a player is | the node's device key (`env::device_id()`), a 64-hex id; rows in the account's `UserStorage` slot | the caller's **account**, plus an optional client-chosen `device` label (1–64 of `A-Za-z0-9_-`, at most 8 per account); `PlayerView.id` is the account, or `"<account>/<device>"`; `PlayerView` gains `account` and `device` | the component runtime knows accounts, not devices; the label keeps v1's rule that one person on two devices is two avatars |
| events | `BlocksChanged("<id>")`, `PlayerJoined("<id>")`, `PlayerLeft("<id>")`, `Initialized()`; emitted before the write | `BlocksChanged {id}`, `PlayerJoined {id}`, `PlayerLeft {id}`, `Initialized`; emitted after the write, to everyone the app reaches | `#[app::event]` payloads are objects; an event describes a write that happened |
| too many edits | an untyped `"too many edits in one batch"` | `TooManyEdits { max: 512, got }` | `#[app::error]` |
| two players editing one block | a per-override `updatedAt` stamp and an LWW merge with a `(clock, borsh)` tie-break | the leader's log orders them; the later call holds; the stamp is gone (`overrides` stores the block id only) | no CRDT merge under one log |
| world meta | `Frozen<WorldMeta>`: storage refused any later write | a `Cell` written by `init`, which no method writes | v1's `Frozen` was a write-once cell; component `Frozen` is content-addressed storage, a different thing. The rule is now "no method writes it" (tested) |
| avatars | storage refused another account's write to its `UserStorage` slot | rows keyed by the caller's account; no method takes an account | write rules are method checks (tested as another account) |
| `getOverrides` answer | every entry, `[{k, b}]` | one page: `{ items: [{k, b}], next }`, at most 1,000 entries (`limit` asks for fewer); pass `next` back as `cursor` until it is `null` | the map only grows (up to 128×64×128 ≈ 1M coordinates); a view never reads a whole growing collection into one answer |
| `getPlayers` answer | every row, `[PlayerView]` | one page: `{ items: [PlayerView], next }`, same `cursor` / `limit` | rows are kept for everyone who ever played |
| room clock | a scan of every player row on every call | one reverse read of a `(updatedAt, account, device)` index (`stamps`), kept in step with each row write | bounded per call however many rows there are; the rows themselves are bounded by the org's members × 8 devices |
| `overrideCount` | a scan | a stored count | lengths are counts |
| reads | any method | `worldMeta`, `getOverrides`, `overrideCount`, `worldStats`, `getPlayers`, `myAccount` are views; calling a write as a view is `NotAView` | a view is answered without touching the log |
| who may call | any member of the context | the org's owner, admins, members and guests; anonymous `401`, others `404`; System `Forbidden` | the org is the access boundary |
| malformed arguments | depends on the decoder | `BadArgs` (unknown keys refused, e.g. `account`) | the generated dispatcher |
| `#[app::idempotent]` | on the writes | gone: the client sends an idempotency key with every call | the cluster answers a retried call once |

The frontend changed with it. **Removed:** the node / account transports
(`nodeTransport`, `accountTransport`, `rpc`, `admin`, `account`, `auth`,
`authTokens`), the node connect dialog with local-node probing, the wallet
enrolment ("Cloud" tab), desktop SSO from the URL hash, namespace invitations
(`inviteCodec`, `inviteLink`, the mero-react invite prompt), the SSE decoding of
two node payload shapes, the Playwright suites (mocked node, merobox journey),
and mero-react, mero-platform, `@calimero-apps/e2e-node`, bs58, fflate and
Playwright from `package.json`. **Now:** the target comes from the build
(`@calimero-apps/connect`: `merod local` under `vite`, a Cloud cluster under
`vite build`), sign-in is a **passkey**, worlds are **app instances** (v1's
contexts) each in an **organization** of its own (v1's namespace), sharing is an
**org invite link** (kept in `@calimero-apps/connect`'s invite store) redeemed
after sign-in once the player says Join, and the game calls the contract
through `MeroBlocksClient` (`src/generated/client.ts`), which `mero-app-build
codegen` writes from `logic/res/abi.json` (`pnpm -F mero-blocks codegen` after a
contract change; CI fails when the committed copy is stale), adapted to the
engine by `src/net/blocks.ts`. The ABI names its records without their shapes
(it predates `#[derive(AbiType)]`), so the generated types are `unknown` and
`blocks.ts` types them where they are read. Kept: the launcher's look (panorama, world cards,
create dialog), the game, the marketing landing page.

`@calimero-apps/node-served` stays for the generated marketing page only
(`src/pages/landing/LandingPage.tsx` and `mount.tsx` compute the served base
path with `nodeBasename`): that page comes from the shared generator template
(`scripts/landing/`), which every app's landing uses.

## Mobile

The native iOS and Android shells (`mobile/`, the game in a WebView) move to
Calimero 1.0 in their own PR, #700, which depends on this one and merges right
after it. Their clients call this contract's component ABI: camelCase methods,
`u64`s as decimal strings, and the paged `getOverrides` / `getPlayers` followed
to the end. This PR leaves the native code to #700.

What this PR changes there is the game page the shells bundle. It shares the
web engine and `net/sync.ts`, whose `SyncEngine` now takes a typed `WorldApi`
instead of a raw `exec(method, args)`. `mobile/game/src/v1World.ts` implements
it over the native bridge with the page's own bridge wire (`set_blocks`,
`get_overrides`, `get_players`, `join`, `heartbeat`, `leave`, `now` as a number,
whole lists), which #700's `BridgeRouter` maps onto the component ABI;
`mobile/game/assets/game/game.js` is rebuilt (`mobile/scripts/build-game.sh`).

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start
without two variables set where the bundle's frontend is built:

```
VITE_CALIMERO_CLUSTER=<cluster name in the cloud's node directory>
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
```

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`),
which the cluster serves from the package's own origin: a Cloud node trusts
passkey ceremonies only from its own origins and from frontends it serves from a
bundle, so a copy on another origin cannot sign in. Instances are created from
the package (`com.calimero.mero-blocks`). The `frontend` link in
`logic/Cargo.toml` and the Vercel project (`app/vercel.json`) stay as the
listing's link; they are not where people sign in.

```bash
pnpm -F mero-blocks build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-blocks/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").

Presence is still a contract write (a heartbeat every 0.5–2 s goes through the
log). The node also has an ephemeral presence API (`publishPresence` /
`presenceStream`, 7 s TTL, no log entry) that would carry it more cheaply; it
is not used yet because `getPlayers` / `heartbeat` are part of the contract's
API that this port keeps.

## CI

`.github/workflows/components.yml` (the app is a component app because its
`logic/Cargo.toml` depends on `calimero-sdk`): fmt, clippy `-D warnings` on
the host and on `wasm32-wasip2`, `cargo test`, the release build, the committed
ABI current, a dev-signed `.mpk`; the frontend's lint, typecheck, test, build;
and the scenarios on `merod local`. The native apps keep their own workflows
(`mero-blocks-android.yml`, `mero-blocks-ios.yml`).

## Sister project

[**merraria**](../merraria) — the same architecture one dimension lower: a 2D
Terraria-style mining sandbox on Canvas2D.
