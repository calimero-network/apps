# Mero Chat

Team chat on Calimero 1.0: workspaces, public and private channels, threads,
reactions, mentions, edits, file and image attachments, search, drafts, unread
counts, roles and moderation, typing indicators, and direct messages.

- **Contract** (`logic/`): one conversation (a channel or a DM) as a
  `calimero:app` WebAssembly component on core's component SDK
  (`calimero-app-sdk`, `wasm32-wasip2`, core `1.0.0-rc.8`).
- **Frontend** (`app/`): React + Vite, mero-js `CalimeroClient` through
  `@calimero-apps/connect`: the local `merod local` cluster under `vite`, a
  Calimero Cloud cluster in a production build.
- **Native apps** (`mobile/`): iOS and Android clients that still speak the v1
  relay API; not ported (see [`mobile/README.md`](mobile/README.md)).

How the nouns map:

| v1 | 1.0 |
|---|---|
| workspace (namespace / group) | an **organization** |
| channel (a context in a subgroup) | an **app instance** of `com.calimero.chat` in the org, `org` access (every member reaches it), named `#<name>` |
| private channel (restricted subgroup + allowlist) | an app instance with `accounts` access (its creator and the members it adds), named `private:<name>` |
| DM (two-member subgroup + context) | an app instance with `accounts` access (the two people), named `dm:<account>:<account>` |
| identity per context (base58 / hex keys) | the **account** (one id everywhere: `sender`, reactions, mentions, roles) |
| node login, desktop SSO, mero-react | a **passkey** account on the cluster |
| group invitation link (`?invitation=`) | an **org invite** (`?invite=<token>`, made with the inviter's passkey, redeemed after sign-in) |
| a member's namespace alias | the org's member metadata `{ name }` |
| SSE subscription per context | `client.events(app, from)` for the open conversation; others' unread counts are polled |
| `useEphemeral` presence | the node's presence API (`publishPresence` / `presenceStream`) |

## Run it

```bash
rustup target add wasm32-wasip2
pnpm install
pnpm dev:local mero-chat          # merod local + build + deploy + the app on http://localhost:5173/
```

Sign up with a passkey, create a workspace (it starts with `#general`),
invite a second browser profile with **Invite** (a link with `?invite=`),
and chat. `merod` comes from core's `1.0.0-rc.8` release, see
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/mero-chat/logic/Cargo.toml        # search unit tests, harness, scenarios
cargo run --release --manifest-path $M -- build apps/mero-chat/logic   # res/mero_chat.wasm + res/abi.json
pnpm merod-local e2e mero-chat                                     # scenarios/*.json as real accounts on merod local
pnpm -F mero-chat lint typecheck test build
```

- `logic/tests/harness.rs`: every method on core's real wasmtime engine
  (`TestApp`): v1's `TestHost` tests method for method, the storage-level write
  rules v1 relied on as the same calls made by an account the method refuses,
  blobs, search (index and scan), paging bounds, access (anonymous `401`,
  outsider `404`, guests) and the wire (camelCase names, `BadArgs`,
  `NotAView`).
- `logic/scenarios/chat.json` (from merobox `e2e.yml` and
  `integration-setup.yml`) and `access.json` (forged writes, moderation, who
  reaches the app): run by `cargo test` and on the cluster by CI's e2e job.
- `app/src/calimero/chat.test.ts` asserts the frontend's method list and
  parameter names are exactly the committed `logic/res/abi.json`'s;
  `App.test.tsx` drives sign-up, the workspace picker and invite redemption
  with a mocked client.

## The contract

State (all plain data: one leader applies every write in one log, so there is
nothing to merge):

| field | what |
|---|---|
| `info: Cell<Info>` | name, `Channel`/`Dm`, description, `createdAt` (seconds), creator |
| `messages: Table<Message>` | every message, top-level (`parent = ""`) and reply; index `thread(parent, seq)`, count `perThread(parent)`, full-text `search = ["search_text"]` (the text a reader sees, folded for case and accents) |
| `nextSeq: UnorderedMap<parent, u64>` | a message's position among its parent's: the stable `index` clients page and resume by |
| `extras: UnorderedMap<id, Extras>` | a message's mentions and attachments (`BlobRef`s), at most 100 + 100 + 10 + 10, beside the record (a record holds no lists) |
| `reactions: UnorderedMap<(message, emoji, account), bool>` | one row per reaction |
| `profiles: UnorderedMap<account, Profile>` | username (fixed by the first `setProfile`) and avatar `BlobRef` |
| `roles: UnorderedMap<account, Role>` | `Mod`, `Admin`, `Banned`; absent is `User` (or `Admin` for the org's owner and admins) |
| `readReceipts: PerUser<u64>` | each account's last-read timestamp |
| `drafts: UnorderedMap<(account, channel), String>` | each account's unsent drafts |

Who may do what: the platform decides who reaches the conversation (the org's
owner, admins, members and guests for a channel; the listed accounts for a
private channel or DM). Inside, each method checks `env::caller()`: only a
message's sender edits it; its sender, a moderator or an admin deletes it; only
an admin changes the info or anyone's role (a moderator may only ban a `User`
or lift a ban); a banned member's writes are refused (`Banned`); profiles,
reactions, read receipts and drafts are always the caller's own.

Errors (`422 APP_ERROR`, `{ code, fields }`): `NotFound { what, id }`,
`Forbidden { message }`, `Invalid { message }`, `Banned`.

Events, to everyone the conversation reaches (guests included, as v1's every
context member): `Initialized`, `MessageSent { messageId }`,
`MessageSentThread { messageId, parentMessageId }`, `ReactionUpdated
{ messageId }`, `MessageEdited { messageId }`, `ProfileUpdated { identity }`,
`InfoUpdated`, `RoleUpdated { identity }`.

## What changed in the port, and why

Same methods (camelCase on the wire), same arguments, same answers and events
wherever the runtime allows. What a client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method and argument names | `send_message`, `parent_message`, … | `sendMessage`, `parentMessage`, … | the ABI names methods and arguments in camelCase |
| answer field names | snake_case (`total_count`, `thread_count`, `mentions_usernames`) | camelCase (`totalCount`, `threadCount`, `mentionsUsernames`) | the platform's convention; the frontend's adapter (`app/src/calimero/chat.ts`) maps them back |
| 64-bit integers (`timestamp`, `index`, `editedOn`, `size`, counts, `createdAt`) | JSON numbers | decimal strings (`"1700000000"`), arguments too | D20: no precision loss in JSON |
| `init` | `name, context_type, description, created_at, creator_username`, required | the same, every one optional (`initArgs` of `createApp`); `createdAt` defaults to the log's clock | a component's `init` takes `initArgs`, and a bare `createApp` sends none |
| the sender | the entry's owner stamp (a patched node could write any `sender` field) | the caller | every write goes through a method on the leader |
| message ids | `hex(sha256(account‖text‖ts‖counter))_ts` | `hex(32 random bytes of the run)_ts` | same shape; the seeded run randomness replaces the digest |
| thread replies' `index` | its place in the thread at read time (shifts when a moderator removes one) | its position in the thread (`seq`), stable | positions are never reused |
| thread order | by client timestamp | by arrival (log order) | positions are assigned on write |
| a staff removal of a top-level message | kept in `hidden`, blanked on read | the message itself blanked and marked `deleted` | one writer: nothing forces a side table |
| editing a deleted message | allowed (the text came back) | `NotFound` | a deleted message stays deleted |
| replying to a reply | `Parent message not found` | `NotFound` (same rule: threads are one level) | — |
| `getMessages` / `getMessagesFrom` without a limit | every message | 100 (at most 500 per page) | a growing collection is read in pages |
| `getMessages` with `searchTerm` | scanned the whole channel | scans the newest 2,000 messages (or 1 MiB); `totalCount` counts matches among those | a per-call read of a whole collection is capped; `searchMessages` searches everything |
| `searchMessages` order | newest first across pages; `frontierTimestamp` a bound | best match first (the host's index ranks by relevance), newest first within a page; `frontierTimestamp` is `null` | `Table::search` ranks by BM25; the scan (`searchMessagesScan`) keeps v1's order and frontier |
| `searchMessages` limits | 20, at most 50 | the same | — |
| `getProfiles` | every profile, a list | one page: `{ items, next }` (`cursor`, `limit` ≤ 1,000) | growing collection |
| `listRoles` | `[[identity, role], …]` of every non-`User` | one page: `{ items: [{ identity, role }], next }`; the org's owner and admins are `Admin` without being listed | growing collection; tuples are not a component type |
| org owners and admins | made channel admins by the frontend on every channel open (`set_member_role` self-assert) | `Admin` in every channel unless a role was set for them | the contract asks the org (`env::org_role`) |
| `setMemberRole` target | any id | the app's owner or a member of its org (`Invalid` otherwise) | a role for an account that cannot reach the app is meaningless |
| the ban | checked on the banned member's own node | checked by the leader: every write of a banned member is `Banned` | one writer |
| `updateInfo` by a non-admin | `Only an admin can change…` (string error) | `Forbidden { message }` | typed errors |
| attachments | `blob_id_str` announced to the context; client's size | a `BlobRef` the app must hold (`Invalid` otherwise); the node's recorded size wins | R8 blobs: the host keeps a referenced blob |
| `uploadedAt` | nanoseconds | milliseconds | the component clock |
| avatars | a blob id string | a `BlobRef` (`Invalid` for a blob the app does not hold) | as attachments |
| drafts | `#[app::private]` node-local storage | in the app's state, keyed by the caller's account, read back only by `getDraft` for the caller | the component SDK has no private storage yet (see below) |
| `MessageSentThread` event | `{ message_id }` | `{ messageId, parentMessageId }` | a reader refreshes the right thread |
| events with a payload | tuple variants (`ReactionUpdated("id")`) | named fields (`{ messageId }`, `{ identity }`) | the component event shape |
| new | | `messageIdAt(parentMessage?, index)`: `messagePosition`'s inverse | a link (and a scenario) names a position |
| who may call | any member of the context | the org's members/admins/owner/guests (channel) or the listed accounts (private channel, DM); anonymous `401`, others `404` | the platform's access boundary |

The frontend kept its screens (sidebar, channel list, DMs, the virtualized
message list, composer with mentions, emoji, attachments and drafts, threads,
reactions, search overlay, permalinks, settings, the IndexedDB message cache,
notifications and sounds) and changed underneath:

- `app/src/calimero/`: the session (passkeys, `SessionStore`), the connection
  the data layer reads, the typed contract client and its adapter back to the
  screens' shapes, workspaces (orgs, conversations, invites), presence and the
  workspace provider.
- `ClientApiDataSource` keeps its methods, now one call or view each; blobs
  are uploaded to and downloaded from the conversation's app.
- Removed with v1: mero-react / mero-platform, the node login and Connect
  wipe, desktop SSO and token seeding, the namespace entry popup, subgroups,
  context identities, invitation codecs and deep links, the TEE badge, the
  admin panel's Details (namespace visibility, default capabilities) and
  Upgrade tabs, channel "join" (every channel listed is one you reach), the
  Playwright suites (mocked, rpc, live, journey, landing media recording) and
  their helper scripts, and every merobox workflow, script and the
  `permissions-testing.sh` / `scripts/` node harnesses.
- Behaviour changes in the screens: live events stream for the open
  conversation only (a browser holds at most six connections to a node; the
  others' unread counts are polled every 30 s); the sidebar's online dot polls
  the conversation's presence instead of every DM row publishing its own;
  changing your avatar uploads it to each conversation of the workspace (a
  blob belongs to one app); deleting a workspace is its owner's (`deleteOrg`),
  leaving is everyone else's (`removeMember` of yourself).

## What the component SDK does not have yet

- **Private (node-local) storage** (`#[app::private]`): v1 kept drafts on the
  author's own node, never synced. Here they are in the app's replicated state,
  readable only through `getDraft`, which answers the caller's own draft;
  nobody else, the app's owner included, can read one through the app, but the
  bytes are part of the app's state on the cluster's nodes.
- **Migrations** (`#[app::migrate]`): v1 state cannot be carried into this
  contract; a 1.0 deployment starts empty.
- **Native mobile**: the pinned swift-sdk and kotlin-sdk have no 1.0 client;
  `mobile/` is unchanged and its v1 live-relay tests were removed.

The contract needs no event handlers, TEE methods, xcalls, actions or outbound
HTTP: v1 used none of them. **No outbound hosts or secrets** need configuring.

## Production

The production frontend is the one packed into the `.mpk` (`frontend-dir =
"../app/dist"`) and served by the cluster from the package's origin; set
`VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` where it is built (see
`app/.env.example` and [`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md)).
Instances are created from the package `com.calimero.chat`. The Vercel
deployment at `chat.hyperfeed.me` is outside the cluster's relying party and
cannot sign in; it remains the listing's link.
