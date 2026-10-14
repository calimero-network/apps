# Mero Standup

Async standups and a decision log for a small team. Each member posts what they
did, what is next and what blocks them; the team records what it decided and
why. Everything lives in one Calimero context — the team — replicated between
the members' own nodes, and nobody outside the team can read it.

It is deliberately small. Read it after [kv-store](../kv-store): a handful of
collections, each picked from the storage tiers in
[the trust model](../mero-chess/docs/trust-model.md) for what it has to hold, a
generated client, the fleet's shared login, desktop hand-off and invite
plumbing — and, since v2, a worked example of upgrading a live app's state.

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

## The contract in one table

| State | Tier | Why |
| --- | --- | --- |
| `updates: Authored<SortedMap<day, Update>>` | owned, editable | Keys are per owner, so every member has their OWN entry for each day. Posting is "write my entry for today"; nobody can touch anyone else's. The author is the owner stamp, never a field. |
| `decisions: WriteOnce<SortedMap<id, Decision>>` | owned, immutable | A decision is a record. Changing course is a NEW decision that supersedes the old one. |
| `profiles: UserStorage<Profile>` | one slot per account | A display name only its owner writes. |
| `team: LwwRegister<String>` (v2) | public | The team's name. Every member is equally entitled to rename it, and a wrong name is a nuisance, not a lie about anyone. |
| `helps: Authored<SortedMap<"day\|author", Help>>` (v2) | owned, editable | Each helper's own offer on one blocked update. Only the helper withdraws it; an offer on your own blocker is ignored on read. |
| `decision_notes: WriteOnce<SortedMap<id, DecisionNotes>>` (v2) | owned, immutable | Tags, people involved and origin day. Read only from the decision's own author (`get_by`), so nobody can retag someone else's decision. |

Two things are **derived on read, never stored**, because a stored copy is a
field someone could forge:

- **"Superseded by"**. A decision names what it replaces; the replaced one
  learns it from the log. A link only counts if it points at an OLDER decision,
  which keeps the links acyclic whatever a patched node writes, and the
  earliest valid replacement wins so every node names the same one.
- **"Blocked right now"**: each member's latest update, if it names a blocker.
  Post past a blocker and it drops off.

## v1 → v2

v2 only **adds** collections. A root migration cannot rewrite owned entries
(only their owners can re-sign them), so every v1 `Update`, `Decision` and
`Profile` keeps its exact layout: `#[derive(app::Migrate)]` carries the three
v1 collections through by name and creates the new ones empty. Decision notes
live beside decisions, not inside them, for the same reason.

[`logic/crates/v1`](logic/crates/v1) is the v1 contract frozen as it shipped,
and both migration tests start from it:

- `src/tests.rs` compiles it into the test module, writes a v1 team, migrates
  it in TestHost and checks every record reads, stays editable, and takes v2
  features. Its convergence check runs over the empty v1 state, because every
  v1 write stamps the wall clock, so two installs with data already differ
  before migrating (the test says so in full).
- `workflows/migrate-v1-v2.yml` does it for real: a two-node v1 team, an
  `upgrade_group` to the bundle this tree builds, both members at state
  version 2 with no residue, the v1 data on both nodes, then v2 on top.
  `build-multi-service-bundle.sh` (CI's fixture hook) builds the v1 bundle.

Day keys are the member's **local** `YYYY-MM-DD` — the contract cannot know a
time zone, so the browser decides what "today" is. Every read filters keys that
are not real dates, so junk written under a patched node's own stamp is inert.

### Methods

| Method | Does |
| --- | --- |
| `post_update(day, done, next, blockers)` | Write or rewrite the caller's update for a day |
| `clear_update(day)` | Withdraw it |
| `get_day(day)` | Everyone's update for a day |
| `list_days(before, limit)` | Days with updates, newest first, with counts |
| `current_blockers()` | Each member's latest update that names a blocker |
| `members()` | Everyone who posted or named themselves, with their latest day |
| `get_week(start)` | Seven days from `start`, for the strip and the digest |
| `offer_help(day, author, note)` / `withdraw_help(day, author)` | Offer, or take back, help on someone's blocker |
| `log_decision(title, decision, rationale, supersedes, tags, with, from_day)` | Record a decision, optionally replacing one |
| `get_decision(id)` / `list_decisions(search, tag, from_day, standing_only, cursor, limit)` / `tags()` | Read the log |
| `set_team_name(name)` / `team_name()` | The team's name |
| `set_name(name)` / `get_name(account)` / `whoami()` | Names and identity |

## Run it

```bash
cargo test -p mero-standup                         # contract tests, no node
cargo mero bundle --manifest-path apps/mero-standup/logic/Cargo.toml \
  --dev --app-version 0.0.0 \
  --output apps/mero-standup/logic/dist/com.calimero.mero-standup.mpk
pnpm -F mero-standup codegen                       # ABI -> src/generated
pnpm -F mero-standup dev                           # http://localhost:5197

pnpm -F mero-standup test                          # unit tests
pnpm -F mero-standup test:e2e                      # Playwright against a real merod
cd apps/mero-standup/logic && merobox bootstrap run workflows/e2e.yml   # two nodes
./build-multi-service-bundle.sh && merobox bootstrap run workflows/migrate-v1-v2.yml
```

Install the bundle on your node, open the app, connect, and press **Start a new
team**. Invite teammates from the **Invite** tab.

## Layout

```
logic/src/lib.rs            the contract (v2) and its migration from v1
logic/src/tests.rs          TestHost tests: two people, two devices, forged rows, v1 -> v2
logic/crates/v1/            v1, frozen as shipped: the migration's starting point
logic/workflows/e2e.yml     merobox: two nodes, every method, convergence
logic/workflows/migrate-v1-v2.yml   merobox: upgrade a live two-node v1 team
app/src/StandupBoard.tsx    week strip, your update (carried forward), the team, help, sidebar
app/src/WeekDigest.tsx      a week per person, copy as Markdown
app/src/DecisionLog.tsx     log, supersede, tags, people, timeline
app/src/App.tsx             top bar, team name, account menu, first run, tabs
app/src/lib/                pure, unit-tested: days, carry-forward, digest, rich text, tags
app/src/useTeam.ts          the generated client + re-read on sync events
app/src/{ContextPicker,InviteCard,JoinCard,useJoinFromInvitation}.tsx, utils/
                            login, team selection and invites, from kv-store
app/e2e/                    Playwright against a native merod
```

The frontend is not deployed yet: `frontend` in `logic/Cargo.toml` names
`https://mero-standup.vercel.app`, which needs a Vercel project with Root
Directory `apps/mero-standup/app` (see [docs/VERCEL.md](../../docs/VERCEL.md)).
Until then, invite links work when pasted into the app.
