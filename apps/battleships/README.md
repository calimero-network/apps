# Battleships

Two-player Battleships where your fleet never leaves your device.

A lobby is a Calimero **app instance** on the 1.0 runtime: a contract on core's
**component SDK** (`calimero-sdk`, a `calimero:app` WebAssembly component
on the node's wasmtime runtime), developed on **`merod local`**, with a
frontend on mero-js's **`CalimeroClient`** that talks to a **Calimero Cloud**
cluster in production and to the local nodes in development. The lobby pairs
players, runs every match and keeps the record; every shot is one contract
call, ordered by the lobby's log.

```
apps/battleships/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           #[app::state], #[app::logic], #[app::event], #[app::error]: lobby + matches
│   ├── crates/rules/        the rules with no SDK: board, fleet, commitment, the audit (+ unit tests)
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           match-lifecycle, access (+ .org.json): harness AND merod local
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
├── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
│   ├── src/generated/       BattleshipsClient: `meroctl app codegen` from res/abi.json (committed)
│   └── src/battleships.ts   the screens' shapes, the adapter to them, and the refusals in words
└── mobile/                  native iOS / Android apps (still v1: see mobile/README.md)
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local battleships       # merod local + build + deploy + http://localhost:5173/
meroctl local dev apps/battleships  # the same with core's meroctl (1.0.0-rc.24 or later)
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`).
In the browser, **create an account** (a passkey), create a lobby, and
**Invite player** for your opponent: a second browser profile with its own
passkey that opens the link is asked "Join {inviter}'s game as {account}?" and,
on **Join**, joins the lobby's organization (an account made from the
invitation page joins in that one step). Each of you opens
the lobby once (that is what puts you on its roster), then one challenges the
other, both deploy a fleet, and you take turns.

## The design

**The board stays on the device.** The contract never holds a board. Each
player's board and salt are kept in this browser's storage; the contract
stores only `SHA256(borsh(board) || salt)` (`commitBoard`). The defender's
client answers every shot from that local board (`acknowledgeShot`, a signed
statement, written once), and at match end both clients publish
`(board, salt)` (`revealBoard`). The reveal is checked against the commitment,
checked to be a legal fleet, and every answer its owner gave is replayed
against it. The declared winner must pass that audit to win; a winner who lied
loses to the player they lied to; a match both players cheated in is void. A
defender who answers "miss" forever cannot stall the game: a fleet is 17
cells, so an 84th miss on a 100-cell board is a lie on its face.

**One instance, one log.** v1 was two services: a lobby context per namespace
and a game context per match, the game reporting its result to the lobby with
a cross-context call. Here the lobby and every match are one app instance, so
the call that decides a match (the reveal that passes or fails the audit)
records the winner, the history and both players' stats in the same run.
There is no context to create or join per match, and no report from another
context to trust.

**Turn, pending shot and result are derived.** Whose turn it is, which shot
waits for an answer, how the answers ended the match and who won are worked
out on every read from the stored commitments, shots, answers and reveals
(`getMatchState` in one read), never stored as a field a call could set.

## Trust

v1 ran each service on every member's node, and a peer's node folded deltas
into storage without running the contract, so v1 leaned on storage types every
node enforced (`UserStorage`, `Authored`, `WriteOnce`, `Frozen`), per-author
rows, owner stamps, equivocation rules, and a lobby that checked which context
a result came from. Under one log every write IS this code, so each of those
rules is a check against `env::caller()`:

| attempt | what stops it |
|---|---|
| playing in someone else's match, or reading its shots | every game method checks the caller is one of its two players (`Forbidden`) |
| shooting out of turn, twice, before both fleets are in, or at a cell already shot | `proposeShot` (`Forbidden: not your turn`, `Invalid`) |
| answering your own shot, an old shot, or a shot twice | `acknowledgeShot` answers only the pending shot, only as its target, once |
| a second commitment, to open whichever board suits at the end | `commitBoard` (`AlreadyCommitted`) |
| revealing a board other than the one committed | `revealBoard` (`CommitmentMismatch`) |
| a board revealed mid-match | `revealBoard` waits for the answers to end the match (`Invalid`) |
| a lie about a hit or a miss | the reveal's replay: the liar fails the audit and loses |
| a result for a match you did not win | results are written only by the audit's decision, once |
| changing who plays a match | the players are fixed by `createMatch`; nothing edits them |

Who reaches a lobby is its organization's business: members, admins, guests
and the owner. Anyone who reaches it may open it and play; the lobby's events
go to everyone in it, a match's events to its two players.

