# Hyperfeed

**One feed for your agent and your apps.** Everything an AI agent did on your behalf, with where it
acted, why, and which warrant carried it, sits beside every notification the apps it uses sent you.
From the same feed you approve what the agent proposes, undo what it did, set what it may do in
each app, and talk to it about any of it.

> **Status: prototype.** The contract, its API and the app work against a real `merod`
> (0.11.0-rc.83): sign-in, creating the feed, the collector, approvals and controls were driven in a
> browser while a client called the API over JSON-RPC, as an agent will. No agent ships with it:
> the agent kit (an MCP server) is built separately against the [API](#api-for-agents) below. `/demo`
> shows the whole loop with no node.

| | |
| --- | --- |
| Package | `com.calimero.hyperfeed` |
| Contract | [`logic/src/lib.rs`](logic/src/lib.rs), with 50 `TestHost` tests in [`logic/src/tests.rs`](logic/src/tests.rs) |
| Two-node scenario | [`logic/workflows/feed.yml`](logic/workflows/feed.yml): every contract method on real nodes, the feed converging on a second node, and that node refused every write |
| Frontend | [`app/`](app): Vite, React and mero-react. `/` (feed), `/chat` and `/controls` run against your node; `/demo` runs the same pages in memory |

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
| **Action** | your agent | app, source context, method, guard category, title, why, the warrant's intent hash, the executing relay, its chain and ask, every status step, and a *breach* note when the rules say it should have asked |
| **Message** | you, or your agent | what you said to your agent about a chain (or about anything, which starts a chain of its own), and its answers. Yours steps `waiting → thinking → answered` (or `failed`); the agent's are `said`. Yours may carry up to four **images** (PNG, JPEG, WebP or GIF, 10 MB each): blobs on your node announced to the feed's context, of which the feed keeps only the id, name, type and size, beside the message by id |
| **Notification** | your client, or your agent | app, source context, sender, title, event kind, and whether it needs you. Keyed by the state transition that produced it, so each of your devices records the same event once (see [the collector](#notifications-the-collector)). A notification a lens made also carries its **item type**, the type's **fields**, and the **reply call** that answers it in its app, kept beside it by id |
| **Lens** | your agent proposes, you approve | for one app version: which of its events become feed items, of which type, and how your answer goes back. JSON, up to 32 kB; `proposed`, `approved` or `rejected` |
| **Policy** | you | per app: the agent mode (`act` / `ask` / `read` / `off`) and notification routing (`push` / `feed` / `mute`) |
| **Guard** | you | "always ask me before…" for `sign`, `money`, `new_contact` and `delete` (on by default), and `invite` and `secret` (off by default) |
| **Pause** | you | while paused, every write the agent wants to make becomes a proposal |
| **Archived** | you | per chain: put away, with the chain's latest activity then and an optional return time ("later"). It is out of the feed until something new happens in it or that time passes |
| **Presence** | your agent | per agent name: when it last reported in. The app shows "Agent live" for 90 seconds after a report |

Every record merges deterministically:

- A row's content is written once. Its history merges as a union of steps in one total order, so
  the last step is the current status on every device.
- "Reviewed" and "seen" only ever turn on.
- Policies, guards and archive decisions are last-writer-wins; presence keeps the latest report.

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

## Notifications: the collector and lenses

On a node, the open app lists every context the node is in and subscribes to each one's event
stream. Nearly every event an app emits is bookkeeping (a keystroke in a doc, a cursor, a
reaction), and your own node emits them for your own edits as well. So **nothing is recorded by
default**. An event becomes a notification only through a **lens** for its app version.

**A lens is learned, not written by hand.** When mero-bot meets an app version the feed has no lens
for, it starts a turn that reads the app's ABI (its events, its methods and their types) and writes
one. The lens is checked before you see it:

- every event and method it names exists;
- every read is a read-only call with the arguments the method takes;
- every path it reads (`page.messages[0].text`) is a field of the type the ABI says it reads;
- a reply is a mutating call that puts your answer in it.

It is then tried on the app's recent events. Only a lens that passes is proposed. In **Controls**,
under *What your feed reads from each app*, you see what each lens records, preview it on recent
events, and approve or turn it down. A new app version is learned again.

From then on every event runs through the approved lens with plain code (`app/src/lens/`): no model
call per event, and the same result on every device. A lens is data, not code. Its expressions can
read paths, compare, join strings and call a handful of functions (`has(list, me)`, `mine(id)`,
`plain(html)`); they cannot write, loop or reach anything but the values they are given.

**Item types.** A lens makes each event it keeps one of nine feed item types, each with its own card:
`message`, `assignment`, `poll`, `invite`, `turn`, `request`, `change`, `status` and `other`.
Their fields are fixed (`lens/lens.ts`, `ITEM_TYPES`). An identity field is shown as the person's
name from the namespace's member list, the name Chat shows too.

**Answers go straight to the app.** A lens can give a reply call, such as Chat's `send_message`
with your text. When you answer such a row, the feed makes that call itself, in the source context,
as you, and marks the row delivered, or failed with the app's own words. No agent turn is involved.
A row without a reply call is answered the old way, by your agent. Some answers only an app's own
client can make, such as Vote's sealed ballot; such a row shows the options and says to vote in the
app.

**Before you approve anything**, Chat uses the lens this app ships
([`lens/fixtures/chat.json`](app/src/lens/fixtures/chat.json)). It records a DM, a mention of you,
`@everyone` or `@here`, and your own role changing. It drops the rest of a channel, your own
messages, edits and reactions.

"You" is your node's account id, which is what apps stamp on what you do (`env::account_id()`),
plus this device's key. The app key comes from the installed package (`com.calimero.mero-chat`
becomes `chat`). mero-bot runs the same lenses with the same keys.

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

## With mero-bot

[mero-bot](https://github.com/calimero-network/mero-bot) is a terminal agent that drives your node
through mero-mcp. Run it on the machine with the node and it plugs into your feed by itself. It finds
the feed context, then:

- **Gates and logs every call.** Each call it makes through mero-mcp is checked against your rules
  here. Allowed writes are logged when they finish. Guarded ones become a proposal you approve or
  decline in Hyperfeed (or at its terminal). Refused ones never run. It is never allowed to approve,
  answer or change your rules.
- **Watches the node.** It subscribes to every context on the node and runs other apps' events
  through the same lenses as this app's collector, with the same keys, so nothing is collected twice.
- **Learns apps.** An app version with no lens starts a turn that learns one from its ABI and
  proposes it for your approval (`--no-learn` turns this off; `npm run learn` does it without the
  terminal UI).
- **Answers you.** What you say to it in the feed starts a conversation turn. It marks your message
  `thinking`, answers in the same chain, and anything it proposes or does because of it lands
  there too, under the same rules as everything else.
- **Turns events into turns.** Something new that needs you starts a triage turn, where the agent
  prepares proposals (a drafted reply, options, an action) instead of acting on its own. What you
  approve or answer here starts a turn that carries it out and reports back.

So the agent learns what is happening from the node's live event stream, and it acts only through
proposals you settle here, or where your rules let it act. See mero-bot's README for the flags
(`--autopilot off`, `--no-hyperfeed`).

The bundle also ships [`logic/GUIDE.md`](logic/GUIDE.md), which mero-mcp shows to any agent the
first time it meets this app. An agent without mero-bot's bridge still learns the loop from it.

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
| `record_notification` | `input: NotificationInput` | `FeedItem`; the same `key` again within 10 s returns the existing row |
| `complete_answer` | `id: string, outcome: "delivered" \| "failed", note: string` | `FeedItem` |
| `item` | `id: string` | `FeedItem` or `null` |
| `chain` | `chain: string` | `FeedItem[]`, every row in the chain, oldest first |
| `feed` | `filter: "all" \| "agent" \| "notifications" \| "needs_you", app_key: string, limit: u32, before: u64` | `FeedPage { items, counts, apps, next_before }`: one row per chain |
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
| `chain` | the id of the row that led to this (a notification, or an earlier action), or `""` to start a chain |
| `ask` | for a proposal: how you resolve it, `{ kind, prompt, options, draft }` (below). `{ kind: "", prompt: "", options: [], draft: "" }` for a plain approve or decline |

`NotificationInput` is `key` (stable for the same event on every device), `app`,
`source_context`, `source_label`, `from`, `title`, `body`, `event`, `needs_you`, `chain` and `ask`.

**Chains.** Pass the id of whatever led to an action as its `chain`, and the feed shows the whole
thread as one row, led by the step that needs you. `chain(id)` returns the flow, and every row's
`history` lists each step (`status`, `note`, `at`), so the app can show who did what and when.
Usually a notification starts the chain and the agent's actions continue it.

**Asks: how a row is resolved in place.**

| `kind` | The app shows | Your answer |
| --- | --- | --- |
| `reply` | a text box, `draft` pre-filled, `options` as suggested replies | the text |
| `choose` | one button per option (2–8) | the option |
| `confirm` | one button labelled `prompt` | `""` |
| `""` | the defaults: Approve and Decline on a proposal; nothing on a notification | `""` |

On a notification, your answer goes through `answer_notification` and its status moves
`received → answered`. On a proposal it goes with the approval (`resolve_action(id, "approve",
answer)`), so a slot picker or an edited draft is one tap. The answer is in the step's `note`, and
in the row's `note` while it is current.
**The loop an agent runs**

1. `check_action` before any write elsewhere.
   - `act`: do it, then `record_action` with `outcome: "done"` (or `"failed"` and a `note`).
   - `ask`: `record_action` with `outcome: "proposed"`, then wait.
   - `refuse`: don't. Recording a proposal would be refused too.
2. Wait by subscribing to the feed context's events (SSE or WebSocket). `ActionChanged { id, status }`
   arrives when you decide: `approved` (do it), `retrying` (try the failed one again),
   `undo_requested` (revert it) or `declined` (drop it). Polling `item` works too.
3. Report with `complete_action(id, "done" | "failed", note)`. It is accepted only while the action is
   `approved`, `retrying` or `undo_requested`. If the approval carried an answer, it is the row's
   `note` (the slot you picked, the text you edited): do exactly that.
4. Answers to notifications arrive as `NotificationChanged { id, status: "answered" }`. Read the
   row: `ask.kind` says what to do and `note` holds the answer (reply with that text, vote that
   option, confirm). Then report with `complete_answer(id, "delivered" | "failed", note)`. A failed
   delivery goes back to you to answer again.
5. Record what you do as a result with `chain` set to the row that led to it, so the flow stays one thread.
6. You talk to your agent with `say`, or `say_with` when you attach images, which arrives as `MessagePosted { id, chain, from: "you" }`.
   A message with images lists them in `attachments`; fetch each by `blob_id` from the node (with the
   feed's context id) and look at it before answering.
   Take it up with `agent_ack(id, "thinking", "")` (that is how the feed knows an agent is there),
   then answer with `agent_say(chain, id, text)`, which marks it `answered`. When your answer leaves
   something to the user, use `agent_ask(chain, id, text, ask)` (a `choose` or `reply` ask): your
   message is `asked` and needs them until they say something in the chain, which answers it. If you cannot, give up
   with `agent_ack(id, "failed", why)`. A proposal or action the conversation leads to goes in the
   same `chain`. An agent that was away reads `open_questions()` when it starts.
   The app's Chat page (`/chat`) is these chains as chats: New chat is `say("", text)`, every
   message after it is `say(chain, text)`, and your answers show as they land. A message nobody
   has taken up after 30 seconds asks whether your agent (mero-bot) is running.

An outcome recorded where the rules said `ask` or `refuse` is still stored, with `breach` set, and
stays in "Needs you" until you keep it or undo it. Events the contract emits: `ActionRecorded`,
`ActionChanged`, `NotificationRecorded`, `NotificationChanged`, `NotificationsSeen`,
`SettingsChanged`, `MessagePosted`, `MessageChanged`, `LensChanged`, `ArchiveChanged`.

7. Report in while you run: `agent_seen(name)`, about every 30 seconds (mero-bot sends
   `mero-bot@<host>`). `settings().agents` lists who reported and when.

**The owner's methods**, which the app calls: `resolve_action(id, decision, answer)` with
`approve`, `decline`, `undo` or `keep` (`answer` is `""` except for approving a proposal with an
ask); `answer_notification(id, answer)`; `set_policy(app_key, agent, notifications)`;
`set_guard(category, enabled)`; `set_paused(paused)`; `record_notification(input)`;
`say(chain, text)`; `decide_lens(app_key, application_id, decision)`; `mark_seen(ids)` and
`mark_all_seen()`; `archive(chains, until)` (`until` 0 = until something new happens, else ms
for "later") and `unarchive(chains)`; `feed("archived", …)` lists what is put away. An agent kit can call them too, since it
writes as you, but `resolve_action`, `answer_notification`, `decide_lens` and `say` are your decisions and your
words, and an agent should never call them for itself. The agent's side of lenses is
`propose_lens(app_key, application_id, spec, summary)` and `lenses()`.

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

Browser suites, as CI runs them (`test:e2e:ci`):

```bash
pnpm -F hyperfeed test:e2e        # tests/: the landing page and /demo, no node
pnpm -F hyperfeed test:e2e:node   # e2e/: a real merod with the bundle; create the feed, answer in place
```

The node suite boots its own merod on port 2697 from `MEROD_BINARY` (or `merod` on the path) and installs
`logic/dist/com.calimero.hyperfeed.mpk`, the bundle the `cargo mero bundle` line above writes there
when given `--output apps/hyperfeed/logic/dist/com.calimero.hyperfeed.mpk`.

## Using the feed

The feed is three lanes, one row per chain: **To do** (something in it needs you), **In
progress** (your agent is answering, an approved action is being carried out, or your answer is
being sent) and **Done**. The row you are on opens in place with its whole thread, its answer box
and its actions; nothing is repeated beside it. Done rows archive one at a time (`E`) or all at
once, and "Later" (`S`) puts a row away for three hours; both show an undo toast (`U`). `J`/`K`
move between rows. A row from a first-party app has **Open in …** (`O`), which shows that app
beside the feed at the row's context (Chat at the channel, Design at the document), signed in to
your node. Its address comes from the app's `frontend` in its Cargo.toml, and only those apps are
handed your session. The theme follows your system until you switch it.

The feed's id beside the brand switches feeds: it lists every feed this Hyperfeed has on your node
and opens the one you pick in place, still signed in, and a reload opens it again. **Create a new
feed** is there too. mero-bot follows you to a feed once you write in it.

## Upgrading

Feeds made by an earlier version are not migrated: delete the old feed and create a new one. The
state layout changed three times (conversations, then lenses, then images on messages), and the
prototype does not carry old rows over. An older feed still chats in text; attaching an image there
says the feed is too old.

## Not done yet

- Approvals from mero-bot's terminal and from the feed race; the first answer wins. A held tool call
  waits as long as mero-bot runs: there is no timeout yet.
- Push delivery for apps set to "Feed + push". The setting is stored, but nothing sends a push yet.
- Lenses for apps other than Chat are learned on your node; none ships for them. A lens is tried on
  recent events only when there are some, so a quiet app's lens is checked against its ABI alone.
- An answer the feed sends itself has no retry if the tab closes between the two calls; the row
  stays "Sending…".
- Paging past the first 50 rows. The contract returns `next_before`, but the UI does not ask for the next page.
