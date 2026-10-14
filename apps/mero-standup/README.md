# Mero Standup

Async standups and a decision log for a small team. Each member posts what they
did, what is next and what blocks them; the team records what it decided and
why. Everything lives in one Calimero context — the team — replicated between
the members' own nodes, and nobody outside the team can read it.

It is deliberately small. Read it after [kv-store](../kv-store): three
collections, each picked from the storage tiers in
[the trust model](../mero-chess/docs/trust-model.md) for what it has to hold, a
generated client, and the fleet's shared login, desktop hand-off and invite
plumbing.

## The contract in one table

| State | Tier | Why |
| --- | --- | --- |
| `updates: Authored<SortedMap<day, Update>>` | owned, editable | Keys are per owner, so every member has their OWN entry for each day. Posting is "write my entry for today"; nobody can touch anyone else's. The author is the owner stamp, never a field. |
| `decisions: WriteOnce<SortedMap<id, Decision>>` | owned, immutable | A decision is a record. Changing course is a NEW decision that supersedes the old one. |
| `profiles: UserStorage<Profile>` | one slot per account | A display name only its owner writes. |

Two things are **derived on read, never stored**, because a stored copy is a
field someone could forge:

- **"Superseded by"**. A decision names what it replaces; the replaced one
  learns it from the log. A link only counts if it points at an OLDER decision,
  which keeps the links acyclic whatever a patched node writes, and the
  earliest valid replacement wins so every node names the same one.
- **"Blocked right now"**: each member's latest update, if it names a blocker.
  Post past a blocker and it drops off.

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
| `log_decision(title, decision, rationale, supersedes)` | Record a decision, optionally replacing one |
| `get_decision(id)` / `list_decisions(search, standing_only, cursor, limit)` | Read the log |
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
```

Install the bundle on your node, open the app, connect, and press **Start a new
team**. Invite teammates from the **Invite** tab.

## Layout

```
logic/src/lib.rs            the contract
logic/src/tests.rs          TestHost tests: two people, one person's two devices, forged rows
logic/workflows/e2e.yml     merobox: two nodes, every method, convergence
app/src/StandupBoard.tsx    today, the team, who has not posted, blockers
app/src/DecisionLog.tsx     log, supersede, search
app/src/useTeam.ts          the generated client + re-read on sync events
app/src/{ContextPicker,InviteCard,JoinCard,useJoinFromInvitation}.tsx, utils/
                            login, team selection and invites, from kv-store
app/e2e/                    Playwright against a native merod
```

The frontend is not deployed yet: `frontend` in `logic/Cargo.toml` names
`https://mero-standup.vercel.app`, which needs a Vercel project with Root
Directory `apps/mero-standup/app` (see [docs/VERCEL.md](../../docs/VERCEL.md)).
Until then, invite links work when pasted into the app.
