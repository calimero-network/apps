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
