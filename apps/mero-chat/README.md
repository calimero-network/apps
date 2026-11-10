# Mero Chat

Team chat: workspaces with public and private channels, threads, reactions,
mentions, direct messages, drafts, read positions, moderation roles, files and
images. A component app on Calimero 1.0: the contract is on core's component SDK
(`calimero-sdk`, `wasm32-wasip2`), local development runs on `merod local`,
and the frontend talks to the local nodes in development and to Calimero Cloud
in production through mero-js's `CalimeroClient` (`@calimero-apps/connect`). See
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract, one conversation per instance (a standalone crate: its own `[workspace]` and `Cargo.lock`) |
| `logic/tests/` | `harness.rs` (every method on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | `chat.json` (v1's merobox workflow), `access.json` (the org's gate, guests, bans, forged writes); run by `cargo test` and on `merod local` |
| `app/` | Vite + React frontend |
| `mobile/` | native iOS and Android apps, **still v1** (see [Mobile](#mobile)) |

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a workspace | an organization | a namespace |
| a channel | an instance of this app in the workspace's org: access `team` on chat's app team (public; `org` in a workspace without one) or `accounts` (private: its creator and the people added) | a subgroup (open or restricted) with one context in it |
| a DM | an instance named `DM_CONTEXT_…`, access `accounts` [the other person] | a restricted subgroup of two |
| joining | an org invite link (`?invite=<token>`) naming chat's app team, redeemed after a passkey sign-in | a namespace invitation link, then joining each channel's context and waiting for it to sync |
| who is in the workspace | chat's **app team** (below); without one, every org member | the namespace's members |
| who you are | an account, signed in with a passkey; the same id in every channel | a node, and a member key per context |
| a workspace name for a person | org member metadata `{ name }` | namespace member metadata |

### Chat's app team

An organization can hold several apps, each with its own **app team** (core#4890,
`appTeams` in `@calimero-apps/connect`; see Calimero Home's README). A
workspace created in Chat gets Chat's team at once, open (`standalone`:
everyone in the org has Chat, and members may invite). Open channels use
`{ kind: "team" }` on it, invites name it (`inviteToApp`), and the member lists
read it (`appTeamMembers`). Once an admin keeps the org's apps apart in
Calimero Home (`shared`: closed teams), a Chat invite gives Chat only, the
member lists show Chat's people, and Remove takes someone out of Chat (its team
and the private channels that list them), not out of the org.

- A workspace from before app teams stays **legacy** (organization access)
  until an admin chooses "Give it its own access list" in Calimero Home, which
  moves its open channels onto the team with everyone kept. Chat never
  converts one by itself.
- Adding Chat to an organization whose apps have teams makes Chat's team
  first: owners and admins only (core refuses anyone else), open in a
  standalone org and closed in a shared one; another app's team is never
  closed from Chat.
- Private channels and DMs keep `accounts` access. The design moves private
  channels to a restricted child team, but core lets only the app team's leads
  and admins create one, so a member could no longer make a private channel.
- **Leave workspace** in a shared org leaves Chat's team only; when Chat was
  the person's last app there, they are asked whether to leave the org too.
  In standalone and legacy orgs Leave is leaving the org, as before.
- These paths go through `@calimero-apps/connect`'s org-app module
  (`createAppOrg`, `orgWideAccess`, `appInvite`, `appPeople`, `removeFromApp`,
  `leaveApp`, `leaveOrg`); `scripts/check-org-app-module.py` keeps it so.
- Under `pnpm dev:local` chat runs from a raw bundle, which no package ships,
  so it has no app team and every workspace is legacy there.

A channel reaches who its access names; anyone else is refused before the
contract runs (`404 NOT_FOUND` for an outsider, `401 UNAUTHENTICATED` anonymous).
Inside a channel the contract decides the rest: admins, moderators, members and
banned members, as in v1.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-chat     # merod local + the contract + the app on http://localhost:5173/
```

Sign up with a passkey, create a workspace (it starts with `#general`), and
chat. To try a second person, open the workspace's invite link in another
browser profile.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo fmt --manifest-path apps/mero-chat/logic/Cargo.toml -- --check
cargo clippy --manifest-path apps/mero-chat/logic/Cargo.toml --all-targets -- -D warnings
cargo clippy --manifest-path apps/mero-chat/logic/Cargo.toml --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path apps/mero-chat/logic/Cargo.toml       # harness + scenarios
cargo run --release --manifest-path $M -- build apps/mero-chat/logic   # res/abi.json
pnpm merod-local e2e mero-chat                                   # the scenarios on merod local
pnpm -F mero-chat lint && pnpm -F mero-chat typecheck && pnpm -F mero-chat test && pnpm -F mero-chat build
```

## What changed in the port, and why

### Storage

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `Frozen<Founding>` + `SharedStorage<ChannelText>` (writers: the admins) | `founding: Cell<Founding>`, `info: Cell<ChannelText>`; `updateInfo` checks the caller is an admin |
| `AuthoredVector<Message>`, the sender = the slot's owner stamp | `messages: Vector<StoredMessage>`, `sender` a field set from `env::caller()`; the position is still the stable cursor |
| `WriteOnce<UnorderedMap<MessageId, Slot>>` and the "lowest genuine pointer" pick | `messageIds: UnorderedMap<String, Slot>` |
| `Moderated<SortedMap<String, Message>>` keyed `"parent␟ts␟id"` | `threads: UnorderedMap<(parent, timestamp, id), StoredMessage>`, one thread one prefix; `threadStats: UnorderedMap<parent, {count, last}>` kept on every insert and removal |
| `AuthoredSortedMap<"msg␟emoji␟account", ()>` | `reactions: Set<(message, emoji, account)>` |
| `UserStorage<StoredProfile>` | `profiles: UnorderedMap<account, Profile>`, only the caller's row is written |
| `AccessControl` (admin tier + `"mod"` role) + `SharedStorage` ban and hidden sets, writer sets rotated by `sync_staff` | `admins`, `mods`, `banned`, `hidden: Set<String>`; the app's owner is the first admin |
| `UserStorage<LwwRegister<u64>>` read receipts | `readReceipts: PerUser<u64>` |
| `#[app::private] Drafts` (node-local) | `drafts: UnorderedMap<(account, channel), String>`, read and written only for the caller |
| `#[app::mergeable]` rules, `LwwRegister`s, per-owner keys, holder matching | gone: one leader orders every write in one log |
| `#[derive(Searchable)]` + `app::search_indexes!` | not at `1.0.0-rc.7` (see below) |
| `BlobId` + `env::blob_announce_to_context` | the blob id as a checked string (see below) |

Every bounded list inside a stored message states and enforces its bound: at
most 100 mentions, 10 files and 10 images. The write rules v1 enforced in
storage are checks in each method against `env::caller()`: only the sender edits
a message or blanks it, only staff remove someone else's, only admins grant
roles, a moderator only bans or unbans a plain member, an admin never demotes
themselves, and a banned member's writes are refused (`Banned`).

### What a client sees

| | v1 | now |
|---|---|---|
| method and argument names | `send_message`, `parent_message`, … | the same methods, camelCase: `sendMessage`, `parentMessage`, `messageId`, `newMessage`, `parentId`, `searchTerm`, `mentionsUsernames`, `creatorUsername`, `contextType`; `AttachmentInput` is `{ name, mimeType, size, blobIdStr }` |
| 64-bit integers | JSON numbers | decimal strings: `timestamp` and `start` arguments; `getMessageCount`, `messagePosition`; `index`, `timestamp`, `editedOn`, `threadLastTimestamp`, attachment `size` / `uploadedAt`, `createdAt`, hit timestamps. Counts that are `u32` (`totalCount`, `startPosition`, `threadCount`, unread counts, `matchStart`/`matchEnd`) stay numbers |
| result fields | snake_case | camelCase |
| accounts | base58 `UserId`s (32 bytes) | the node's account ids, as strings: `sender`, `mentions`, `identity`, `target`, reaction lists, `creator` |
| `init` | `name, context_type, description, created_at, creator_username`, all required | all optional (a harness or `merod local` creates the app with none); `createdAt` is the log's clock in seconds, `creator` the app's owner |
| message ids | `sha256(account ‖ text ‖ ts ‖ counter)` hex + `_<ts>` | 16 random bytes of the run, hex, + `_<ts>` |
| `sendMessage` / `editMessage` | the stored message | the full rendered message (index, reactions, thread info, `parentMessageId` for a reply) |
| `getMessages` / `getMessagesFrom` without a `limit` | everything | at most 1,000 (the SDK's page); `limit` is capped there too |
| `getProfiles`, each role set of `listRoles`, reactions per message | every entry | at most 1,000 |
| errors | `FunctionCallError` with a message string | `422 APP_ERROR`: `Invalid`, `Forbidden`, `NotFound`, `Banned`, each `{ message }` with v1's text |
| events | tuple payloads (`ReactionUpdated("id")`) | named fields: `MessageSent { messageId }`, `MessageSentThread { messageId }`, `ReactionUpdated { messageId }`, `MessageEdited { messageId }`, `ProfileUpdated { account }`, `RoleUpdated { account }`; `Initialized`, `InfoUpdated` carry nothing; all to `Audience::All` (org guests included; ids only) |
| `searchMessages` | the node's full-text index; hits without `index`, ranked by their own timestamp | the bounded walk, the same answer as `searchMessagesScan`: hits carry `index`, a reply is ranked with its thread (`anchorTimestamp`) |
| attachments and avatars | a `BlobId` (hex or legacy base58), announced to the context | 64 lowercase hex characters (`Invalid` otherwise); nothing to announce; `uploadedAt` in milliseconds of the log's clock |
| drafts | node-local (`#[app::private]`) | rows in the app's state on the cluster (sealed, attested nodes), only ever read for the caller; at most 20,000 bytes |
| a staff removal of a reply | the reply left the thread | the same, and its reactions go with it; it then answers `NotFound` |
| `editMessage` / `deleteMessage` with the wrong `parentId` | not found | `NotFound` |
| migrations | none | none (the component SDK has none yet) |

Everything else (the 20,000-byte message, 64-byte emoji, 100-byte name, 1,000-byte
description, 50-character username and 256-byte search limits; 300 s of clock
skew; the unread window of the newest 500 messages; the username frozen after the
first `setProfile`; search pages of 20 by default and 50 at most, stopping after
2,000 rows or 1 MiB of text) is as in v1.

### What `1.0.0-rc.7` does not have

The pinned core tag predates two features this app used, which landed in core
right after it (#4815 blobs, #4816 search, not in any tag yet):

- **Blobs for component apps.** A node at rc.7 answers `POST /apps/{app}/blobs`
  for a component app with `409 NOT_SUPPORTED`. The contract keeps the blob id
  of every attachment and avatar exactly as v1 did, and the frontend uploads and
  downloads through `CalimeroClient.uploadBlob` / `downloadBlob` of the
  channel's own instance; until the pin moves, an upload says "Attachments need a
  Calimero node with blob support for component apps" and messages work as
  before. Moving to a release with #4815 needs no change here (its `BlobRef`
  travels as the same 64-hex id; adopting it gives host-tracked retention).
- **The full-text index.** `searchMessages` answers by the same bounded walk as
  `searchMessagesScan` (newest first by position, each message followed by its
  thread; a page stops at `limit` hits, 2,000 rows or 1 MiB of text and hands back
  a cursor). Text is matched as a reader sees it and folded for case, accents
  and width as mero-docs folds it. With #4816 it can go back to the index.

### Frontend

The screens, their layout and their copy are unchanged; what changed is the
layer under them.

- `MeroProvider`, mero-react, mero-platform(-react), the node login and Cloud
  wallet popup, the desktop SSO token hand-off, `MeroJsBridge`, the registry
  app-id lookup and install offer, and the `links.calimero.network` invitation
  codec are gone. `src/api/calimero.ts` is the session (`@calimero-apps/connect`:
  passkey sign-in/up, stored per app and per target) and the conversation on
  screen; `pages/Login/SignInPopup.tsx` is the sign-in.
- `src/api/meroChat.ts` is the typed contract client and the **one adapter** for
  it: `ClientApiDataSource` still calls v1 method names with v1 arguments, and
  the adapter sends the ABI's names and turns the answers back into v1's shapes
  (snake_case, numbers). `meroChat.test.ts` checks its method list, call/view
  kinds and argument names against the committed `logic/res/abi.json`.
- `src/api/platform.ts` maps v1's namespaces, subgroups and contexts onto orgs
  and instances, and `GroupApiDataSource` / `ContextApiDataSource` keep the
  method names every hook calls. v1 made a channel in steps (subgroup,
  visibility, members, context); those steps are held as a pending channel and
  the instance is created, with its access and `init` arguments, when the
  context is. Adding someone to a private channel changes its access (the
  channel's creator, as the instance's owner, may).
- Invitations are org invites: minting one is a passkey step-up for the inviter;
  the link carries the token, `main.tsx` takes it off the address bar before
  sign-in, and `InvitationPrompt` redeems it after.
- Live updates are `CalimeroClient.events` per open conversation
  (`src/api/events.ts`), passed to the existing handlers in v1's event shape; a
  dropped stream reconnects from where it stopped and triggers the existing
  reconnect resync. Typing and online state are the node's presence channel
  (`src/api/presence.ts`).
- There is nothing to join or sync: a channel is readable as soon as its access
  names you. Leaving a channel hides it locally, as before; "leaving" for good
  is the channel owner's access change. TEE members, namespace upgrades (an
  org's instances are upgraded from the package release) and moving a channel
  between workspaces have no 1.0 counterpart here.
- The Playwright suites (mocked, live node, journey, media recorder) are removed:
  the end-to-end run is `pnpm merod-local e2e mero-chat`, and the screens keep
  their unit tests with a mocked client. The landing page's spec stays
  (`scripts/landing` generates it).

## Mobile

`mobile/ios` and `mobile/android` are **unchanged and still v1**: they are built
on the v1 Swift and Kotlin SDKs (relay, contexts, namespace invitations, the v1
contract's methods), and the pinned SDKs have no 1.0 client to port them to yet.
They work only against a v1 deployment of the app until those SDKs speak the 1.0
API. Their live suites bundle the contract for a v1 relay, so the live workflows
restore the last v1 `logic/` from history first, and no longer run on changes to
`logic/` (see [`mobile/README.md`](mobile/README.md)).

## Production

The production frontend is the one bundled into the `.mpk` (`frontend-dir`), so
the cluster serves it from the package's own origin, where passkeys work. Build it
with `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (see
`app/.env.example`); without them the production build refuses to connect.
