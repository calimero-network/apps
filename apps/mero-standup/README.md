# Mero Standup

Async standups and a decision log for a small team. Each member posts what they
did, what is next and what blocks them; the team records what it decided and
why. A team is one app instance in an organization of its own, and only that
organization's members reach it.

It is deliberately small. Read it after [kv-store](../kv-store): a component
app (Calimero 1.0) on core's component SDK (`calimero-sdk`, `wasm32-wasip2`),
developed on `merod local`, with a frontend on mero-js `CalimeroClient` that
talks to the local nodes in development and to Calimero Cloud in production
([docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md)).

What using it looks like:

- **Your update starts from yesterday's.** What you said was next becomes
  today's "done", your blocker carries over, and Cmd/Ctrl+Enter posts.
- **The team at a glance.** A week strip with a dot per day (red when someone
  was blocked), who has not posted yet, and what is blocking people right now.
- **Help on a blocker.** "I can help", with an optional note, on anyone's
  blocker; it shows wherever that blocker does.
- **A week digest** per person, copyable as Markdown for a weekly report.
- **Decisions with context**: tags, who was involved, the standup day they came
  out of, a tag filter and a timeline. Never edited, only superseded.
- Named teams, a first-run name prompt, avatars, light and dark themes.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (docs/COMPONENT-APPS.md), then:
pnpm dev:local mero-standup        # merod local + build + deploy + Vite on http://localhost:5173/
```

Sign up with a passkey, press **Start a new team**, and invite teammates from
the team's **Invite** tab (a second browser profile works as a teammate).

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/mero-standup/logic/Cargo.toml          # TestApp harness + scenarios
cargo run --release --manifest-path $M -- build apps/mero-standup/logic # res/mero_standup.wasm + res/abi.json
pnpm merod-local e2e mero-standup                                      # the scenarios on merod local
pnpm -F mero-standup lint typecheck test build                         # the frontend
```

- `logic/tests/harness.rs`: every method on core's real wasmtime engine, v1's
  `TestHost` tests method for method, the storage-tier ("forged row") tests as
  the method checks that replace them, and the access and wire checks.
- `logic/scenarios/standup.json`: the old two-node merobox workflow as neutral
  steps (owner, `bob`, `carol`), run by `cargo test` and on `merod local`.
- `logic/scenarios/access.json`: what merobox could not express: a guest, an
  outsider, an anonymous caller, and members trying to write someone else's
  update, help offer or name.
- `app/src/client.test.ts` checks the generated client (`MeroStandupClient`)
  against the committed `logic/res/abi.json`: exactly its methods, each sent as
  a call or a view with its parameter names, the session synced after each;
  `app/src/standup.test.ts` checks the decoding to the screens' shapes, and
  `app/src/App.test.tsx` drives the screens with a mocked client.

## The contract

v1 kept its write rules in storage tiers every node checked when it applied a
peer's delta. A component app runs on its cluster's leader, which applies every
write in one log, so each rule is now a check in the method against
`env::caller()`, and every record names its author in a field the method fills
from the caller, never from an argument.

| v1 (`calimero-sdk` / `calimero-storage`) | now (`calimero-sdk`) | the rule |
| --- | --- | --- |
| `updates: Authored<SortedMap<day, Update>>` | `updates: Table<Update>`, key `(day, author)`, indexes `byDay`, `byAuthor (author, day)`, counts `perDay`, `blocked (day, isBlocked)` | `postUpdate` / `clearUpdate` only touch `(day, caller)` |
| (scan of every update) | `days: Set<String>` | days with an update, for `listDays` |
| (owners of updates + profiles) | `people: Set<String>` | who posted or named themselves, for `members` |
| `decisions: WriteOnce<SortedMap<id, Decision>>` | `decisions: Table<Decision>`, indexes `feed (createdAt)`, `byDay (fromDay, createdAt)` | inserted once by `logDecision`; no method changes or removes one |
| `decision_notes: WriteOnce<SortedMap<id, DecisionNotes>>` read with `get_by(author)` | `decisionNotes: UnorderedMap<id, DecisionNotes>` | written in the same `logDecision` call, never again |
| (tags inside the notes) | `decisionTags: Table<DecisionTag>` (index `tagFeed`, count `perTag`) + `tagNames: Set<String>` | the tag filter and `tags` without a scan |
| "superseded by", derived on read (older-only, earliest wins) | `replacedBy: UnorderedMap<old, new>` | written by `logDecision`, which refuses a second supersede (`AlreadySuperseded`) |
| `profiles: UserStorage<Profile>` | `profiles: PerUser<Profile>` | the caller's own slot only |
| `helps: Authored<SortedMap<"day\|author", Help>>` | `helps: Table<Help>`, key `(day, author, helper)`, index `onUpdate` | `withdrawHelp` only removes `(.., caller)` |
| `team: LwwRegister<String>` | `team: Cell<String>` | any member may rename the team, as before |

