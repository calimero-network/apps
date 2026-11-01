# Hyperfeed

## Overview

Hyperfeed is the user's feed of everything an agent does on their behalf, beside every notification their apps send them.
It is also where they set what the agent may do, and where they approve, answer and undo.
If you are an agent acting for this user in their Calimero apps, this feed is where you report and where you ask.

- An **action** is something you did, or want to do: an app, a method, a title the user reads, and your reason (`why`).
- A **notification** is something an app sent the user. It may carry an **ask**: how the user answers it in place (`reply`, `choose`, `confirm`).
- Every row belongs to a **chain**: the id of the row that led to it. The user sees a chain as one expandable flow.
- Every row keeps its **history** of steps (`status`, `note`, `at`). An action goes `pending → approved → done`, or `failed`, `declined`, `undo_requested`, `undone`. A notification goes `received → answered → delivered` or `failed`.

## Feed model

- A feed is one app instance of this package, created by the user in an organization of its own. Usually there is exactly one, and only its owner decides.
- You write as the user's account, or as an agent account the user added with `addAgentAccount` and invited into the feed's organization; an agent account speaks only as the name it was added under.
- Method names and top-level argument names are camelCase; fields inside struct arguments and results are snake_case; `u64` arguments (`before`, `until`, `at`, `since`, `ttlMs`) are decimal strings. Reads are views.
- The feed takes no init arguments.

## Getting started

1. List the apps of the package `com.calimero.hyperfeed` you reach and take its one instance (ask the user if there are several).
2. Keep its app id: every call below goes to it.
3. Read the user's rules with `settings`.

## Procedures

### Before writing in another app

Call `checkAction` with the app's short key (`chat`, `crm`, `kv-store`: the package's last segment without `mero-`), a guard category (`sign`, `money`, `new_contact`, `delete`, `invite`, `secret`, or `""`), `writes: true`, and the app `method` you are about to call.

Once the user approved the app's actions (see "Describe an app's actions"), the action that names `method` decides whether the call writes and, when it names one, its guard; your `category` stands only where the action leaves it empty (sending to someone new). A method no approved action names always asks.

- `act`: do it, then `recordAction` with `outcome: "done"` (or `"failed"` with a `note`).
- `ask`: do not do it. `recordAction` with `outcome: "proposed"` and wait for the user's decision.
- `refuse`: do not do it, and do not propose it.

```json
{ "app_key": "chat", "category": "", "writes": true, "method": "send_message" }
```

### Record an action

`recordAction` takes one `input`. Every field is required; use `""` when there is nothing to say.
Set `chain` to the id of whatever led to this (the notification you are answering, an earlier action), or `""` to start a chain.

```json
{ "input": {
  "app": "chat", "source_context": "<context id>", "source_label": "#launch",
  "method": "send_message", "category": "", "writes": true, "undoable": true,
  "title": "Replied to Maya with the deck link", "body": "", "why": "Maya asked for the numbers",
  "outcome": "done", "intent_hash": "", "executor": "", "note": "",
  "chain": "<notification id>", "ask": { "kind": "", "prompt": "", "options": [], "draft": "" } } }
```

Optionally name what the action touched as `subject`: `<app>:<context id>`, plus `:<id>` when the call's args name one thing by `issue_id`, `doc_id` or `thread_id` (the first of those it has).
A notification about the same thing (its reply goes to the same issue, chat or board) then joins your chain instead of starting its own, so a teammate's comment on the issue you moved shows in the same task. A chain the user put away is not reopened this way.

```json
"subject": "issue-tracker:<context id>:issue-1727000000000-1a2b3c4d"
```

A write that has no row of its own (a step you report with `agentWork` on the user's message) names its subject with `touchSubject(chain, subject)`.

Every subject a task touches becomes one of its **links**: a chip on the task's post that opens the thing in its app and groups what teammates did there. `links(chain)` lists them, each with its `app`, `context`, `item`, `label` and `activity` (teammates' notifications about it in the task).
When you create something for a task (an issue, a doc, a board), name it: `addLink(chain, { subject, label: "<its title>", by: "agent" })`. A link the user took off (`removeLink` is theirs) stays off: adding it again is refused.

### Propose something the user resolves in one tap

Use an `ask` on a proposal:

- `reply` with a `draft`: the user edits your text and approves.
- `choose` with 2 to 8 `options`: the user picks one, and the pick approves the proposal.
- `confirm` with a `prompt`: one button.

The user's answer arrives as the action's `note` when its status becomes `approved`.

### Carry out what the user decided

Watch the feed's events, or read with `item`:

- `ActionChanged` with `approved`, `retrying` or `undo_requested`: do it (use the `note` exactly when there is one), then `completeAction` with `done` or `failed` and a one-line `note`.
- `NotificationChanged` with `answered`: the `note` is the user's answer. Send the reply, cast the vote, or confirm in the source app, then `completeAnswer` with `delivered` or `failed`.
- A row with `superseded_by` set is a question a newer one in its chain replaced before the user answered it. If an answer still reaches it (a notification `answered` with `superseded_by`, or a message of theirs with `answers_superseded: true`), they answered an old question: confirm against where things stand now before acting on it.

### Answer the user's messages

The user talks to you from the feed, about one chain or about anything.

- `MessagePosted` with `from: "you"`: read the message with `item`, and the chain it is in with `chain`.
- A message may carry images in `attachments` (`blob_id`, `name`, `mime`, `size`), and then its `body` may be empty. Each is a blob on the node, announced to this feed's context: fetch it by `blob_id` and look at it before you answer.
- A message may carry a `mode`: `private` (only an agent whose model runs where no operator can read it, such as an attested TEE, may take it) or `public` (any agent the user configured for it). Run its turn on the agent the user configured for that mode, and never hand a `private` turn to another agent. One with no `mode` takes the mode of the user's last message in the chain that had one, and `private` when none did. A runtime not configured for a mode leaves the message for one that is.
- Take it up at once with `agentAck` (`status: "thinking"`), so the user sees you are on it.
- What you may reach on your computer besides the user's Calimero apps is theirs to set: `settings().access`, by your agent name (folders, each read only or read and write; a shell; the web). Keep every file, shell and web call within it, refuse yourself what it does not allow and say which setting the user would change, and never call `setAccess`. Report what you can reach with `agentReach(name, lines)`, one line per profile you run, when it changes.
- While you work, report your latest step with `agentProgress` (`id`, `doing`: "Running the tests", "Editing ChatView.tsx"). Each call replaces the last, so send one when your step changes, not a log.
- Better, report the whole turn with `agentWork` (`id`, `steps`: every step so far, each `{ id, title, status, at }` with status `running`, `waiting`, `done` or `failed`; `draft`: the answer written so far). Each call replaces the last; the user sees the steps in a Working… block under their message and the answer as it is written, and no step becomes a row of its own.
- The user can press Stop: `StopRequested { id }` (and the message's `stop_at`) means end the turn at once and mark the message with `agentAck` (`status: "failed"`, `note: "Stopped by you"`).
- Answer with `agentSay`: the message's `chain`, its `id` as `reply_to`, and your answer as `text`.
- A long answer (a report, a list, more than a few lines) takes a `headline`: one line of at most 80 characters saying what it is. The feed row shows the headline with the text behind "More", the chat shows the whole text, and `text` may then run to 32 KB. Without a headline `text` keeps to 2000 bytes. `agentAsk` takes a `headline` too.
- If your answer leaves something to the user (a question, a choice of next steps, "want me to…?"), answer with `agentAsk` instead: the same arguments plus an `ask` of kind `choose` (2 to 8 `options`) or `reply` (a `prompt`). The chain then stays in the user's To do until they answer, and their answer arrives as their next message in the chain. Use `agentSay` only when the work is done. Asking again in the chain replaces your earlier open question there: its buttons go, and only the newest one waits on the user.
- If they want something done, do it the way you do anything: `checkAction` first, then act or propose, with `chain` set to the message's chain so it shows in the same conversation.
- If you cannot answer, `agentAck` with `status: "failed"` and a one-line `note` saying why.
- When you start, `openQuestions` lists the messages still waiting on you.

```json
{ "chain": "<message chain>", "reply_to": "<message id>", "text": "Here is a more formal draft." }
```

### Teach the feed an app (a lens)

A lens tells the user's feed which of an app's events matter to them, as which item type, and how
their answer goes back. You write it from the app's ABI; the user approves it.

- `lenses` lists every lens, by app and application id, with its status.
- Write the lens as JSON: `{ "version": 1, "events": { "<Event>": { "type", "read"?, "let"?, "show_if"?, "fields", "title"?, "ask"?, "reply"? } | "ignore" } }`. A string starting with `=` is an expression.
- Record only what concerns the user, never what they did themselves (`mine(...)`), and name every event the app emits.
- `proposeLens` with `app_key`, `application_id`, the lens as a JSON string, and one sentence for the user. It waits for their approval. With mero-bot, propose through its `proposeLens` tool, which checks the lens against the ABI first.

### Describe an app's actions

Actions are what you can do in an app, in words the user would use ("Edit documents", "Delete your
messages"), each covering some of the app's methods. You write them from the app's ABI; the user
approves them, then can set each one to act, ask first, or off, apart from the app's mode.

- `actionSets` lists every app version's actions, with its status. An app's newest approved set is in force.
- Group methods the user would think of as one thing. Every reading method goes in an action with
  `writes: false`; anything that changes state goes in one with `writes: true`. A method belongs to one action.
- Give an action a guard `category` only when every call is covered by it (`delete_message`: `delete`).
  Leave it `""` when it depends on the call, such as sending to someone new: then the category you pass to `checkAction` stands.
- Cover every method but `init`. One you leave out asks the user every time.
- `proposeActions` with `app_key`, `application_id`, the actions (`[{ id, label, description, category, writes, methods }]`)
  and one sentence for the user. It waits for their approval; the set in force stays meanwhile. Propose again for a new app version.
- The node itself is the app key `node`: your node tools (installing apps, spaces, invitations) are its methods,
  named as the tool is (`install_application`, `leave_namespace`), and pass them as `method` to `checkAction`.
  Its actions ship with Hyperfeed and mero-bot; propose them under `application_id` `node-v1`, and a changed list under the next one.

### One session per chain

Before you start work on a chain, `claimChain(chain, session, ttl_ms, agent)` with your session's own id and a name ("mero-bot@host"). It is refused while another session holds an unexpired lease: leave that chain to it. Renew with `renewChain` while you work and `releaseChain` at the end; a lease that runs out (a session that died) can be claimed again.

### Leave a checkpoint on a task

A session can end mid-task. So the next one can pick the task up, keep a checkpoint on its chain:

- Before you act on a chain, read `checkpoint(chain)`. If there is one, resume from its `next` step; check its branches, worktrees and PRs are still where it says.
- At each milestone (a plan made, a branch pushed, a PR opened, tests green) and before you stop with work outstanding, `setCheckpoint(chain, input)`. Each write replaces the last.
- `input` is `{ done, next, branches, worktrees, prs, questions, author }`: `done` and `next` up to 1000 bytes each (at least one of them), each list up to 10 one-line entries of up to 300 bytes, `author` your name ("mero-bot@host"). Say only what a fresh session needs, not a log.

```json
{ "chain": "<chain>", "input": { "done": "Found the bug in ChatView; fix written", "next": "Run the app tests, then open a PR",
  "branches": ["mero-bot/chain-1a2b"], "worktrees": ["/Users/me/workspace/apps-chain-1a2b"], "prs": [],
  "questions": [], "author": "mero-bot@studio" } }
```

### Tell a task as one card (a situation)

The user's brief shows the few things that need them, most pressing first. Help it say what matters:

- When a chain needs the user and its rows alone don't tell the story (several messages, a clash, teammates' replies in the chats and issues it links to), read them and write `setSituation(chain, input)`: how you would brief the user in person. Each write replaces the last; write it again when the picture changes, and `clearSituation(chain)` once it no longer helps.
- `input` is `{ headline, summary, recommend, reason, score, due_at, sources, apps, author }`: `headline` one line up to 140 bytes ("Launch date: the team settled on Thursday, and your calendar clashes"), `summary` up to 1000 bytes of what is going on, `recommend` up to 400 bytes of what you would do, `reason` one line up to 240 bytes of why it ranks where it does, `score` 0 (whenever) to 100 (now), `due_at` in ms or 0, `sources` and `apps` how many things you read and in how many apps.
- Say only what the rows show. Never invent a deadline; `due_at` 0 when nobody named one.

```json
{ "chain": "<chain>", "input": { "headline": "Launch date: the team settled on Thursday, and your calendar clashes",
  "summary": "Ronit, Maya and two others agreed in #launch to ship Thursday. Your design review is Thursday 14:00, the same slot as the launch call.",
  "recommend": "Confirm Thursday in #launch and move the review to Friday 10:00.", "reason": "Ronit needs your yes before the memo at 16:00.",
  "score": 90, "due_at": 1792170000000, "sources": 7, "apps": 3, "author": "mero-bot@studio" } }
```

### Let a proposal go ahead unless the user stops it (a default)

For a routine proposal the user would almost surely approve, you may set a time it goes ahead: `scheduleAutorun(id, at)`, `at` in ms, at most a week ahead. The user sees "Goes ahead by itself at 17:00" with Stop it.

- Only for a proposal you can undo (`undoable`), behind no guard, in an app where you may write, while you are not paused, that is not a draft the user sends (`send_call`), and whose ask is none, a confirm, or a reply with a draft. Anything else is refused.
- When the time comes, call `fireAutorun(id)`. It approves the proposal with its draft as the answer (the row's `note`), and you carry it out as any approval. The contract checks everything again first: if the user paused you, turned the app to read or set a guard since, it is refused and the proposal waits for them.
- `stopAutorun` is the user's. Once stopped it never goes ahead, and you may not set it again. Read `autoruns()` when you start; `AutorunChanged` tells you when one changed.

### Split a chat into tasks

One feature per task. When the user asks to start a feature from a chat ("Start X", or a "Start: X" option you offered), or a chat has turned into a list of separate features, spin each one off instead of working on it in the chat: `startTask(from, text, headline)`, with `from` the chat's chain, `text` a brief that stands on its own (what to build, what was decided, which repos), and `headline` its name ("Safe merge"). It posts the brief as the user's message in a new chain, which gets its own task post, workspace, checkpoint and PRs, and links the two: `hyperfeed:task:<task chain>` on the chat and `hyperfeed:from:<chat chain>` on the task (read them with `links`). Then say in the chat what started. Work on the task only in its own chain; read the chat it came from for background.

### Wait for something, then act: set a watch

"Merge #434 when it's green" or "watch main and fix it if red" is a watch in the feed, not a loop in your session: a session ends, a watch does not.

- `addWatch(input)` with `input` `{ chain, condition, repo, pr, branch, action, text, agent }`. `condition` is `pr_green` (every check on the PR passed), `pr_red` (one failed), `pr_merged`, `branch_green` or `branch_red` (CI on a branch's head; `branch: ""` is the default branch). `pr` is the PR's number for `pr_*` and 0 otherwise. `action` is `merge` (with `pr_green` only), `turn` (start an agent turn in the chain with `text` as its instructions) or `notify` (tell the user `text` in the chain). `repo` is `owner/name`. The same watch twice is kept once; at most 50 wait at once.
- `watches(chain)` lists them (`""`: every chain) with `status` (`watching`, `firing`, `done`, `failed`, `cancelled`), `seen` (where the condition stood when last looked at) and `note` (how the action went). `cancelWatch(id, note?)` cancels one still `watching`.
- The agent's runtime, not a model turn, polls them (mero-bot does, through `gh`, about every 45 s). When a condition is met it first calls `fireWatch(id, session)`, which moves `watching → firing` and is refused for any other status, and acts only if that succeeded: exactly one session acts, once, even after a restart. Then `finishWatch(id, "done" | "failed", note)`. `watchSeen(id, seen)` records where a condition stands. A merge keeps the safe-merge rules at that moment: the PR is open, not a draft, has no conflicts, every check passed, and its base is the default branch; a stacked PR (based on another PR's branch) is refused.

```json
{ "input": { "chain": "<chain>", "condition": "pr_green", "repo": "calimero-network/apps", "pr": 434, "branch": "",
  "action": "merge", "text": "", "agent": "mero-bot@studio" } }
```

With mero-bot, set them through its `watch`, `unwatch` and `watches` tools.

### Merge a PR only by the safe-merge rules

Merge a PR only when it is open, not a draft, free of conflicts, every check passed, and its base is the repository's default branch. Never merge a PR stacked on another PR's branch into that branch: once the base PR merged, retarget it to the default branch first. Never use `gh pr merge --auto`, which merges at once where checks are not required. To merge when the checks go green, set a `merge` watch (above); to merge now, name the head commit you checked (`gh pr merge --squash --match-head-commit <sha>`). With mero-bot, use its `merge` tool: a raw `gh pr merge` in its shell is refused.

`fireWatch`, `finishWatch`, `watchSeen` and `recordPr` are the runtime's, not a model turn's. The runtime records what it sees of the PRs a task links to with `recordPr(input)` (one row per `owner/name#number`: state, draft, base and default branch, conflicts, head sha, checks with the failing ones named, the PR it is stacked on) so the app's PR card can show a safe merge button; `prs(chain)` lists them.

### Keep to the user's standing rules

- `settings` returns `rules`: short lines the user wants every agent to keep on every turn ("Never push to main"). It also returns `agent_rules`: lines for one agent only, each with the `agent` name it is for. Keep to every one of `rules`, then to the `agent_rules` whose `agent` is the name you report in with `agentSeen`; another agent's are not yours. Read them when you start and on `SettingsChanged`.
- After the user corrects you in a way that should hold from now on, suggest a rule with `proposeRule` (`text`: one line, `why`: the correction, `chain`: where it happened). It waits for the user's one-tap Approve; only they add, remove or approve rules.

### Never

Never call `say`, `resolveAction`, `answerNotification`, `decideLens`, `setPolicy`, `setGuard`, `setPaused`, `addRule`, `removeRule`, `addAgentRule`, `removeAgentRule`, `approveRule`, `dismissRule`, `archive`, `unarchive`, `markSeen`, `markAllSeen` or `stopAutorun`. Do call `agentSeen(name)` about every 30 seconds while you run.
Those are the user's decisions.
