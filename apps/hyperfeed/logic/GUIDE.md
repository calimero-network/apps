# Hyperfeed

## Overview

Hyperfeed is the user's feed of everything an agent does on their behalf, beside every notification their apps send them.
It is also where they set what the agent may do, and where they approve, answer and undo.
If you are an agent acting for this user in their Calimero apps, this feed is where you report and where you ask.

- An **action** is something you did, or want to do: an app, a method, a title the user reads, and your reason (`why`).
- A **notification** is something an app sent the user. It may carry an **ask**: how the user answers it in place (`reply`, `choose`, `confirm`).
- Every row belongs to a **chain**: the id of the row that led to it. The user sees a chain as one expandable flow.
- Every row keeps its **history** of steps (`status`, `note`, `at`). An action goes `pending → approved → done`, or `failed`, `declined`, `undo_requested`, `undone`. A notification goes `received → answered → delivered` or `failed`.

## Context model

- A feed is one context of this app, created by the user. Usually there is exactly one on the node, and only its owner writes to it.
- You write as the node's own identity, which is the owner when the feed was created on this node.
- The feed takes no init arguments.

## Getting started

1. `list_contexts` for the package `com.calimero.hyperfeed` and take its one context (ask the user if there are several).
2. `select_app` with that context; keep the `app_handle`.
3. Read the user's rules with `settings`.

## Procedures

### Before writing in another app

Call `check_action` with the app's short key (`chat`, `crm`, `kv-store`: the package's last segment without `mero-`), a guard category (`sign`, `money`, `new_contact`, `delete`, `invite`, `secret`, or `""`) and `writes: true`.

- `act`: do it, then `record_action` with `outcome: "done"` (or `"failed"` with a `note`).
- `ask`: do not do it. `record_action` with `outcome: "proposed"` and wait for the user's decision.
- `refuse`: do not do it, and do not propose it.

```json
{ "app_key": "chat", "category": "", "writes": true }
```

### Record an action

`record_action` takes one `input`. Every field is required; use `""` when there is nothing to say.
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

