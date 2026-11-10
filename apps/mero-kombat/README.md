# Mero Kombat

A one-on-one arcade fighting game where every punch is a transaction.

Two fighters, two corners, best of three rounds: uppercuts, sweeps, flying
kicks and a special each. An arena is a Calimero **app instance** on the 1.0
runtime: a contract on core's **component SDK** (`calimero-sdk`, a
`calimero:app` WebAssembly component on the node's wasmtime runtime), developed
on **`merod local`**, with a frontend on mero-js's **`CalimeroClient`** that
talks to a **Calimero Cloud** cluster in production and to the local nodes in
development. There is no game server: movement streams over the node's
ephemeral presence channel, and every action a fighter finishes is one contract
call, ordered by the arena's log. Health, rounds and the winner are kept by the
contract from those calls, and the arena shows the transaction count,
throughput and confirm time live while you fight.

```
apps/mero-kombat/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           corners, actions, the damage table, rounds and matches
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           fight-a-match, access (+ .org.json): harness AND merod local
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
├── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
│   ├── src/game/            the engine: physics, poses, renderer, stage, HUD, sound, CPU, netcode
│   ├── src/kombat.ts        the contract's methods, typed (tested against res/abi.json)
│   ├── src/presence.ts      movement over the node's presence channel
│   └── scripts/             icon generator
└── mobile/                  native iOS / Android shells around the same engine (moved in #701: see below)
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local mero-kombat       # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), press **New arena**, take a corner, and
**Create invite link** for your opponent. A second browser profile with its own
passkey that opens the link is the other fighter.

**No cluster?** Open `/practice` and fight the CPU. Nothing in practice is a
transaction; it is the same engine with nobody on the other side of the network.

Controls: **A/D** move, **W** jump, **S** crouch, **J** punch, **K** kick,
**L** block, **I** special. Crouch + punch is an uppercut, crouch + kick a sweep,
kick in the air a flying kick. Arrows + Z/X/C/V work too, and the keycaps under
the arena are pressable on a touch screen.

## The design, in three decisions

**Movement is presence; actions are transactions.** Where a fighter stands
changes sixty times a second and is worthless a moment later, so it travels over
the node's ephemeral presence channel (`publishPresence` / `presenceStream`, 15
slices a second, never stored, never in the log). Everything that decides the
fight (a punch, a kick, a jump, a block) is one `act` call when the action
finishes, whether it connected or missed.

**The contract keeps the score.** v1 stored only the actions and re-derived
health on every read, because a stored HP value could not converge between two
nodes subtracting concurrently. Under one log there is nothing to converge:
`act` applies a blow to the current match (round, damage taken, decided rounds,
winner) in the same run that records it, so a read is one row. The first blow
that brings a fighter to 100 damage decides the round; a blow sent for a round
that is over is refused; two round wins take the match.

**The bars move now and settle on the contract.** A blow lands on the
attacker's screen first and travels in their next presence slice, so both bars
drop at once. Each blow carries the thrower's sequence number, and the contract
returns the same number with the blows it has counted, so the optimistic guess
and the stored truth are matched and nothing is subtracted twice.

## Trust

The attacker's client decides whether a blow connected: only it knows where its
own fist was. The contract bounds what a claim is worth (a fixed damage per
move, chip damage when blocked, at most 2,000 actions per fighter per round),
refuses blows for rounds already decided, and writes every action as the
account that called it, so a player can only ever land blows for themselves
(v1 got that from core's owner stamp on each row; here `act` checks that the
caller holds a corner). A modified client can claim blows it did not land, as in
any peer-to-peer fighting game; the log is the record that it did.

Who reaches an arena is its organization's business: members, admins, guests
and the owner. Anyone who reaches it may take a free corner and fight; everyone
else watches.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-kombat/logic/Cargo.toml` | v1's `TestHost` tests method for method (corners, the damage table, rounds, best of three, rematches, the corner rules), v1's double knock-out as what it becomes under one log, the permission checks that replace owner stamps, access and wire checks, and every `scenarios/*.json`, on core's wasmtime engine | no |
| `pnpm -F mero-kombat test` | the engine (hits, guards, launches, specials) and the netcode (one tx per action, no double-counted blow); the methods the UI calls are exactly the committed ABI's, with its parameter names; presence encoding; sign-in, the lobby, arenas, corners, rematch, invitations, session restore (mocked client) | no |
| `pnpm merod-local e2e mero-kombat` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

`fight-a-match.json` is v1's two-node Docker workflow (`fight-a-match.yml`),
with two accounts instead of two nodes: corners, a refused claim on a taken corner, an
exchange read back by the other fighter, two knock-outs, a refused late blow, a
flawless win, the record, a refused stand, a rematch with the score kept, and
the whole event stream the other screen heard. `access.json` adds what that
workflow never could: anonymous callers and accounts outside the org refused, a guest
fighting, a spectator refused when it tries to act, stand or take a corner for a
fighter, typed errors, malformed arguments.

## What changed in the port, and why

Same methods, same arguments (in camelCase), same answers and events, with these
differences a client sees:

| | v1 (`calimero-sdk`, wasmer, a context) | now (component SDK, an app instance) | why |
|---|---|---|---|
| transport | JSON-RPC `execute` on your own node, a context id | `POST /apps/{app}/intents` (calls) and `/views` (reads) on any node of the cluster, an app id | one app per replicated log |
| `init` | `init(title, now)`, both required | `init(title?, now?)`: `title` defaults to `"Arena"`, `createdAt` is `"0"` without `now`; the frontend passes both as `initArgs` | the harness and `merod-local e2e` create apps without init arguments |
| argument names | `match_index` | `matchIndex` (the others are one word) | the ABI names arguments in camelCase |
| `now` arguments | numbers | decimal strings (`"1700000000000"`) | `u64` travels as a decimal string (D20) |
| result field names | `match_index`, `round_results`, `my_seat`, `match_actions`, `total_actions`, `max_hp`, `rounds_to_win`, `created_at`, `rounds_won`, `matches_won`, `started_at` | `matchIndex`, `roundResults`, `mySeat`, `matchActions`, `totalActions`, `maxHp`, `roundsToWin`, `createdAt`, `roundsWon`, `matchesWon`, `startedAt` | camelCase like every component app's wire |
| `u64` result fields | numbers (`total_actions: 7`, `created_at`, `hits[].at`, `started_at`) | decimal strings (`"7"`) | D20 |
| `me`, `member`, events' `member`/`by` | the base58 public key of the caller's identity | the caller's **account id** | identity is an account (passkeys), not a node key |
| reads | any method | `arena` and `history` are views (`#[app::view]`); calling a write as a view is `NotAView` | a view is answered without touching the log |
| refusals | `app::bail!("that corner is taken")`: an untyped error string | `422 APP_ERROR` `{ code, fields }`: `CornerTaken`, `InOtherCorner`, `UnknownSeat {seat}`, `UnknownFighter {fighter}`, `UnknownMove {kind}`, `NotInCorner`, `AlreadyFought`, `WaitingForOpponent`, `MatchOver`, `WrongMatch {current}`, `RoundOver {current}`, `ActionLimit`, `MatchNotFinished`, and new `MatchLimit`; the UI shows v1's messages for them | `#[app::error]`'s wire shape |
| `NotInCorner` | three messages ("only a fighter in a corner can act", "…can call a rematch", "you are not in a corner") | one code | one condition |
| who holds a corner | the earliest claim by its author's clock, locked once both fighters had named each other in their actions | the first `sit` in log order; it is yours until you `stand` (allowed only before you have fought here) | one log orders claims, so nobody can backdate one |
| double knock-out | both finishing blows written at once on two nodes: a round scored `"draw"` for nobody, and a 9-round ceiling called a match of draws a draw | cannot happen: the first finishing blow decides the round and the other is refused (`RoundOver`); `roundResults` and `winner` are only ever `p1`/`p2` | blows are applied in log order |
| two rematch calls for the same match | both rows counted as one rematch | the second is refused (`MatchNotFinished`): the first already started the next match | the first call changed the state the second sees |
| more than 512 matches | rematch rows past the 512th were ignored by every read | `rematch` refused with `MatchLimit` | refuse instead of writing what nobody reads |
| `hits` order | by the throwers' clocks | by log order (newest first) | the log is the order |
| events | before the write | after it, to everyone the arena reaches (`Audience::All`); `Initialized` and `PlayerJoined` now carry named fields (`PlayerJoined { member }`) | an event describes a write that happened; component events have named fields |
| `online` | presence row written within 30 s of the reader's `now` | unchanged (the frontend's "in the arena" still comes from the presence stream) | |
| who may call | any member of the context | any member, admin or guest of the arena's org, and the owner; anonymous `401`, others `404` | the org is the access boundary |
| malformed arguments | depends on the decoder | `BadArgs` (unknown keys refused, every parameter required) | the generated dispatcher |

The frontend changed with it: mero-react's provider, the node login, the
context picker, the namespace invitations and their deep-link codec, the
desktop SSO hand-off, the `@calimero-apps/names` namespace-wide names, the
generated `MeroKombatClient` and the Playwright suites that drove merod 0.x are
gone. It now resolves its target from the build (`@calimero-apps/connect`:
`merod local` under `vite`, a Cloud cluster under `vite build`), signs in with
a **passkey**, lists and creates **arenas** (app instances: v1's contexts) in
**organizations** (v1's namespaces: "New arena" makes both, "Add arena" puts
another arena in one you have), invites an opponent with an **org invite link**
that also names the arena (making it is approved with your passkey; opening it
after signing in redeems it and opens the arena, else one in that organization;
the pending invite is `@calimero-apps/connect`'s `createInviteStore`, dropped on
sign-out; a member who may not add an arena is told to ask an owner), streams movement over the
node's **presence** channel and the arena's **event stream**, and calls the
contract by method name through `src/kombat.ts`, whose method list a test checks
against `logic/res/abi.json`. A corner with no name given shows a short account
id (v1 fell back to the name its holder set for the namespace; an org has no
such record yet). The game engine (`src/game`) is unchanged.

## Mobile

The native **iOS and Android** apps (`mobile/`, the same engine in a WebView)
move to Calimero 1.0 in their own PR, #701, which depends on this one and
merges right after it. They call this contract's component ABI: the same
methods, camelCase argument and result names, `u64`s as decimal strings and
the typed error codes in the table above. Until #701 lands, `mobile/` is
unchanged here; `mobile/web` (the game page) builds against the unchanged
engine.

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
the package (`com.calimero.mero-kombat`). The `frontend` link in
`logic/Cargo.toml` and the Vercel project (`app/vercel.json`) stay as the
listing's link; they are not where people sign in.

```bash
pnpm -F mero-kombat build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-kombat/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").
