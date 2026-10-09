# Hyperfeed

**One feed for your agent and your apps.** Everything an AI agent did on your behalf, with where it
acted, why, and which warrant carried it, sits beside every notification the apps it uses sent you.
From the same feed you approve what the agent proposes, undo what it did, and set what it may do in
each app.

> **Status: prototype.** The contract, the rules and the screens are real and tested. The agent side
> is not: no agent in this repo records to a feed yet, so on a node the feed fills with
> notifications only until one does (see [Connecting an agent](#connecting-an-agent)). `/demo` shows
> the whole loop with no node.

| | |
| --- | --- |
| Package | `com.calimero.hyperfeed` |
| Contract | [`logic/src/lib.rs`](logic/src/lib.rs), with 19 `TestHost` tests in [`logic/src/tests.rs`](logic/src/tests.rs) |
| Two-node scenario | [`logic/workflows/feed.yml`](logic/workflows/feed.yml): every contract method on real nodes, the feed converging on a second node, and that node refused every write |
| Frontend | [`app/`](app): Vite, React and mero-react. `/` runs against your node and `/demo` runs in memory |

## Why it needs a contract of its own

When an agent acts for you in a Calimero app, it signs a **warrant** and a relay executes the call
*as your account*. The target app sees you. Core stores the delegation with the delta, but nothing
exposes a readable history of those calls: no admin route lists them, and live events carry no
author or executor. So nothing, anywhere, answers "what did my agent do today?"

Hyperfeed answers it with a context that is yours alone. The agent writes to it as you, through the
same warrant path it uses everywhere else.

## What is stored

| Row | Written by | Holds |
| --- | --- | --- |
| **Action** | your agent | app, source context, method, guard category, title, why, the warrant's intent hash, the executing relay, status, and a *breach* note when the rules say it should have asked |
| **Notification** | your client | app, source context, sender, title, event kind, and whether it needs you. It is keyed `<context>:<root hash>:<index>`, so each of your devices records the same event once |
| **Policy** | you | per app: the agent mode (`act` / `ask` / `read` / `off`) and notification routing (`push` / `feed` / `mute`) |
| **Guard** | you | "always ask me before…" for `sign`, `money`, `new_contact` and `delete` (on by default), and `invite` and `secret` (off by default) |
| **Pause** | you | while paused, every write the agent wants to make becomes a proposal |

Every record merges deterministically:

- An action's content is written once. Its status is last-writer-wins, with ties broken on the bytes.
- "Reviewed" and "seen" only ever turn on.
- Policies and guards are last-writer-wins.

## The rules the contract applies

The agent calls `check_action(app_key, category, writes)` before it acts. It then calls
`record_action` either with a **proposal** or with an **outcome**. The same verdict governs both:

| Situation | Verdict |
| --- | --- |
| app mode `off` | refuse |
| a read (`writes: false`) | act |
| app mode `read`, and the action writes | refuse |
| agent paused | ask |
| the category's guard is on | ask |
| app mode `ask`, or an app with no policy | ask |
| app mode `act` | act |

- **A proposal the rules refuse is an error,** so the agent learns before it acts.
- **An outcome the rules say needed you is still recorded,** flagged with a breach, and it stays in
  "Needs you" until you keep it or undo it. Refusing it would hide the one row you most need to see.

Status transitions (`resolve_action` is yours, and `complete_action` is the agent reporting back):

```
pending ──approve──▶ approved ──complete(done)──▶ done ──undo──▶ undo_requested ──complete(done)──▶ undone
   │                    └──complete(failed)──▶ failed ──approve (retry)──▶ retrying ──▶ done | failed
   └──decline──▶ declined                         └──decline──▶ declined
```

Approving does not perform anything. The agent watches the feed for `ActionChanged`, signs the
warrant for the real call, and reports the result with `complete_action`.

## Notifications: the collector

On a node, the open app lists every context the node is in and subscribes to each one's event
stream. It decodes each `StateMutation` event and records it in the feed:

- A few well-known kinds get a sentence and the "needs you" flag: `MessageSent`, `IssueAssigned`,
  `QuestionAsked` and others, listed in [`app/src/collector.ts`](app/src/collector.ts).
- Any other kind is filed under its own name.
- Bookkeeping events (reads, reactions, presence) are skipped.
- The app key comes from the installed package (`com.calimero.mero-chat` becomes `chat`).

The collector only runs while the app is open somewhere. Events that arrive while no client is
connected are never replayed, so they never reach the feed.

## Connecting an agent

The agent needs the feed's context id. **Controls → Connect your agent** shows it. Then:

1. Call `check_action` before any write elsewhere. On `ask`, call `record_action` with
   `outcome: "proposed"` and wait for `ActionChanged`.
2. After acting, call `record_action` with `outcome: "done"` or `"failed"`. Include the warrant's
   `intent_hash` and the relay's `executor`.
3. When you approve, retry or ask for an undo, do it, then report with `complete_action`.

## Trust model, honestly

- **Owner-only writes bind honest nodes only.** `require_owner` runs inside the contract, and a
  peer's node folds deltas without executing it. A feed is meant to have one member, you on your
  devices, so there is no other writer to defend against. Merge-time enforcement (a writer set of
  one) is the step to take before a feed is ever shared.
- **The contract cannot tell your agent from you.** Both act as your account. Approvals therefore
  record *your decision*; the hard boundary is the agent itself, which must not sign a warrant for
  something waiting on you. Telling them apart needs either a separate agent account or core
  exposing the delegating device to the contract.
- **Notifications are best-effort.** Core events carry no author and no "concerns you" bit, so the
  "needs you" flag is a guess for every kind outside the known list.

## Running it

```bash
cargo test -p hyperfeed
cargo mero bundle --manifest-path apps/hyperfeed/logic/Cargo.toml --dev --app-version 0.0.0 --output dist/com.calimero.hyperfeed.mpk
pnpm -F hyperfeed codegen   # after any contract change
pnpm -F hyperfeed dev       # http://localhost:5195, or /demo with no node
pnpm -F hyperfeed test
```

## Not done yet

- A reference agent (an MCP server, as `mero-issue-tracker` has) that records through the warrant path.
- A Vercel project. `frontend = "https://hyperfeed.vercel.app"` resolves to nothing until it exists.
- Push delivery for apps set to "Feed + push". The setting is stored, but nothing sends a push yet.
- Paging past the first 50 rows. The contract returns `next_before`, but the UI does not ask for the next page.
- Landing page, and the browser e2e suites other apps carry.
