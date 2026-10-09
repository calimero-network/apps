# Hyperfeed

**One feed for your agent and your apps.** Everything an AI agent did on your behalf, with where it
acted, why, and which warrant carried it, sits beside every notification the apps it uses sent you.
From the same feed you approve what the agent proposes, undo what it did, and set what it may do in
each app.

> **Status: prototype.** The contract, its API and the app work against a real `merod`
> (0.11.0-rc.83): sign-in, creating the feed, the collector, approvals and controls were driven in a
> browser while a client called the API over JSON-RPC, as an agent will. No agent ships with it:
> the agent kit (an MCP server) is built separately against the [API](#api-for-agents) below. `/demo`
> shows the whole loop with no node.

| | |
| --- | --- |
| Package | `com.calimero.hyperfeed` |
| Contract | [`logic/src/lib.rs`](logic/src/lib.rs), with 20 `TestHost` tests in [`logic/src/tests.rs`](logic/src/tests.rs) |
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
| **Notification** | your client | app, source context, sender, title, event kind, and whether it needs you. Keyed by the state transition that produced it, so each of your devices records the same event once (see [the collector](#notifications-the-collector)) |
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
- Any other kind is filed under its own name, with its simple fields as the body
  (`key: launch-date · value: Oct 28`).
- The app key comes from the installed package (`com.calimero.mero-chat` becomes `chat`).

**Recording each event once.** Core's event carries no delta id, only the context's new root hash,
and that hash depends only on the state's contents. So the key is the transition,
`<context>:<previous root>><new root>:<index>`, which every device watching the context sees
identically. On top of that, the contract treats a key seen again more than
`DEDUPE_WINDOW_MS` (10 s) after its last record as a new occurrence (`<key>#1`, `<key>#2`, …), and a
repeat inside the window as another device's report of the same event. Two edges remain:

- A context that oscillates through the same two states (A, B, A, B, A …) within 10 s records the
  repeat once.
- A device's first event per context has no previous root, so a device that connects mid-stream
  can record that one event twice.

Both disappear if core adds a delta id to `StateMutation`.

The collector only runs while the app is open somewhere. Events that arrive while no client is
connected are never replayed, so they never reach the feed.

## API for agents

Everything an agent kit needs is a method on the feed's context, called with one JSON-RPC
`execute`, the same way `mero-issue-tracker`'s MCP server calls its contract:

```bash
curl -s -X POST "$NODE/jsonrpc" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "execute",
  "params": { "contextId": "<feed context>", "method": "check_action",
              "argsJson": { "app_key": "sign", "category": "sign", "writes": true } } }'
# → {"jsonrpc":"2.0","id":1,"result":{"output":{"decision":"ask","reason":"\"sign\" always needs you"}}}
```

The result is under `result.output`. A refusal is a JSON-RPC error of type `FunctionCallError`
whose message is the contract's sentence (`not allowed: your agent is off in crm`). The feed's
context id is under **Controls → Connect your agent**. Every write must come from the feed's owner
account (your node's own identity, or your account through a warrant); anything else is refused.

**The agent's methods**

| Method | Args | Returns |
| --- | --- | --- |
| `check_action` | `app_key: string, category: string, writes: bool` | `Verdict { decision: "act" \| "ask" \| "refuse", reason }` |
| `record_action` | `input: ActionInput` | `FeedItem`, the recorded row with its `id` |
| `complete_action` | `id: string, outcome: "done" \| "failed", note: string` | `FeedItem` |
| `item` | `id: string` | `FeedItem` or `null` |
| `feed` | `filter: "all" \| "agent" \| "notifications" \| "needs_you", app_key: string, limit: u32, before: u64` | `FeedPage { items, counts, apps, next_before }` |
| `settings` | none | `SettingsView { owner, paused, policies, guards }` |

`ActionInput`, every field required (use `""` when there is nothing to say):

| Field | Meaning |
| --- | --- |
| `app` | short app key (`chat`, `sign`, `crm`; lowercase letters, digits, `-`, `.`, ≤ 40 bytes) |
| `source_context`, `source_label` | where it acted: the context id and a name a person reads |
| `method` | the method it called there (required) |
| `category` | `""` or a guard: `sign`, `money`, `new_contact`, `delete`, `invite`, `secret` |
| `writes`, `undoable` | whether it changes state, and whether it can be reverted |
| `title`, `body`, `why` | the row's headline (required), detail, and the agent's reason |
| `outcome` | `proposed`, `done` or `failed` |
| `intent_hash`, `executor` | the warrant's `H(method ‖ args)` and the relay that ran it |
| `note` | what went wrong, for `failed` |

**The loop an agent runs**

1. `check_action` before any write elsewhere.
   - `act`: do it, then `record_action` with `outcome: "done"` (or `"failed"` and a `note`).
   - `ask`: `record_action` with `outcome: "proposed"`, then wait.
   - `refuse`: don't. Recording a proposal would be refused too.
2. Wait by subscribing to the feed context's events (SSE or WebSocket). `ActionChanged { id, status }`
   arrives when you decide: `approved` (do it), `retrying` (try the failed one again),
   `undo_requested` (revert it) or `declined` (drop it). Polling `item` works too.
3. Report with `complete_action(id, "done" | "failed", note)`. It is accepted only while the action is
   `approved`, `retrying` or `undo_requested`.

An outcome recorded where the rules said `ask` or `refuse` is still stored, with `breach` set, and
stays in "Needs you" until you keep it or undo it. Events the contract emits: `ActionRecorded`,
`ActionChanged`, `NotificationRecorded`, `NotificationsSeen`, `SettingsChanged`.

**The owner's methods**, which the app calls: `resolve_action(id, decision)` with `approve`,
`decline`, `undo` or `keep`; `set_policy(app_key, agent, notifications)`;
`set_guard(category, enabled)`; `set_paused(paused)`; `record_notification(input)`;
`mark_seen(ids)` and `mark_all_seen()`. An agent kit can call them too, since it writes as you, but
`resolve_action` is your decision and an agent should never call it for itself.

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

Against a real node, `merod init --auth-mode embedded --admin-user <name> --admin-password-file <path>`,
install the bundle (`meroctl app install --path dist/com.calimero.hyperfeed.mpk`), and open
`http://localhost:5195`. Connect finds the node on its default port, signs in on the node's own page,
and "Create my feed" makes the context. The two-node scenario runs without Docker too:
`merobox bootstrap run --no-docker apps/hyperfeed/logic/workflows/feed.yml`.

## Not done yet

- The agent kit (an MCP server), built separately against the [API](#api-for-agents).
- A Vercel project. `frontend = "https://hyperfeed.vercel.app"` resolves to nothing until it exists.
- Push delivery for apps set to "Feed + push". The setting is stored, but nothing sends a push yet.
- Paging past the first 50 rows. The contract returns `next_before`, but the UI does not ask for the next page.
- Landing page, and the browser e2e suites other apps carry.
