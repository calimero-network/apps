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

### Answer the user's messages

The user talks to you from the feed, about one chain or about anything.

- `MessagePosted` with `from: "you"`: read the message with `item`, and the chain it is in with `chain`.
- Take it up at once with `agent_ack` (`status: "thinking"`), so the user sees you are on it.
- Answer with `agent_say`: the message's `chain`, its `id` as `reply_to`, and your answer as `text`.
- If your answer leaves something to the user (a question, a choice of next steps, "want me to…?"), answer with `agent_ask` instead: the same arguments plus an `ask` of kind `choose` (2 to 8 `options`) or `reply` (a `prompt`). The chain then stays in the user's To do until they answer, and their answer arrives as their next message in the chain. Use `agent_say` only when the work is done.
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

### Never

Never call `say`, `resolve_action`, `answer_notification`, `decide_lens`, `set_policy`, `set_guard`, `set_paused`, `archive`, `unarchive`, `mark_seen` or `mark_all_seen`. Do call `agent_seen(name)` about every 30 seconds while you run.
Those are the user's decisions.