Access: the organization decides who reaches the team (its owner, admins,
members, and guests, as every member of a v1 context could write); an
outsider is refused `404 NOT_FOUND` and an anonymous caller `401
UNAUTHENTICATED` before the app runs.

### Methods

| Method | Kind | Does |
| --- | --- | --- |
| `postUpdate(day, done, next, blockers)` | call | Write or rewrite the caller's update for a day |
| `clearUpdate(day)` | call | Withdraw it |
| `getDay(day)` | view | Everyone's update for a day |
| `listDays(before, limit)` | view | Days with updates, newest first, with counts |
| `currentBlockers()` | view | Each member's latest update that names a blocker |
| `members()` | view | Everyone who posted or named themselves, with their latest day |
| `getWeek(start)` | view | Seven days from `start`, for the strip and the digest |
| `offerHelp(day, author, note)` / `withdrawHelp(day, author)` | call | Offer, or take back, help on someone's blocker |
| `logDecision(title, decision, rationale, supersedes, tags, with, fromDay)` | call | Record a decision, optionally replacing one |
| `getDecision(id)` / `listDecisions(search, tag, fromDay, standingOnly, cursor, limit)` / `tags()` | view | Read the log |
| `setTeamName(name)` / `teamName()` | call / view | The team's name |
| `setName(name)` / `getName(account)` / `whoami()` | call / view / view | Names and identity |

Events (to everyone the app reaches): `UpdatePosted { day, account }`,
`UpdateCleared { day, account }`, `DecisionLogged { id }`, `ProfileSet { account }`,
`TeamRenamed { name }`, `HelpOffered { day, author }`, `HelpWithdrawn { day, author }`.

Day keys are the member's **local** `YYYY-MM-DD`: the contract cannot know a
time zone, so the browser decides what "today" is. Every day is checked on
write, so no key that is not a real date is stored.

## What changed in the port

Everything a client sees differently from the v1 contract:

