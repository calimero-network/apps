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
| Frontend | [`app/`](app): Vite, React and mero-react. `/` (feed), `/chat` and `/settings` run against your node; `/demo` runs the same pages in memory. Settings has a section per path: `/settings/controls`, `/settings/rules` (the language your agents answer in, English by default, your general rules, which every agent keeps, and rules for one agent only), `/settings/agents`, `/settings/lenses`, `/settings/alerts` (`/controls` lands on the first). Controls lists the core apps (Chat, Calendar, Sheets, Issues, Docs, CRM, Sign, Pass): those installed on your node are set app by app, the others offer Install, from the marketplace. Opened from Calimero Desktop, Hyperfeed acts with full access, as the admin dashboard does, so Install and deleting a feed work; signed in from a browser it holds an app's grant set, which may do neither, and says so. The bell in the top bar counts what needs you, whatever the feed shows, with the lenses and rules your agent proposed in Settings, and lists it one line each: a click opens it in place on the feed, with its buttons, a question or approval from a chat included. **The feed is where you act; Chat is the history.** What you ask your agent, from the top of the feed or on a row (with images, picked, pasted or dropped, as in Chat), opens in place: your agent's steps as it works, with Stop, then its answer as markdown, with cards for the PRs and runs it links to and Merge on them. A task post opens its chain in place too. Every conversation offers Open chat, or Continue in chat once it runs long, for its whole thread |

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
| **Message** | you, or your agent | what you said to your agent about a chain (or about anything, which starts a chain of its own), and its answers. Yours steps `waiting → thinking → answered` (or `failed`); the agent's are `said`. Yours may carry up to four **images** (PNG, JPEG, WebP or GIF, 10 MB each): blobs on your node announced to the feed's context, of which the feed keeps only the id, name, type and size, beside the message by id. One sent by an older client may also carry a **mode**, `private` or `public`, kept beside the message by id; which agent takes a message is now set per app (see Assignment) |
| **Notification** | your client, or your agent | app, source context, sender, title, event kind, and whether it needs you. Keyed by the state transition that produced it, so each of your devices records the same event once (see [the collector](#notifications-the-collector)). A notification a lens made also carries its **item type**, the type's **fields**, and the **reply call** that answers it in its app, kept beside it by id |
| **Lens** | your agent proposes, you approve | for one app version: which of its events become feed items, of which type, and how your answer goes back. JSON, up to 32 kB; `proposed`, `approved` or `rejected` |
| **Actions** | your agent proposes, you approve | for one app version: what your agent can do there in your words, each action with the methods it covers, whether it writes and its guard; `proposed`, `approved` or `rejected`. The newest approved set of an app is in force |
| **Action setting** | you | per app and action: `act`, `ask` or `off` apart from the app's mode |
| **Policy** | you | per app: the agent mode (`act` / `ask` / `read` / `off`) and notification routing (`push` / `feed` / `mute`) |
| **Guard** | you | "always ask me before…" for `sign`, `money`, `new_contact` and `delete` (on by default), and `invite` and `secret` (off by default) |
| **Pause** | you | while paused, every write the agent wants to make becomes a proposal |
| **Archived** | you | per chain: put away, with the chain's latest activity then and an optional return time ("later"). It is out of the feed until something new happens in it or that time passes |
| **Presence** | your agent | per agent name: when it last reported in. The app shows "Agent live" for 90 seconds after a report |
| **Access** | you | per agent name: what it may reach on its computer besides your Calimero apps: folders (each read only, or read and write; up to 20, each absolute or under `~`, no `..`), a shell, the web. Last-writer-wins. The agent's runtime enforces it before every tool call and refuses `set_access` to the agent. An Access you saved with no folders and shell and web off means your Calimero apps only. **Until you save one, the agent uses its own default:** for mero-bot, the folder it runs in, read and write, with shell and web on |
| **Reach** | your agent | per agent name: what it reports it can reach, one line per profile it runs (what it serves, model, attested or not, folders, shell, web), written with `agent_reach` (see [the loop](#api-for-agents)). Settings → Agents shows it beside your Access. An agent whose every line is attested is a **private** agent |
| **Assignment** | you | per app: which of your agents works in it, by the name it reports in with. Last-writer-wins; an empty agent gives the app back. Only that agent takes the app's work (new items, your decisions on its rows, your messages in a chat about it) and calls the app. An app with none is your private agents', or any agent's while none reports in. Code is the app `mero-bot` (the tools on a computer), and it has no default: nothing runs on a computer until you give Code to an agent that has one, such as your local mero-bot. The agent's runtime enforces it and refuses `set_assignment` to the agent |
| **Link** | your agent, or you | per task: a subject it works on (`<app>:<context>[:<id>]`) with a label, shown as a chip on the task's post. Your agent's writes add them; you add one from its address or take one off, and a link you took off stays off. A chip with no label is named from the thing itself where the app says: a chat link reads `#launch`, or `DM with Ronit` for a DM, read from the chat in its own context. The chip counts and groups what teammates did there, and opens it in its app beside the feed |
| **Subject** | your agent | what an action touched in another app, as `<app>:<context>[:<id>]` (the id from its `issue_id`, `doc_id` or `thread_id` arg), kept beside the action by id, and the chain that last touched each subject. A typed notification whose reply call goes to the same subject, recorded with no chain of its own, joins that chain unless you put it away: one thread per task, teammates' comments included |

Every record merges deterministically:

- A row's content is written once. Its history merges as a union of steps in one total order, so
  the last step is the current status on every device.
- "Reviewed" and "seen" only ever turn on.
- Policies, guards and archive decisions are last-writer-wins; presence keeps the latest report.

## The rules the contract applies

The agent calls `check_action(app_key, category, writes, method)` before it acts. It then calls
`record_action` either with a **proposal** or with an **outcome**. The same verdict governs both.

First the app's **actions** say what the call is. Your agent groups an app's methods into actions
you would recognise ("Edit documents", "Delete your messages") and proposes them like a lens; once
you approve them (**Settings → Actions**), the action that names the method decides whether the call
writes and, when it names one, its guard, whatever the agent says. A method no approved action names
asks you every time. With no approved actions, or an agent that names no method, the agent's
`category` and `writes` stand. You can set each action to act, ask first or off, apart from its app.

Your **node** is managed the same way, under the app key `node` ("Node management"). Your agent
reaches it through mero-mcp's node tools (installing apps, making and joining spaces, inviting
people, leaving and deleting), which are not an app's methods and have no ABI, so their actions ship
with Hyperfeed and mero-bot ([`node.json`](app/src/actions/fixtures/node.json)), checked against
mero-mcp's tool list: seeing what's on the node only reads; uninstalling, leaving and deleting are
covered by "Deleting anything"; inviting people and opening a group to a whole space by "Inviting
people or changing roles".

| Situation | Verdict |
| --- | --- |
| app mode `off` | refuse |
| the action is set to `off` | refuse |
| a read whose category's guard is on ("Reading a secret") | ask |
| a read (`writes: false`) | act |
| app mode `read`, and the action writes | refuse |
| agent paused | ask |
| the category's guard is on | ask |
| the app has approved actions and none names the method | ask |
| the action is set to `ask` | ask |
| the action is set to `act` | act |
| app mode `ask`, or an app with no policy | ask |
| app mode `act` | act |

"Allow for this session" covers the same action only, once an app has actions.

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

It is then tried on the app's recent events. Only a lens that passes is proposed. In **Settings → Lenses**,
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

The other core apps ship one too, each in `app/src/lens/fixtures/`:

| App | Records |
| --- | --- |
| Calendar | an event you're invited to that someone else made |
| Sheets | a comment mentioning you (reply adds a comment), an alert sent to you, your role changing |
| Issues | a comment on an issue you report or are assigned (reply adds a comment), an issue assigned to you |
| CRM | a note someone else adds to a deal you created (reply adds a note) |
| Sign | a new document you can sign, your permission changing, being removed |
| Pass | someone else editing, trashing or restoring a secret you made (never its value), your vault role changing |

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
- **Fires your watches.** "Merge #434 when it's green" becomes a watch in the feed, and mero-bot's
  runtime polls it through `gh` and fires it once, even after the session that set it ended (see
  [Watches](#api-for-agents)).
- **Keeps merges safe.** It records what it sees of the PRs your tasks link to (`record_pr`), so a
  PR card can offer Merge only when every check passed and the base is the default branch. Your
  Merge is a merge watch it fires at once when the checks are green; the agent merges only through
  the same rules (its `merge` tool), and a raw `gh pr merge` in its shell is refused.

So the agent learns what is happening from the node's live event stream, and it acts only through
proposals you settle here, or where your rules let it act. See mero-bot's README for the flags
(`--autopilot off`, `--no-hyperfeed`).

### Running mero-bot on NEAR, on Claude, or both

Which model answers is set by the agents in `~/.mero/agents.json` (or `./mero.json` in the folder
you start it from). Each one reports what it can reach, and Settings → Agents shows it under
`mero-bot@<host>`, beside the Access you set.

**On Claude** (the default, no config needed). Every turn runs on Claude through your Claude Code
login, with files, a shell and the web, limited by the Access you set for it:

```sh
calimero-agent                      # or: calimero-agent -m claude-sonnet-5-5
```

**On NEAR only** (private). Every turn runs on a model in NEAR AI Cloud's TEEs, which mero-bot
attests before sending anything. A NEAR profile has your Calimero apps only: no files, shell or web.
Name no Claude agent as `delegate` or `fallback`, so nothing leaves the TEE:

```json
{
  "agents": {
    "near": { "runtime": "openai", "attest": "near", "model": "<id from NEAR's model list>" }
  },
  "default": "near"
}
```

```sh
export NEAR_AI_API_KEY=…
calimero-agent                              # with the terminal UI
calimero-agent --headless --attested-only   # no terminal; refuses to start if any turn could reach an unattested model
```

It finds the node on this machine, or the one in `CALIMERO_NODE_URL`.

Its reach line reads `Default · near (<model>), attested: Calimero apps only`, and an agent whose
every line is attested is your **private** agent: it takes every app you did not assign.

**Both, in one mero-bot.** Route talking to you and triage to NEAR, and everything else (carrying
out what you approved, watches, learning lenses, what you type at the terminal) to Claude. NEAR
hands work that needs code to Claude with `delegate`, as a proposal you approve, and Claude takes a
turn when NEAR is down or fails attestation (`fallback`):

```json
{
  "agents": {
    "near":  { "runtime": "openai", "attest": "near", "model": "<id from NEAR's model list>",
               "delegate": "coder", "fallback": "coder" },
    "coder": { "runtime": "claude" }
  },
  "routes": { "converse": "near", "triage": "near" }
}
```

```sh
NEAR_AI_API_KEY=… calimero-agent
```

Settings → Agents then shows one reach line per profile a turn can reach: Claude for the default,
NEAR for `converse` and `triage` (attested, Calimero apps only), and Claude again as NEAR's hand-off.
The Claude lines carry your folders, shell and web. Since not every line is attested, this agent is
not private. Don't add `--attested-only` here: it
refuses this config.

**Both, as two agents.** Run a private NEAR mero-bot (as above, for example in
[mero-tee](https://github.com/calimero-network/mero-tee)'s agent image) and a Claude mero-bot on your
laptop. They report in under their own names, so they must run on different hosts: two on one
machine share `mero-bot@<host>`. In Settings → Agents, the NEAR one takes every app you did not
assign; give **Code** (and any app you want Claude on) to the laptop. Until you do, no feed turn runs
a tool on your computer. Set each one's Access separately.

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
context id is under **Settings → Agents → Connect your agent**. Every write must come from the feed's owner
account (your node's own identity, or your account through a warrant); anything else is refused.

**The agent's methods**

| Method | Args | Returns |
| --- | --- | --- |
| `check_action` | `app_key: string, category: string, writes: bool, method?: string` | `Verdict { decision: "act" \| "ask" \| "refuse", reason }` |
| `record_action` | `input: ActionInput` | `FeedItem`, the recorded row with its `id` |
| `complete_action` | `id: string, outcome: "done" \| "failed", note: string` | `FeedItem` |
| `record_notification` | `input: NotificationInput` | `FeedItem`; the same `key` again within 10 s returns the existing row |
| `complete_answer` | `id: string, outcome: "delivered" \| "failed", note: string` | `FeedItem` |
| `item` | `id: string` | `FeedItem` or `null` |
| `chain` | `chain: string` | `FeedItem[]`, every row in the chain, oldest first |
| `feed` | `filter: "all" \| "agent" \| "notifications" \| "needs_you", app_key: string, limit: u32, before: u64` | `FeedPage { items, counts, apps, next_before }`: one row per chain |
| `settings` | none | `SettingsView { owner, paused, policies, guards, agents, access, reach, assignments, … }` |
| `set_checkpoint` | `chain: string, input: CheckpointInput { done, next, branches, worktrees, prs, questions, author }` | `CheckpointView`, now the chain's latest; it replaces the last one |
| `checkpoint` | `chain: string` | `CheckpointView { chain, done, next, branches, worktrees, prs, questions, author, updated_at }` or `null` |

**Checkpoints: tasks a new session can pick up.** An agent session can end mid-task and take its
plan with it. So at each milestone, and before a turn ends with work outstanding, the agent writes a
short checkpoint on the task's chain with `set_checkpoint`: what is done, the next step, the
branches, worktrees and PRs it works on, and what is still open. There is one per chain, and each
write replaces the last (`CheckpointChanged { chain }`). A new session reads `checkpoint(chain)`
before it acts there and resumes from it; mero-bot puts it in the turn's prompt. The app shows it
behind "Where it stands" on the task. Limits: `done` and `next` up to 1000 bytes (at least one of
them), each list up to 10 one-line entries of up to 300 bytes, `author` up to 120 bytes.

**Watches: "when X, do Y" that outlives a session.** "Merge #434 when it's green" or "watch main
and fix it if red" used to live in an agent session's background shell and die with it. A watch is
kept in the feed instead: a condition, an action, and the chain it reports to.

| Method | Args | Returns |
| --- | --- | --- |
| `add_watch` | `input: WatchInput { chain, condition, repo, pr, branch, action, text, agent }` | `WatchView`; the same watch twice is kept once |
| `cancel_watch` | `id: string, note?: string` | `WatchView`, `cancelled`; refused once it fired |
| `fire_watch` | `id: string, session: string` | `WatchView`, `firing`; refused unless it is `watching` |
| `finish_watch` | `id: string, outcome: "done" \| "failed", note: string` | `WatchView`; only a `firing` watch |
| `watch_seen` | `id: string, seen: string` | `WatchView`: where the condition stood when last looked at, one line |
| `watches` | `chain: string` (`""`: every chain) | `WatchView[]`, oldest first |

`condition` is `pr_green`, `pr_red`, `pr_merged` (with the PR's number in `pr`), `branch_green` or
`branch_red` (CI on `branch`'s head; `""` is the default branch; `pr` 0). `action` is `merge` (with
`pr_green` only), `turn` (start an agent turn in the chain with `text`) or `notify` (tell you `text`
in the chain). At most 50 wait at once. The contract cannot read GitHub: the agent's runtime polls
the conditions (mero-bot, through `gh`). When one is met it takes the watch with `fire_watch` before
it acts, so of every session polling exactly one acts, once, and a restarted one never acts again;
then it reports with `finish_watch`. A watch's status only moves forward (`watching → firing →
done | failed`, or `watching → cancelled`), also when two devices' copies merge. A merge applies the
safe-merge rules when it fires: open, not a draft, no conflicts, every check passed, and the base is
the default branch, so a stacked PR is refused. The app shows the watches still waiting on their
task, and every watch in its chat, with where each stands and Cancel. Each change emits
`WatchChanged { id, chain, status }`.

**PRs: what the runtime sees on GitHub, for the merge button.** The browser holds no GitHub token,
so it reads only public repos, 60 requests an hour. The agent's runtime reads GitHub with your
login and records each PR a task links to, one row per `owner/name#number`.

| Method | Args | Returns |
| --- | --- | --- |
| `record_pr` | `input: PrInput { chain, repo, pr, title, state, draft, base, default_branch, conflicts, head_sha, checks, checks_total, checks_passed, checks_pending, failing, stacked_on, stacked_merged }` | `PrView` with `seen_at`; owner only |
| `prs` | `chain: string` (`""`: every chain) | `PrView[]`, most recently seen first |

`state` is `open`, `merged` or `closed`; `checks` is `green`, `red` (exactly when `failing` names a
check, at most 10) or `pending`; `stacked_on` is the number of the PR whose branch `base` is (0 when
`base` is the default branch). `chain` `""` keeps the chain already recorded. At most 200 are kept;
one more drops the one seen longest ago. Each write emits `PrChanged { key }`.

A PR card in a chat shows the newer of the browser's own read and this record, and its merge
control goes by the safe-merge rules: **Merge** when every check passed and the base is the default
branch, **Merge when green** while checks run, held with the failing check named on red (or for a
draft or a conflict). Both set a merge watch (`pr_green` → `merge`) on the chat's chain, which the
card then shows (waiting with Cancel, merging, merged, or not merged and why). A PR whose base is
another PR's branch has no Merge: "Base merged: retarget to main" once that PR merged (asked of
your agent), or a line saying it is stacked and can't merge into the default branch. The row is
advisory: the runtime checks GitHub again when the watch fires.

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
   then answer with `agent_say(chain, id, text, headline?)`, which marks it `answered`. A long answer
   takes a `headline` (one line, at most 80 characters): the row shows it with the text behind "More",
   and the text may run to 32 KB instead of 2000 bytes. Without one the app titles the row by the
   answer's first sentence. When your answer leaves
   something to the user, use `agent_ask(chain, id, text, ask)` (a `choose` or `reply` ask): your
   message is `asked` and needs them until they say something in the chain, which answers it. If you cannot, give up
   with `agent_ack(id, "failed", why)`. A proposal or action the conversation leads to goes in the
   same `chain`. An agent that was away reads `open_questions()` when it starts.
   The app's Chat page (`/chat`) is these chains as chats: New chat is `say("", text)`, every
   message after it is `say(chain, text)`, and your answers show as they land. Which agent answers
   is set per app in Settings → Agents (`set_assignment`): a chat about an app goes to the agent
   that works in it, and a new chat to your private agent. When that agent meets work that needs
   code, it proposes a hand-off (an action in the app `mero-bot`, method `hand_off`) and the agent
   you gave code to takes the chat up only once you approve it. What waits on you in a chat is a
   card in its thread, not a one-line note: a proposal shows what it would send and why,
   its body (the call's arguments, `message: <p>Hi</p>`, as mero-bot keeps them to tell a write that
   already landed) read as text: one argument as its text alone, several one per line, HTML as the
   text it shows. A message that reached you in the chain (a reply to one your agent sent) shows what was said
   with its reply box, answered there or in the feed. `settings().message_modes` is empty:
   no client offers a mode any more. A message nobody
   has taken up after 30 seconds asks whether your agent (mero-bot) is running.

An outcome recorded where the rules said `ask` or `refuse` is still stored, with `breach` set, and
stays in "Needs you" until you keep it or undo it. Events the contract emits: `ActionRecorded`,
`ActionChanged`, `NotificationRecorded`, `NotificationChanged`, `NotificationsSeen`,
`SettingsChanged`, `MessagePosted`, `MessageChanged`, `LensChanged`, `ArchiveChanged`,
`WatchChanged`, `PrChanged`.

7. Report in while you run: `agent_seen(name)`, about every 30 seconds (mero-bot sends
   `mero-bot@<host>`). `settings().agents` lists who reported and when. Report what you can reach with
   `agent_reach(name, lines)`, one `ReachLine { serves, profile, model, attested, folders, shell, web }`
   per profile you run (`serves` is `default` or the kind of work routed to it; up to 16 lines), and
   again when it changes; the latest report replaces the last. Read the owner's Access for your name
   from `settings().access` and enforce it before every tool call; with none saved, apply your own default and
   report it here, so Settings → Agents shows the owner what you actually reach.

**The owner's methods**, which the app calls: `resolve_action(id, decision, answer)` with
`approve`, `decline`, `undo` or `keep` (`answer` is `""` except for approving a proposal with an
ask); `answer_notification(id, answer)`; `set_policy(app_key, agent, notifications)`;
`set_guard(category, enabled)`; `set_paused(paused)`; `set_access(agent, folders, shell, web)`;
`set_assignment(app_key, agent)` (`agent` `""` gives the app back to the default); `record_notification(input)`;
`say(chain, text, headline, mode)`; `decide_lens(app_key, application_id, decision)`;
`decide_actions(app_key, application_id, decision)`; `set_action_mode(app_key, action, mode)` (`act`, `ask`,
`off`, or `""` to follow the app); `mark_seen(ids)` and
`mark_all_seen()`; `archive(chains, until)` (`until` 0 = until something new happens, else ms
for "later") and `unarchive(chains)`; `feed("archived", …)` lists what is put away. An agent kit can call them too, since it
writes as you, but `resolve_action`, `answer_notification`, `decide_lens` and `say` are your decisions and your
words, and an agent should never call them for itself. The agent's side of lenses is
`propose_lens(app_key, application_id, spec, summary)` and `lenses()`; of actions,
`propose_actions(app_key, application_id, actions, summary)` and `action_sets()`.

## Trust model, honestly

- **Owner-only writes bind honest nodes only.** `require_owner` runs inside the contract, and a
  peer's node folds deltas without executing it. A feed's members are you, on your devices, and the
  cloud agents you add; a cloud agent is attested code, which is why it is trusted with the agent's
  side. Merge-time enforcement (a writer set) is the step to take before a feed is shared with
  anyone else.
- **An agent on your own computer cannot be told from you.** It acts as your account, so approvals
  record *your decision* and the hard boundary is the agent itself, which must not sign a warrant
  for something waiting on you.
- **A cloud agent can.** It has an account of its own, which you add with
  `add_agent_account(account, name)` (and take off with `remove_agent_account(account)`); it must
  also be invited to the feed's context. It may make only the agent's side of the feed (record
  actions and notifications, take up and answer your messages, report progress, suggest rules and
  lenses, claim chains, keep watches and PRs, report what it reaches), and only as the name you
  added it under. Approving, answering, `say`, rules, modes, guards, access, assignments, push
  devices and agent accounts stay yours, enforced by the contract.
- **Drafts you send.** An action proposed with a `send_call` (`{"method", "args"}`, `"=answer"`
  for your edit of its draft) is sent by your client, as you, when you approve it, and reported by
  your client with `complete_action`; the agent can neither send nor report one. Since the write
  is yours, an app where your agent may only read still takes drafts.
- **Notifications are best-effort.** Core events carry no author and no "concerns you" bit, so the
  "needs you" flag is a guess for every kind outside the known list.

## Running it

Building the contract needs **cargo-mero 0.11.0-rc.83 or newer**: the core tag the workspace's
`calimero-sdk` is pinned to in the root `Cargo.toml`, and the one CI installs
(`.github/actions/install-cargo-mero`). An older cargo-mero writes an ABI the SDK no longer
matches. Install that one with
`cargo install --locked --git https://github.com/calimero-network/core.git --tag 0.11.0-rc.83 cargo-mero`,
and check with `cargo mero --version`. When core is bumped, this moves with it.

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
state layout changed many times (conversations, lenses, images on messages, and since then most
releases, push devices included), and the
prototype does not carry old rows over. An older feed still chats in text; attaching an image there
says the feed is too old.

## Not done yet

- Approvals from mero-bot's terminal and from the feed race; the first answer wins. A held tool call
  waits as long as mero-bot runs: there is no timeout yet.
- Push delivery for apps set to "Feed + push". The setting is stored, but nothing sends a push yet.
  Phone alerts (Settings → Alerts) keep your devices' push subscriptions and the runtime's VAPID
  public key in the feed; mero-bot's sender, which pushes what newly needs you, is a separate change.
- Actions ship for the core apps (Chat, Docs, Calendar, Sheets, Issues, CRM, Sign and Pass) and for node
  management as fixtures in `app/src/actions/fixtures/`, each checked against its app's ABI (the node's against
  mero-mcp's tools) and covering every method; the demo uses them, and mero-bot proposes its copy of them on your
  node. Any other app's actions are learned by your agent.
- Lenses for apps other than the core ones are learned on your node; none ships for them. A lens is tried on
  recent events only when there are some, so a quiet app's lens is checked against its ABI alone.
- An answer the feed sends itself has no retry if the tab closes between the two calls; the row
  stays "Sending…".
- Paging past the first 50 rows. The contract returns `next_before`, but the UI does not ask for the next page.
