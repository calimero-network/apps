# Only Peers

## Introduction

This project is a demo of Only Peers with Calimero Network. More information about Only Peers can be found in our [docs](https://calimero-network.github.io/tutorials/awesome-projects/only-peers/).

## Logic

```bash title="Terminal"
cd logic
```

```bash title="Terminal"
chmod +x ./build.sh
```

```bash title="Terminal"
./build.sh
```

## React Vite App

```bash title="Terminal"
cd app
```

```bash title="Terminal"
pnpm install
```

```bash title="Terminal"
pnpm build
```

```bash title="Terminal"
pnpm dev
```

## Setup

- Start your node with auth enabled - [docs](https://calimero-network.github.io/build/quickstart)
- Follow instruction to create context for your node - [instructions](https://calimero-network.github.io/tutorials/install-application/#create-new-context)
- Open app in browser on default url `http://localhost:5174/only-peers-client/` and follow login instructions.

For more information how to build app check our docs:
https://calimero-network.github.io/build/quickstart

## Owned keys are per owner (core 0.11.0-rc.57)

Since core 0.11.0-rc.57 every owned collection (`Authored…`, `WriteOnce`, `Moderated`,
`ModeratedOnce`) is one namespace per account: two accounts writing one key hold two
independent entries, and a key-only `get`, `contains`, `owner_of`, `owned_by_me` or `remove`
acts on the CALLER's own entry only. This app was migrated:

Post and comment ids are 16 random bytes, so a second holder of one only exists if a
patched node copied it. Every read by id (`get_post`, commenting, voting, the paging
cursors) takes the entry of the **lowest account** holding the id — the same pick on
every node. A feed row's author is recovered by matching the row against the holders of
its id. Editing and deleting act on the caller's own post; `moderate_post` and
`moderate_comment` remove **every** holder's entry at the id with `remove_by` (a key-only
`remove` would remove only the moderator's own, i.e. nothing).

Votes: a tally reads each distinct key `"<subject>|<account>"` once, as the entry of the
account the key names (`get_by`), so a row filed under someone else's key never counts
and a key two accounts hold never counts twice. Test: `a_post_id_two_accounts_hold_is_two_posts`.
