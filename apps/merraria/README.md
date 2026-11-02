# merraria

**A browser-playable, Terraria-style 2D multiplayer mining sandbox with no
game server — the world lives on [Calimero](https://calimero.network).**

Sister project of [**mero-blocks**](../mero-blocks): the same world-as-state
architecture one dimension lower, and radically lighter — the entire game
(engine, renderer, networking, UI) is plain TypeScript on a Canvas2D with zero
rendering dependencies.

The contract is a WebAssembly component on core's **component SDK**
(`calimero-app-sdk`, the node's wasmtime runtime), developed on **`merod
local`**; the frontend talks to a **Calimero Cloud** cluster in production and
to the local nodes in development through mero-js's **`CalimeroClient`**. See
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component apps
are built, run and tested in this repo.

```
apps/merraria/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           #[app::state], #[app::logic], #[app::event], #[app::error]
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           world, access (+ .org.json): harness AND merod local
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
├── app/                     the game: Vite + vanilla TS (+ the React marketing page)
└── mobile/                  native iOS/Android shells — still v1, see below
```

---

## What it showcases

1. **An app instance as a game world.** Dig and build with friends; every tile
   edit is a write in the world's replicated log. No game server, no infra.
2. **The seed + diff trick.** The 400×200 tile world — rolling hills, worm-
   carved caves, depth-stratified ores (coal → iron → gold), lakes, trees —
   regenerates identically on every client from the seed in the contract. The
   network carries only the override diff (dig = explicit `0`, never a
   removal) and presence. Joining costs two reads.
3. **Gameplay depth on tiny state.** Per-tile dig hardness with crack
   progress, an inventory that gains what you mine and spends what you build,
   genuinely dark caves you light with torches (2D flood-fill lighting), a
   live minimap, and a shared day/night cycle that costs zero traffic.
4. **Skew-proof presence.** The mero-meet room clock: silent heartbeats,
   roster polls with event nudges, and no way for a machine with a skewed
   clock (or a far-future stamp) to knock live players offline. A player who
   vanishes without `leave` ages out of the TTL; nobody writes another
   player's row.
5. **Passkey accounts, shared worlds.** Sign in with a passkey; each world
   lives in an organization of its own, and friends join it through an invite
   link (making one is approved with your passkey).

## How it works

```
 browser A                 cluster (one leader, one log)            browser B
┌────────────┐  setTiles  ┌────────────────────────────┐  event    ┌────────────┐
│ 2D engine  │ ─────────▶ │  merraria component (wasm)  │ ────────▶ │ re-pull    │
│ + Canvas2D │ (150ms     │  meta · overrides · players │  stream   │ overrides  │
└────────────┘  batch)    └────────────────────────────┘           └────────────┘
                getPlayers / heartbeat (0.5s/3s, silent)
```

- **Contract** (`logic/`, `calimero-app-sdk` at core `1.0.0-rc.8`):
  `meta: Cell<{name, seed, createdAt}>` (written once by `createWorld`, by the
  world's owner), `overrides: UnorderedMap<"x,y", tile>` (public on purpose:
  anyone in the world may dig or build anywhere) and `players:
  UnorderedMap<account, Player>` (each row written only under its own
  caller's account).
- **Engine** (`app/src/engine/`, pure TS): deterministic terrain, 2D
  flood-fill lighting (80k cells — full recompute per edit is fast enough),
  platformer AABB physics (gravity, jump, swim), mining/inventory, day/night.
- **Renderer** (`app/src/renderer.ts`): Canvas2D tile window with per-tile
  light multiply and hash-based texture, sky gradient + sun/moon, remote
  miners with name tags, dig-crack overlay, whole-world minimap.
- **Net** (`app/src/net/`): `session.ts` (target, `CalimeroClient`, passkey
  session), `worlds.ts` (worlds, invitations, the world last played),
  `merraria.ts` (the contract's methods, typed), `client.ts` (calls, views and
  the event stream), `sync.ts` (batched edits with echo suppression, polling,
  reconcile on connect).

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local merraria          # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), **create a world** (name and seed), and
play. **Invite friends** (on the world list, or Esc → *Copy world invite* in
game) copies a link; a second browser profile with its own passkey that opens
it is a second player.

**Controls:** A/D move · Space/W jump · hold LMB to dig · RMB place ·
1–9/wheel select · torches light caves · Esc/O menu.

The [Makefile](Makefile) wraps the same commands (`make dev`,
`make test`, `make logic-build`, `make bundle`, …).

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/merraria/logic/Cargo.toml` | v1's `TestHost` tests method for method (bounds, batching, presence TTL, clock skew, far-future stamps, rejoin, transforms), v1's storage write rules as method checks (only the owner founds the world, once; nobody moves another player's avatar), access and wire checks, and every `scenarios/*.json`, on core's wasmtime engine | no |
| `pnpm -F merraria test` | the methods the game calls are exactly the committed ABI's, with its parameter names; terrain, lighting, physics, mining, sync protocol, the event stream and its resume, worlds and invitations, the launcher's screens (mocked client), the mobile bridge | no |
| `pnpm merod-local e2e merraria` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

`world.json` is the old two-node Docker workflow (`logic/workflows/e2e.yml`, removed), ported: the owner
founds the world (seed 42, "surface"), both miners join and see each other in
the roster, one builds a plank shelter with a torch, the other sees it and digs
one tile out (an explicit `t: 0`), heartbeats carry live positions and actions
both ways, and a leave shows up as offline. `access.json` adds what that
workflow never could: `createWorld` refused to an admin and a member and the second
time to the owner, writes before the world exists, anonymous callers and
accounts outside the org refused, a guest allowed to play, a member who claims
another player's name moving only their own row, an extra `id` argument
refused, and a removed member refused.

## What changed in the port, and why

Same methods, same arguments and answers, same events, with these differences
a client sees:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `world_meta`, `set_tiles`, `get_overrides`, `get_players` | `worldMeta`, `setTiles`, `getOverrides`, `getPlayers` (`join`, `heartbeat`, `leave` unchanged) | the ABI names methods and arguments in camelCase |
| founding a world | `init(name, seed, now)` when the context is created | `init()` takes nothing; the creator then calls **`createWorld(name, seed, now)`** (owner only: `Forbidden` for anyone else; once: `WorldExists`). Until then `worldMeta` and every write answer `NoWorld` | the test harness and the e2e runner create instances without init arguments, and a founding call is what both can exercise |
| world meta | `Frozen` storage: no node accepts a second write | a `Cell` written once by `createWorld`; no method changes it | the same rule, as a method check |
| `seed`, `createdAt`, every `now` | `u64` | `u32` (a JSON number, as before; a `now` ≥ 2^32 is `BadArgs`) | a `u64` would travel as a decimal string; the terrain generator reads the seed as a u32 anyway and seconds fit a u32 until 2106 |
| the player id (`PlayerView.id`, event payloads) | the device key (`env::device_id()`), so one person on two devices was two avatars | the **account** (`env::caller()`): one account is one avatar, and a second session of the same account moves the same row | the component runtime names the caller's account only; there is no device id |
| who may write an avatar | `UserStorage`: every node refuses another account's write | no method takes a row id: each call writes only the caller's own row (an extra `id` argument is `BadArgs`) | the same rule, as a method check |
| tile writes | per-tile `{t, updatedAt}`, merged last-writer-wins by stamp | `"x,y"` → tile id; the leader's log orders writes, and the later one holds whatever the clocks say | no CRDT merge under one log |
| `setTiles` with > 512 edits | `"too many edits in one batch"` | `422 APP_ERROR` `{ code: "TooManyEdits", fields: { max: 512 } }` | `#[app::error]`'s wire shape |
| `getPlayers` order | map order | join order (then account); the whole roster, at most 1,000 | a stable roster, and portable scenarios |
| `getOverrides` | `get_overrides()`: every override, one array | `getOverrides({ cursor?, limit? })`: **one page**, `{ items: [{k, t}], next }`, at most `limit` (default and largest 1,000) from `cursor`; read pages until `next` is `null` (`readAllOverrides` in `src/net/merraria.ts` does, so the game code is unchanged) | a view answers one page, never a whole collection: a full world (80,000 tiles) would be one answer of over a megabyte on every load |
| how many players a world keeps | unbounded | at most 1,000 avatars (one per account that ever joined): a new account past that gets `WorldFull { max: 1000 }`, while accounts already in the world keep playing | every call reads the whole roster to find room time, so it must stay one page |
| events | `TilesChanged(id)`, `PlayerJoined(id)`, `PlayerLeft(id)`, `Initialized()`; data a bare string | the same names; data `{ "0": "<account>" }` (`Initialized` has none, and is emitted by `createWorld`) | tuple fields are keyed `"0"` on the wire |
| reads | any method | `worldMeta`, `getOverrides`, `getPlayers` are views (`#[app::view]`); a write called as a view is `NotAView` | a view is answered without touching the log |
| transport | JSON-RPC `execute` on your own node (or warrants through an account's relay), a context id | `POST /apps/{app}/intents` (calls) and `/views` (reads) on any node of the cluster, an app id | one app per replicated log; any node serves any request |
| who may play | any member of the context | the owner, admins, members and guests of the world's org; anonymous `401`, others `404` | the org is the access boundary |
| malformed arguments | depends on the decoder | `BadArgs` (unknown keys refused, every parameter required) | the generated dispatcher |

The frontend changed with it. **Removed:** the node login and auth redirect,
the account/relay transport and wallet enrolment, the desktop SSO hash hand-off,
the node-health probe and connect popup, the v1 world picker (contexts on a
node, `getContextIdentitiesOwned`), the v1 invitation codec, deep links and
the invitation prompt (mero-react), mero-platform, the JSON-RPC layer, and the
Playwright suites that drove a mocked v1 node. **Now:** it resolves its target
from the build (`@calimero-apps/connect`: `merod local` under `vite`, a Cloud
cluster under `vite build`), signs in with a **passkey**, lists the
**worlds** the account reaches (app instances: v1's contexts) and creates them
in an **organization** of their own (v1's namespace), invites with an **org
invite link** (`?invite=`, redeemed once the person has signed in), and calls
the contract by name through a typed wrapper (`src/net/merraria.ts`) whose
method list a test checks against `logic/res/abi.json`. The event stream
resumes from the last log index it saw, so a dropped stream misses nothing.
The game itself (engine, renderer, HUD, menu, sync engine) is unchanged.

### Mobile (not ported yet)

`mobile/` (native iOS and Android shells around the bundled web game) still
signs in and calls the **v1** contract through swift-sdk / kotlin-sdk (v1
contexts, relays, clients generated from the v1 ABI). Neither SDK has a client
for the component runtime yet, so they cannot be moved in this PR and are left
as they are: the committed `mobile/game/www` is the last v1 build and keeps
working with them. The web game's native-host mode (`src/native/host.ts`)
keeps speaking v1 method names over the bridge (`V1_METHOD`), so rebuilding
that bundle (`mobile/scripts/build-game.sh`) does not break the shipped apps.
Moving them needs a component-runtime client in both SDKs.

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start
without two variables set where the bundle's frontend is built (see
`app/.env.example`):

```
VITE_CALIMERO_CLUSTER=<cluster name in the cloud's node directory>
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
```

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`),
which the cluster serves from the package's own origin: a Cloud node trusts
passkey ceremonies only from its own origins and from frontends it serves from a
bundle, so a copy on another origin cannot sign in. Worlds are created from the
package (`com.calimero.merraria`). The `frontend` link in `logic/Cargo.toml`
and the Vercel project (`app/vercel.json`) stay as the listing's link; they are
not where people sign in.

```bash
pnpm -F merraria build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/merraria/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").

## Contract API

| method | kind | arguments | answer |
|---|---|---|---|
| `createWorld` | call (owner, once) | `name: string, seed: u32, now: u32` | `null` |
| `worldMeta` | view | — | `{ name, seed, createdAt }` |
| `setTiles` | call | `edits: [{x, y, t}] (≤ 512), now: u32` | applied count |
| `getOverrides` | view | `cursor?: string, limit?: u32` (≤ 1,000) | `{ items: [{ k: "x,y", t }], next: string \| null }`: one page |
| `join` | call | `name: string, now: u32` | the caller's `PlayerView` |
| `heartbeat` | call | `t: {name, x, y, dir, sel, action?}, now: u32` | `null` |
| `leave` | call | `now: u32` | `null` |
| `getPlayers` | view | `now: u32` | `[PlayerView { id, name, x, y, dir, sel, action, online }]` |