| | v1 | now | why |
| --- | --- | --- | --- |
| method names | `post_update`, `get_day`, … | `postUpdate`, `getDay`, … | ABI names are camelCase |
| argument names | `from_day`, `standing_only` | `fromDay`, `standingOnly` | arguments are camelCase; unknown keys are refused (`BadArgs`) |
| result fields | `author_name`, `created_at`, `next_cursor`, `superseded_by`, `last_day`, `from_day` | `authorName`, `createdAt`, `nextCursor`, `supersededBy`, `lastDay`, `fromDay` | the component's JSON convention |
| timestamps (`createdAt`, `editedAt`, a helper's `at`) | JSON numbers | decimal strings (`"1700000000000"`) | 64-bit integers travel as strings (D20) |
| views | every `&self` method, callable as a call | `#[app::view]`: answered by a node without a log entry | a write is never a view (`NotAView`) |
| errors | `AppError::msg("…")` strings | typed: `NotADate { day }`, `TooLong { field, limit }`, `Empty { field }`, `TooMany { field, limit }`, `NoUpdate { day }`, `NoSuchUpdate { day, author }`, `NoBlocker { day, author }`, `OwnBlocker`, `NoHelp { day, author }`, `NoSuchDecision { id }`, `AlreadySuperseded { id, by }` | `422 APP_ERROR` with `{ code, fields }` |
| caller | an identity key (`env::account_id`), 64 hex | the account (`env::caller()`) | accounts are passkey accounts on the cluster |
| `clearUpdate` | marked the entry `cleared` and kept it | removes the row | the author check is in the method, so nothing is gained by keeping a tombstone; posting again starts a fresh `createdAt`, as v1 did |
| superseding | link checked on read ("older only", earliest valid wins) | checked on write: the target must exist and still stand | one log orders writes, so the first supersede the leader applies is the one that stands |
| `with` | each entry parsed as an `AccountId` (64 hex) | trimmed, blanks dropped, at most 256 bytes each | accounts are opaque strings on the cluster |
| `offerHelp` `author` | parsed as an `AccountId` | any string; an update has to exist at `(day, author)` | as above |
| `members` order | by `AccountId` bytes | by account string | |
| `listDecisions` | a full scan, then filters | a tag or day filter reads only that index slice; search / standing-only read on through the log | indexes |
| `Migrated` event, `init` returning state | v1 → v2 migration | gone | no in-place migration onto the component runtime (`#[app::migrate]` is not in the SDK yet), and a component team starts empty: there is no v1 state on a 1.0 cluster to carry |

The frontend keeps every screen; what changed underneath:

- mero-react's `MeroProvider` / `ConnectButton`, node login, the context picker,
  namespace invitations (`?invitation=` payloads, links.calimero.network deep
  links, `InvitationDialog`), desktop SSO hand-off and node-served routing are
  replaced by `@calimero-apps/connect` (`session.ts`): passkey sign-in or
  sign-up, a stored session per target, `CalimeroClient` on merod local in dev
  and on a Cloud cluster in production.
- A team is an app instance created in a new organization (`createOrg`, then
  `createApp(name, source, { org })`, then `setTeamName`); the team list is
  `listApps` by the dev bundle (dev) or the package (production).
- Invites are org invites: `client.invite(org, "member", passkey)` (a passkey
  step-up), shared as `?invite=<token>`, kept across sign-up and redeemed once a
  session exists. The pending invite is `@calimero-apps/connect`'s shared store
  (`createInviteStore`, captured in `main.tsx`): joining, or being in the org
  already, opens that org's team, and signing out drops the invite.
- v1's abi-codegen `StandupClient` is now core's `MeroStandupClient`
  (`src/generated/client.ts`: `mero-app-build codegen` from
  `logic/res/abi.json`, committed; `pnpm -F mero-standup codegen` after a
  contract change, and CI fails when it is stale). The ABI names its records
  without their shapes, so the generated types are `unknown`: each read passes
  its answer through a `decode*` in `standup.ts`, which keeps the screens'
  shapes (snake_case, numeric timestamps).
- Live updates come from `client.events(app)` (coalesced), with the 30 s poll as
  before.
- No namespace-wide names: v1 fell back to the name a person set for the whole
  namespace (`@calimero-apps/names`). An org has no shared name directory yet,
  so a person's name on a team is the one they set there.

## Removed

- `logic/crates/v1`, `logic/build-multi-service-bundle.sh`,
  `logic/workflows/{e2e,migrate-v1-v2}.yml` (merobox), `logic/src/tests.rs`
  (TestHost and the v1 → v2 migration tests), `logic/res/state-schema.json`.
- `app/e2e/` and the Playwright configs (they drove a native merod 0.x),
  `app/src/generated/`, `ContextPicker`, `useJoinFromInvitation`,
  `utils/invitation.ts`, `utils/desktopSso.ts` and their tests.
- Dependencies: mero-react, mero-platform(-react), node-served, names, bs58,
  fflate, abi-codegen, e2e-node, Playwright.

## Production

The production frontend is the one packed into the bundle (`frontend-dir`),
served by the cluster from the package's own origin, because a Cloud node
trusts passkey ceremonies only from frontends it serves. Build it with
`VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (see
`app/.env.example`); a production build without them refuses to start.

## Mobile

The native apps (`mobile/`, SwiftUI and Compose) move to Calimero 1.0 in
#688, which calls this contract's component ABI (the camelCase methods,
arguments and results above) and merges after this port. This port leaves
`mobile/` as it is on `main`.

## Layout

```
logic/src/lib.rs            the contract
logic/tests/harness.rs      TestApp: every method, the write rules, access and wire checks
logic/tests/scenarios.rs    every scenarios/*.json in the harness
logic/scenarios/            standup.json (from the merobox workflow), access.json
logic/res/abi.json          the component's ABI, committed, diffed in CI
app/src/session.ts          target -> client -> passkey session (from kv-store)
app/src/teams.ts            teams (app instances in their own org), invites
app/src/generated/          MeroStandupClient, generated from logic/res/abi.json (committed)
app/src/standup.ts          the screens' shapes and the decoding to them
app/src/useTeam.ts          the generated client for one team + re-read on events
app/src/StandupBoard.tsx    week strip, your update (carried forward), the team, help, sidebar
app/src/WeekDigest.tsx      a week per person, copy as Markdown
app/src/DecisionLog.tsx     log, supersede, tags, people, timeline
app/src/App.tsx             sign-in, team picker, top bar, team name, account menu, tabs
app/src/lib/                pure, unit-tested: days, carry-forward, digest, rich text, tags
mobile/                     native clients (moved to 1.0 in #688)
```