What remains, as before: a player who never answers, or never reveals, stalls
the match. There is no clock in the contract to forfeit them on.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/battleships/logic/Cargo.toml` | the rules (`crates/rules`: fleet validation, the commitment vector shared with the client, the audit), v1's lobby and game `TestHost` tests method for method (matches, players, stats, history, commits, shots, answers, sinking a fleet, a lie caught at the reveal, a void match, the impossible-misses rule), the method checks that replace v1's forged-row tests, events, access and wire checks, and every `scenarios/*.json`, on core's wasmtime engine | no |
| `pnpm -F battleships test` | the board helpers and the commitment vector; the generated client has exactly the committed ABI's methods, sent as calls or views with its parameter names, and syncs the session after each; the adapter back to the screens' shapes; event parsing; sign-up, lobbies, invitations, names, a challenge and the placement grid (mocked client) | no |
| `pnpm merod-local e2e battleships` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node | yes |

`match-lifecycle.json` is v1's two-node Docker workflow (`logic/workflows/e2e.yml`) with two accounts
instead of two nodes: both open the lobby, a refused self-challenge and an
unregistered opponent, a match, both fleets committed (a second commitment
refused), shots out of turn and by a bystander refused, Alice sinking Bob's
fleet with every answer given by the defender, a reveal with the wrong salt
refused, both boards revealed, the winner, stats and history read back.
`access.json` adds what that workflow could not express: anonymous callers and
accounts outside the org refused, a guest playing, a bystander refused,
typed errors with their fields.

## What changed in the port, and why

The same methods (in camelCase), the same arguments where a lobby still has
them, the same answers and events, with these differences a client sees:

| | v1 (`calimero-sdk`, wasmer, two services) | now (component SDK, one app instance) | why |
|---|---|---|---|
| transport | JSON-RPC `execute` on your own node, a context id per service | `POST /apps/{app}/intents` (calls) and `/views` (reads) on any node of the cluster, an app id | one app per replicated log |
| services | `lobby` (one context per namespace) + `game` (one context per match, `init(player1, player2, player2_account, lobby_context_id, match_id)`) | one contract; a lobby is an app instance in an org, a match is rows in it | the component runtime runs one component per bundle, and one instance needs no cross-context call |
| `set_match_context_id` | linked a match to its game context (Pending → Active) | **removed** (`UnknownMethod`) | there is no game context; `createMatch` starts the match |
| `on_match_finished` (`#[app::xcall(from_same_app)]`) | the game context reported the result to the lobby | **removed**; `revealBoard` records the result when the audit decides | the match is in the lobby's instance. (Component xcall, core#4816/#4820, landed after `1.0.0-rc.7`, the pinned tag, and is not in it.) |
| `get_current_turn`, `get_winner` | no arguments (per game context) | take `matchId` | one instance holds every match |
| `get_active_match_id` | the match the game context was created for | the caller's newest match not over yet (being played or awaiting a reveal), or `null` | no per-match context |
| identities | a player is a context member's device key; `register_player` paired account → key; `player2_account` was a separate account | a player is an **account**; `registerPlayer` returns the caller's account and puts it on the roster; `getPlayers` answers `{account, player}` with both the account; `player2_account` equals `player2` | identity is an account (passkeys); there are no context identities |
| match ids | `{player1 key}-{ms}-{nonce}` | `{player1 account}-{ms}-{nonce}` | the same |
| `MatchSummary.context_id` | the linked game context | **removed** | no game context |
| `MatchSummary.status` | `Pending` until the game context was linked, `Active`, `Finished` once a counting result exists | `Pending` until both fleets are committed, `Active`, `Finished` once the audited result is recorded | nothing to link; a void match stays `Active`, as before |
| `createMatch` | opponent must have registered a key, exactly once | opponent must have opened the lobby and still be in its org | no key pairing to disambiguate |
| method names | `create_match`, `get_match_state`, … | `createMatch`, `getMatchState`, … | the ABI names methods in camelCase |
| argument names | `match_id`, `shot_id`, `board_bytes` | `matchId`, `shotId`, `boardBytes` (unknown keys are `BadArgs`) | the same |
| `revealBoard` bytes | `board_bytes` and `salt` as arrays of numbers (`salt` a `[u8; 16]`) | base64url strings; a salt that is not 16 bytes is `Invalid` | `Vec<u8>` travels as base64url (D20) |
| `u64` result fields | numbers (`created_ms`, `finished_ms`, `wins`, `losses`, `games_played`) | decimal strings (the frontend converts them back in `src/battleships.ts`) | D20 |
| result field names | snake_case | unchanged (snake_case) | |
| errors | `GameError` as `{ kind, data }` strings | typed codes: `NotFound{matchId}`, `Invalid{message}`, `Forbidden{message}`, `Finished`, `MatchIdCollision`, `AlreadyCommitted`, `CommitmentMismatch` (`422 APP_ERROR`) | `#[app::error]`; v1's never-raised `AuditFailed` and `BoardNotFound` kinds are gone |
| equivocation | a second, different commitment, shot or answer filed around the contract ended the match against its author (`ended_by: "equivocation"`) | impossible: the call is refused (`AlreadyCommitted`, `Invalid: no pending shot`), so `ended_by` is `sunk` or `impossible_misses` | every write runs the contract |
| a refused reveal | emitted `AuditFailed { reason: "commitment_mismatch" }`, then failed | fails with `CommitmentMismatch` and emits nothing | a failed call applies nothing, events included |
| `Winner` / `MatchEnded` | emitted on every reveal after the decision, and every node could report the result | emitted once, by the call that decides the match; the result is counted once | one log |
| stats | derived on every read from the reported results | counters kept with the result | only the contract writes them |
| events | lobby events on the lobby context, match events on the game context | one event stream per lobby: `MatchCreated`, `MatchListUpdated` (now also when a fleet is committed), `PlayersUpdated`, `PlayerStatsUpdated` to everyone the lobby reaches; a match's events (with its `id`) to its two players. `MatchIdCollision` (never emitted) is gone | `Audience` |
| access | anyone in the namespace's contexts | the lobby org's members, admins, guests and owner; anonymous `401`, outsiders `404`; a match's views (`getShots`, `getIncomingShots`, `getMatchState`) to its players only, as before | the node's access gate |
| frontend | node login / Calimero account through a relay, namespaces, contexts, namespace invitations, names via `@calimero-apps/names`, the desktop SSO hand-off | passkey sign-in or sign-up (no node to pick: the build sets the target), lobbies as app instances in orgs, org invite links (`?invite=&org=&lobby=&from=`, a passkey step-up; kept in `@calimero-apps/connect`'s invite store and redeemed only on **Join**), names as org member metadata | `@calimero-apps/connect` |

No migrations existed in v1 and the component SDK has none, so v1 lobby and
game state does not carry over: lobbies are created anew.

### Removed

- **Contract**: `crates/game` and `crates/types` (the pure modules moved into
  `crates/rules`; the game contract into `src/lib.rs`), `src/events.rs`,
  `crates/game/build.sh`, `res/state-schema.json` and the game service's ABI,
  `logic/workflows/` (the v1 Docker workflows), v1's `calimero-sdk`/`calimero-storage`.
- **Frontend**: the abi-codegen `src/generated/` clients, `features/kv`, the
  namespace bootstrap, join-sync and stream-reconnect hooks, the invitation
  codec, `InvitationPrompt`, `knownPlayers`, `lobbyName`, `redeemLobby`,
  `contractError` (replaced by `messageOf` in `src/battleships.ts`), the
  landing `loginPopup.tsx` (pruned by `pnpm landing:generate`), the Playwright
  `e2e/` suites and configs, and mero-react / mero-platform / names / abi-codegen
  / e2e-node / Playwright / bs58 / fflate.
- **Elsewhere**: `architecture/` (the v1 two-service architecture page),
  `apps/battleships/package.json` and `scripts/` (v1-era wasm sync to
  local node data dirs), and the app's entry in the v1 workflow-coverage baseline
  (`scripts/`).

## The generated client

```bash
scripts/install-meroctl.sh            # once, from the repo root: meroctl at its pinned release
pnpm -F battleships codegen           # logic/res/abi.json -> app/src/generated/
```

`useBattleshipsLobby` builds the lobby's `BattleshipsClient` (`lobby()` in
`src/battleships.ts`: `new BattleshipsClient(client, appId, { after })`, where
`after` syncs the stored session, over a transport that notes the log index of
each answer, where the event stream resumes). The screens call its methods with
the contract's camelCase arguments (`matchId`, `shotId`, and the reveal's bytes
as base64url through `base64url`). The generated client types every answer
(`ShotsView`'s `shots`, a JSON array of bytes, is `#[abi(plain)]`), and
`src/battleships.ts`'s `to*` functions convert the u64 decimal strings to the
numbers the screens use, where they are read. The directory is committed and CI regenerates
it and fails when it is stale (see
[docs/COMPONENT-APPS.md, "The app's typed client"](../../docs/COMPONENT-APPS.md#the-apps-typed-client)).

## Production

`pnpm -F battleships build` with `VITE_CALIMERO_CLUSTER` and
`VITE_CALIMERO_MIN_RELEASE` set (see `app/.env.example`), then
`meroctl app pack apps/battleships/logic --key <production key>` packs that build as the bundle's
frontend: a Cloud node serves it from the package's own origin, which is the
only origin it trusts passkey ceremonies from. Instances are created from the
package `com.calimero.battleships`.

## License

See [LICENSE](LICENSE).
