# Calimero Calimero Chat

[![Rust](https://img.shields.io/badge/rust-1.89+-orange.svg)](https://www.rust-lang.org/)
[![Version](https://img.shields.io/badge/version-0.0.1-blue)](https://github.com/calimero-network/calimero-curb-chat)

A chat application built on the Calimero Network, enabling private, decentralized messaging.

## Quick Start

### Prerequisites

- [Rust 1.89+](https://www.rust-lang.org/tools/install)
- [pnpm](https://pnpm.io/installation)
- [merobox](https://www.piwheels.org/project/merobox/) (optional, for workflows)

### Build and Run

```bash
# Build the logic (Rust WASM). cargo-mero comes from the same core release as
# the SDK pinned in the monorepo's root Cargo.toml:
#   cargo install --git https://github.com/calimero-network/core --tag <sdk tag> cargo-mero --locked
cd logic
cargo mero build -p mero-chat

# Start the app
cd ../app
pnpm install
pnpm run dev
```

Open the app in your browser and connect to a running Calimero node.

## Logic

```bash title="Terminal"
cd logic
```

```bash title="Terminal"
cargo mero build
```

## App

```bash title="Terminal"
cd app
```

```bash title="Terminal"
pnpm install
```

```bash title="Terminal"
pnpm run build
```

```bash title="Terminal"
pnpm run dev
```

Open app in browser and connect to running node.

For more information how to build app check our docs:
https://calimero-network.github.io/build/quickstart


## Search

`search_messages(query, cursor, limit)` asks the node's full-text index of the
channel (core's per-context search): top-level messages and thread replies,
newest first by their own timestamp, a substring match from 3 characters (a
prefix match below that), folded for case and accents. It reads only the page
of hits, so a query costs the same in a channel of 2,000 messages or 200,000.
A deleted message leaves the index; a staff-removed one is dropped when its
hit is read back. Message text is
editor HTML, so the index holds it as the plain text a reader sees. A hit's
`index` is `null`: `message_position(message_id)` gives the position to open
it at, and the app asks when a hit is clicked.

A node running with search off cannot answer from an index, and says so; the
app then calls `search_messages_scan`, which answers the same question without
one, as described below.

`search_messages_scan(query, cursor, limit)` walks the channel newest first by
position, each top-level message followed by its thread, and returns slim hits
(id, parent id, position, timestamps, sender, a plain-text snippet with the
match offsets) plus an opaque `next_cursor`. One call stops at `limit` hits
(default 20, max 50) or after reading 2,000 messages or 1 MiB of text, so a
common term in a big channel costs one page, never the channel. Text is matched
as it is shown (markup dropped) and folded for case, accents and width as
mero-docs' `foldForSearch` folds it. Deleted and staff-removed messages are
never found. The app asks every conversation for a page, merges the pages
newest first by each page's `frontier_timestamp`, and "Load more" continues each
conversation from its own cursor.

Gas per call, measured through the real runtime (calimero-runtime
0.11.0-rc.57, metered wasm, in-memory store; `needle` is in 1% of messages and
10% of replies, `w5` in 2%, `zebrafish` in none; the budget is 1e9):

| call | 2,000 msgs before | after | 5,000 msgs before | after |
| --- | ---: | ---: | ---: | ---: |
| `get_message_count` | 93M | 93M | 201M | 201M |
| `get_messages` newest 50 | 124M | 109M | 251M | 217M |
| search `needle`, first page | 192M | 205M | 446M | 312M |
| search `zebrafish`, first page | 184M | 241M | 426M | 348M |
| search `w5`, first page | 193M | 173M | 447M | 280M |

"Before" is `search_all_messages` (every match, rendered in full); "after" is
one `search_messages` page. The old cost is ~90k gas per message in the channel
and reaches the budget near 10k messages; a page adds at most 2,000 rows to the
fixed cost below.

That fixed cost is core's, and it bounds this app today: on rc.57 any call that
touches `messages` walks the vector's whole child trie (`get_message_count`
alone is ~40k gas and ~1.6 storage reads per message in the channel), and
`send_message` costs 658M gas at 2,000 messages and 1.55G at 5,000, so sends
exceed the default budget near 3,200 messages. Search cannot fix that from the
contract.

## Workflows

The `workflows/` folder contains an example bootstrap workflow that demonstrates the complete setup process with the following steps:

1. Initialize Node 1 and Node 2
2. Install Calimero Chat application and create context from Node 1
3. Invite Node 2 to join the context from Node 1
4. Join the context from Node 2
5. Join the chat from Node 2
6. Send a message from Node 1
7. Send a message from Node 2
8. Fetch messages from Node 1

To run this workflow, you need to install [merobox](https://www.piwheels.org/project/merobox/) on your machine and execute:

```bash title="Terminal"
merobox --version
> merobox, version 0.1.13
merobox bootstrap workflows/bootstrap.yml
> ...
> 🎉 Workflow completed successfully!
```

## Owned keys are per owner (core 0.11.0-rc.57)

Since core 0.11.0-rc.57 every owned collection (`Authored…`, `WriteOnce`, `Moderated`,
`ModeratedOnce`) is one namespace per account: two accounts writing one key hold two
independent entries, and a key-only `get`, `contains`, `owner_of`, `owned_by_me` or `remove`
acts on the CALLER's own entry only. This app was migrated:

- A message id's pointer (`message_ids`) is read across holders: each pointer is checked
  against its own recorder, and the lowest account whose pointer holds wins.
- A thread reply's sender is recovered among the holders of its key by the entry's bytes.
- Staff deleting someone's reply remove every holder's entry with `remove_by`; a key-only
  `remove` would remove only their own.
- Reactions are counted once per key, as the entry of the account the key names; a copy
  another account files under that key is ignored.