A write that has no row of its own (a step you report with `agent_work` on the user's message) names its subject with `touch_subject(chain, subject)`.

### Propose something the user resolves in one tap

Use an `ask` on a proposal:

- `reply` with a `draft`: the user edits your text and approves.
- `choose` with 2 to 8 `options`: the user picks one, and the pick approves the proposal.
- `confirm` with a `prompt`: one button.

The user's answer arrives as the action's `note` when its status becomes `approved`.

### Carry out what the user decided

Watch the feed's events, or read with `item`:

- `ActionChanged` with `approved`, `retrying` or `undo_requested`: do it (use the `note` exactly when there is one), then `complete_action` with `done` or `failed` and a one-line `note`.
- `NotificationChanged` with `answered`: the `note` is the user's answer. Send the reply, cast the vote, or confirm in the source app, then `complete_answer` with `delivered` or `failed`.
- A row with `superseded_by` set is a question a newer one in its chain replaced before the user answered it. If an answer still reaches it (a notification `answered` with `superseded_by`, or a message of theirs with `answers_superseded: true`), they answered an old question: confirm against where things stand now before acting on it.

### Answer the user's messages

The user talks to you from the feed, about one chain or about anything.

- `MessagePosted` with `from: "you"`: read the message with `item`, and the chain it is in with `chain`.
- A message may carry images in `attachments` (`blob_id`, `name`, `mime`, `size`), and then its `body` may be empty. Each is a blob on the node, announced to this feed's context: fetch it by `blob_id` and look at it before you answer.
- Take it up at once with `agent_ack` (`status: "thinking"`), so the user sees you are on it.
- While you work, report your latest step with `agent_progress` (`id`, `doing`: "Running the tests", "Editing ChatView.tsx"). Each call replaces the last, so send one when your step changes, not a log.
- Better, report the whole turn with `agent_work` (`id`, `steps`: every step so far, each `{ id, title, status, at }` with status `running`, `waiting`, `done` or `failed`; `draft`: the answer written so far). Each call replaces the last; the user sees the steps in a Working… block under their message and the answer as it is written, and no step becomes a row of its own.
- The user can press Stop: `StopRequested { id }` (and the message's `stop_at`) means end the turn at once and mark the message with `agent_ack` (`status: "failed"`, `note: "Stopped by you"`).
- Answer with `agent_say`: the message's `chain`, its `id` as `reply_to`, and your answer as `text`.
- A long answer (a report, a list, more than a few lines) takes a `headline`: one line of at most 80 characters saying what it is. The feed row shows the headline with the text behind "More", the chat shows the whole text, and `text` may then run to 32 KB. Without a headline `text` keeps to 2000 bytes. `agent_ask` takes a `headline` too.
- If your answer leaves something to the user (a question, a choice of next steps, "want me to…?"), answer with `agent_ask` instead: the same arguments plus an `ask` of kind `choose` (2 to 8 `options`) or `reply` (a `prompt`). The chain then stays in the user's To do until they answer, and their answer arrives as their next message in the chain. Use `agent_say` only when the work is done. Asking again in the chain replaces your earlier open question there: its buttons go, and only the newest one waits on the user.
- If they want something done, do it the way you do anything: `check_action` first, then act or propose, with `chain` set to the message's chain so it shows in the same conversation.
- If you cannot answer, `agent_ack` with `status: "failed"` and a one-line `note` saying why.
- When you start, `open_questions` lists the messages still waiting on you.

```json
{ "chain": "<message chain>", "reply_to": "<message id>", "text": "Here is a more formal draft." }
```

### Teach the feed an app (a lens)

A lens tells the user's feed which of an app's events matter to them, as which item type, and how
their answer goes back. You write it from the app's ABI; the user approves it.

- `lenses` lists every lens, by app and application id, with its status.
- Write the lens as JSON: `{ "version": 1, "events": { "<Event>": { "type", "read"?, "let"?, "show_if"?, "fields", "title"?, "ask"?, "reply"? } | "ignore" } }`. A string starting with `=` is an expression.
- Record only what concerns the user, never what they did themselves (`mine(...)`), and name every event the app emits.
- `propose_lens` with `app_key`, `application_id`, the lens as a JSON string, and one sentence for the user. It waits for their approval. With mero-bot, propose through its `propose_lens` tool, which checks the lens against the ABI first.

### One session per chain

Before you start work on a chain, `claim_chain(chain, session, ttl_ms, agent)` with your session's own id and a name ("mero-bot@host"). It is refused while another session holds an unexpired lease: leave that chain to it. Renew with `renew_chain` while you work and `release_chain` at the end; a lease that runs out (a session that died) can be claimed again.

### Leave a checkpoint on a task

A session can end mid-task. So the next one can pick the task up, keep a checkpoint on its chain:

- Before you act on a chain, read `checkpoint(chain)`. If there is one, resume from its `next` step; check its branches, worktrees and PRs are still where it says.
- At each milestone (a plan made, a branch pushed, a PR opened, tests green) and before you stop with work outstanding, `set_checkpoint(chain, input)`. Each write replaces the last.
- `input` is `{ done, next, branches, worktrees, prs, questions, author }`: `done` and `next` up to 1000 bytes each (at least one of them), each list up to 10 one-line entries of up to 300 bytes, `author` your name ("mero-bot@host"). Say only what a fresh session needs, not a log.

```json
{ "chain": "<chain>", "input": { "done": "Found the bug in ChatView; fix written", "next": "Run the app tests, then open a PR",
  "branches": ["mero-bot/chain-1a2b"], "worktrees": ["/Users/me/workspace/apps-chain-1a2b"], "prs": [],
  "questions": [], "author": "mero-bot@studio" } }
```

### Wait for something, then act: set a watch

"Merge #434 when it's green" or "watch main and fix it if red" is a watch in the feed, not a loop in your session: a session ends, a watch does not.

- `add_watch(input)` with `input` `{ chain, condition, repo, pr, branch, action, text, agent }`. `condition` is `pr_green` (every check on the PR passed), `pr_red` (one failed), `pr_merged`, `branch_green` or `branch_red` (CI on a branch's head; `branch: ""` is the default branch). `pr` is the PR's number for `pr_*` and 0 otherwise. `action` is `merge` (with `pr_green` only), `turn` (start an agent turn in the chain with `text` as its instructions) or `notify` (tell the user `text` in the chain). `repo` is `owner/name`. The same watch twice is kept once; at most 50 wait at once.
- `watches(chain)` lists them (`""`: every chain) with `status` (`watching`, `firing`, `done`, `failed`, `cancelled`), `seen` (where the condition stood when last looked at) and `note` (how the action went). `cancel_watch(id, note?)` cancels one still `watching`.
- The agent's runtime, not a model turn, polls them (mero-bot does, through `gh`, about every 45 s). When a condition is met it first calls `fire_watch(id, session)`, which moves `watching → firing` and is refused for any other status, and acts only if that succeeded: exactly one session acts, once, even after a restart. Then `finish_watch(id, "done" | "failed", note)`. `watch_seen(id, seen)` records where a condition stands. A merge keeps the safe-merge rules at that moment: the PR is open, not a draft, has no conflicts, every check passed, and its base is the default branch; a stacked PR (based on another PR's branch) is refused.

```json
{ "input": { "chain": "<chain>", "condition": "pr_green", "repo": "calimero-network/apps", "pr": 434, "branch": "",
  "action": "merge", "text": "", "agent": "mero-bot@studio" } }
```

With mero-bot, set them through its `watch`, `unwatch` and `watches` tools.

### Merge a PR only by the safe-merge rules

Merge a PR only when it is open, not a draft, free of conflicts, every check passed, and its base is the repository's default branch. Never merge a PR stacked on another PR's branch into that branch: once the base PR merged, retarget it to the default branch first. Never use `gh pr merge --auto`, which merges at once where checks are not required. To merge when the checks go green, set a `merge` watch (above); to merge now, name the head commit you checked (`gh pr merge --squash --match-head-commit <sha>`). With mero-bot, use its `merge` tool: a raw `gh pr merge` in its shell is refused.

`fire_watch`, `finish_watch`, `watch_seen` and `record_pr` are the runtime's, not a model turn's. The runtime records what it sees of the PRs a task links to with `record_pr(input)` (one row per `owner/name#number`: state, draft, base and default branch, conflicts, head sha, checks with the failing ones named, the PR it is stacked on) so the app's PR card can show a safe merge button; `prs(chain)` lists them.

### Keep to the user's standing rules

- `settings` returns `rules`: short lines the user wants kept on every turn ("Never push to main"). Read them when you start and on `SettingsChanged`, and keep to every one.
- After the user corrects you in a way that should hold from now on, suggest a rule with `propose_rule` (`text`: one line, `why`: the correction, `chain`: where it happened). It waits for the user's one-tap Approve; only they add, remove or approve rules.

### Never

Never call `say`, `resolve_action`, `answer_notification`, `decide_lens`, `set_policy`, `set_guard`, `set_paused`, `add_rule`, `remove_rule`, `approve_rule`, `dismiss_rule`, `archive`, `unarchive`, `mark_seen` or `mark_all_seen`. Do call `agent_seen(name)` about every 30 seconds while you run.
Those are the user's decisions.
