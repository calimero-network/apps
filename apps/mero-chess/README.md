# Mero Chess

Two-player chess with the referee in the contract.

A table is a Calimero **app instance** on the 1.0 runtime: a contract on core's
**component SDK** (`calimero-sdk`, a `calimero:app` WebAssembly component
on the node's wasmtime runtime), developed on **`merod local`**, with a
frontend on mero-js's **`CalimeroClient`** that talks to a **Calimero Cloud**
cluster in production and to the local nodes in development. There is no game
server: every move is one contract call, ordered by the table's log, and the
**rules live in the contract** (legal moves, check, mate, castling, en passant,
promotion, and every one of the draws), so the contract is the referee.

```
apps/mero-chess/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           #[app::state], #[app::logic], #[app::event], #[app::error]: seats, moves, endings
│   ├── src/board.rs         position, move application, FEN
│   ├── src/movegen.rs       legal moves, check, mate, the terminal conditions
│   ├── src/notation.rs      UCI (the wire) and SAN (what a person reads)
│   ├── src/game.rs          replaying a move list into a position
│   ├── src/perft.rs         the standard perft positions: proof the movegen is right
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           play-a-game, access (+ .org.json): harness AND merod local
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
├── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
│   └── src/chess.ts         the contract's methods, typed (tested against res/abi.json)
├── docs/trust-model.md      the v1 trust model, kept as a worked example (see below)
└── mobile/                  native iOS / Android apps (moved to 1.0 in #686: see below)
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local mero-chess        # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), press **New table**, take a seat, and
**Create invite link** for your opponent. A second browser profile with its own
passkey that opens the link is the other player: signed in, it is asked "Join
{inviter}'s game as {account}?" and joins only on **Join** (a new account made
from the invitation page joins in that one step).

**On your own?** Take both chairs. The contract allows one account to hold White
and Black on purpose: pass-and-play is how chess works when the other person is
in the room.

## The design

**One log, one game.** Every call is applied by the cluster's leader in log
order, so `play` checks the move (whose turn, both chairs taken, legal in the
position) and stores it in the same run. Two people cannot both take a ply: the
first call plays, the second is refused because the turn has passed.

**Moves are stored; the position is replayed.** State is the move list keyed by
`(game, ply)`, and every read replays it from the initial array (at most 600
plies). That is what lets the contract see threefold and fivefold repetition,
which need every position the game has been through.

**The contract hands out the legal moves.** `table` returns the position AND
every legal move in it, so the frontend contains no chess engine at all: it
highlights the squares the contract named. The board therefore cannot offer a
move the contract would refuse, and a modified client cannot play one.

**Results come from the rules.** Checkmate, stalemate, insufficient material,
fivefold repetition and the seventy-five-move rule are seen by `play` the moment
the move that causes them is played. Only an ending a *person* causes (a
resignation, an agreed draw, a claimed one) is its own call, and that call is
checked before it is written: a resignation must lose, an agreement needs the
opponent's offer standing in this position, a claimed draw must be available.
Threefold repetition and the fifty-move rule are **claims**, as they are in the
rules of chess; fivefold and seventy-five moves are automatic.

## Trust

v1 ran the contract on each player's own node, and a peer's node folded deltas
into storage without running it, so v1 stored only per-author, write-once
claims and re-derived everything on read ([`docs/trust-model.md`](docs/trust-model.md)
is that design, and the defects it fixed, written up for anyone building a v1
app). Under one log every write IS this code, so the guarantees are method
checks against `env::caller()`:

| attempt | what stops it |
|---|---|
| an illegal move, or one that is not UCI | `play` refuses it (`IllegalMove`, `BadMove`) |
| a move for the player to move, by anyone else | `play` writes only as the caller, and only the side to move may (`NotYourMove`) |
| moving twice, or out of turn | the same check: it is no longer your turn |
| taking a move back, or rewriting an old ply | there is no method that edits or removes a move |
| un-resigning by playing on, or withdrawing an agreed draw | the game is over: `play`, offers and declines are refused (`GameOver`, `NoDrawOffer`) |
| a resignation, draw or result for somebody else | endings are written only by a seated player, as themselves, and only when they hold (`NotSeated`, `NoDrawOffer`, `NoDrawToClaim`) |
| a rematch that erases a live game | `rematch` needs a finished game and a seated caller (`GameNotFinished`, `NotSeated`) |
| seat theft | a chair someone holds is theirs (`SeatTaken`); one they have played from cannot be given up (`AlreadyPlayed`) |
| relabelling the table | the title and creation date are written by `init` and nothing else |

Who reaches a table is its organization's business: members, admins, guests and
the owner. Anyone who reaches it may take a free chair and play; everyone else
watches. Events go to everyone the table reaches (`Audience::All`), guests
included, which is what keeps a guest's board (player or spectator) current.

What remains: a player can still **stall** (stop moving, or sit down and walk
away before the first move; `stand` is allowed until then). There is no clock.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-chess/logic/Cargo.toml` | the rules (`board`/`movegen`/`notation`/`game` unit tests and perft), v1's `TestHost` tests method for method (seats, turns, mate, stalemate, promotion, resignation, draw offers, threefold and fivefold, rematches, pass-and-play, spectators, presence, events), the permission checks that replace v1's owner stamps and forged-row tests, access and wire checks, and every `scenarios/*.json`, on core's wasmtime engine | no |
| `pnpm -F mero-chess test` | the board helpers; the methods the UI calls are exactly the committed ABI's, with its parameter names; the adapter from the new answers to the screens' shapes; sign-in, the lobby, tables, seats, moves, refusals, invitations, session restore (mocked client) | no |
| `pnpm merod-local e2e mero-chess` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

**`src/perft.rs` is the one worth knowing about.** Counting the leaf nodes of
the move tree from the five standard positions is the only test that catches the
whole class of bugs unit tests miss: a castling right that survives a rook
capture, an en-passant capture that exposes the king, a promotion that generates
one move instead of four. The expected numbers are the published ones, so a
wrong generator cannot agree with them by construction. (It moved from
`tests/perft.rs` into the crate: a component crate is a `cdylib` only, so an
integration test cannot link its modules.)

`play-a-game.json` is v1's two-node Docker workflow (`play-a-game.yml`), with
two accounts instead of two nodes, across five games: a refused claim on a taken
seat, the scholar's mate with a refused out-of-turn move and a refused move into
the finished game, a rematch with the colours swapped and presence read at once
and long after, a declined offer then an agreed draw, a claimed threefold, a
resignation, and a refused `stand` and seat theft at the end, with the record
read back. `access.json` adds what that workflow never could: anonymous callers
and accounts outside the org refused, a guest playing, a spectator refused when
it tries to move, take a seat, offer, accept, decline or claim a draw, resign or
rematch for a player, typed errors with their fields.

## What changed in the port, and why

Same methods, same arguments (in camelCase), same answers and events, with these
differences a client sees:

| | v1 (`calimero-sdk`, wasmer, a context) | now (component SDK, an app instance) | why |
|---|---|---|---|
| transport | JSON-RPC `execute` on your own node, a context id | `POST /apps/{app}/intents` (calls) and `/views` (reads) on any node of the cluster, an app id | one app per replicated log |
| `init` | `init(title, now)`, both required | `init(title?, now?)`: `title` defaults to `"Chess"`, `createdAt` is `"0"` without `now`; the frontend passes both as `initArgs` | the harness and `merod-local e2e` create apps without init arguments |
| method names | `offer_draw`, `accept_draw`, `decline_draw`, `claim_draw` | `offerDraw`, `acceptDraw`, `declineDraw`, `claimDraw` (the rest are one word) | the ABI names methods in camelCase |
| `now` arguments | numbers | decimal strings (`"1700000000000"`) | `u64` travels as a decimal string (D20) |
| result field names | `created_at`, `side_to_move`, `legal_moves`, `claimable_draw`, `my_color`, `my_turn`, `draw_offer_from`, `games_played`, `started_at` | `createdAt`, `sideToMove`, `legalMoves`, `claimableDraw`, `myColor`, `myTurn`, `drawOfferFrom`, `gamesPlayed`, `startedAt` | camelCase like every component app's wire (the frontend converts them back in one place, `src/chess.ts`) |
| `u64` result fields | numbers (`created_at`, `moves[].at`, `started_at`) | decimal strings | D20 |
| `me`, `member`, `by`, `players[].id`, `white`/`black` in `history` | the hex public key of the caller's account | the caller's **account id** | identity is an account (passkeys), not a node key |
| `players` order | sorted by id | in the order each player first announced themselves | a stable order that does not depend on how account ids sort |
| reads | any method | `table` and `history` are views (`#[app::view]`); calling a write as a view is `NotAView` | a view is answered without touching the log |
| refusals | `app::bail!("that seat is taken")`: an untyped error string | `422 APP_ERROR` `{ code, fields }`: `UnknownSeat {seat}`, `SeatTaken`, `NotSeated`, `AlreadyPlayed`, `GameOver`, `MoveLimit`, `WaitingForOpponent`, `NotYourMove`, `BadMove {uci}`, `IllegalMove {uci}`, `NoDrawOffer`, `NoDrawToClaim`, `GameNotFinished`, and new `GameLimit`; the UI shows v1's messages for them | `#[app::error]`'s wire shape |
| `NotSeated` | six messages ("you are not seated", "only a seated player can resign / offer / accept / decline / claim / start a rematch") | one code | one condition |
| `NoDrawOffer` | "there is no draw offer to accept" / "…to decline" | one code | one condition |
| who holds a chair | the earliest claim by its author's clock, locked once both players had moved naming each other | the first `sit` in log order; it is yours until you `stand` (allowed only before you have played here and before the game has a move) | one log orders claims, so nobody can backdate one |
| `equivocation` | a reason a game could end with: a player who wrote two different moves at one ply lost | gone: a ply takes one move, the second call is refused | one log |
| two rematch calls for the same game | both rows counted as one new game | the second is refused (`GameNotFinished`): the first already started the next game | the first call changed the state the second sees |
| more than 1,024 games | rematch rows past the 1,024th were ignored by every read | `rematch` refused with `GameLimit` | refuse instead of writing what nobody reads |
| SAN | recomputed by every reader from the replay | computed by `play` and stored with the move | under one log the stored SAN is the one `play` computed |
| `history` of a finished game | the players read from the chairs now | the players who held the chairs when it ended | a finished game names who played it |
| events | to the context's members; `Initialized()` and `PlayerJoined(id)` were tuple variants | to everyone the table reaches (`Audience::All`, guests included); `Initialized` has no payload and `PlayerJoined` names its field (`PlayerJoined { member }`) | component events have named fields |
| who may call | any member of the context | any member, admin or guest of the table's org, and the owner; anonymous `401`, others `404` | the org is the access boundary |
| malformed arguments | depends on the decoder | `BadArgs` (unknown keys refused, every parameter required) | the generated dispatcher |
| `online` | presence row written within 30 s of the reader's `now` | unchanged | |

The frontend changed with it: mero-react's provider, the node login, the
context picker, the namespace invitations and their deep-link codec
(`links.calimero.network/…/join?invitation=…`), the desktop SSO hand-off, the
`@calimero-apps/names` namespace-wide names, the generated `MeroChessClient` and
the Playwright suites that drove a merod 0.x node are gone. It now resolves its
target from the build (`@calimero-apps/connect`: `merod local` under `vite`, a
Cloud cluster under `vite build`), signs in with a **passkey**, lists and
creates **tables** (app instances: v1's contexts) in **organizations** (v1's
namespaces: "New table" makes both, "Add table" puts another table in one you
have), invites an opponent with an **org invite link** that also names the
table, its org and the inviter (making it is approved with your passkey; the
shared invite store in `@calimero-apps/connect` keeps the token; a signed-in
player is asked before it is redeemed, then the table opens), re-reads the table on the table's **event
stream** (and a 6-second poll for presence), and calls the contract by method
name through `src/chess.ts`, whose method list a test checks against
`logic/res/abi.json` and which converts the answers back to the shapes the
screens were written against, so the board, the seats, the game card and the
scoresheet are unchanged. A seat with no name given shows a short account id
(v1 fell back to the name its holder set for the namespace; an org has no such
record yet). A refused call's message now stays on screen until dismissed (v1's
re-read after every call cleared it at once).

The v1 contract's storage migrations: there were none in this app, and the
component SDK has none (`#[app::migrate]` is not in this version), so a v1
table's state does not carry over: a component table starts empty.

## Mobile

The native **iOS and Android** apps (`mobile/`) move to Calimero 1.0 in their
own PR, #686, which depends on this one and merges right after it. They call
this component ABI: the same method names, parameters and camelCase answers as
the web frontend (the table above). This PR leaves `mobile/` as it is on `main`.

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
the package (`com.calimero.mero-chess`). The `frontend` link in
`logic/Cargo.toml` and the Vercel project (`app/vercel.json`) stay as the
listing's link; they are not where people sign in.

```bash
pnpm -F mero-chess build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-chess/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").
