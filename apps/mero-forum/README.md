# Mero Forum

A discussion forum: threads, flat comments, one vote per account on posts and
comments, display names and moderators. A component app on Calimero 1.0: the
contract is on core's component SDK (`calimero-sdk`, `wasm32-wasip2`), local
development runs on `merod local`, and the frontend talks to the local nodes in
development and to Calimero Cloud in production through mero-js's
`CalimeroClient` (`@calimero-apps/connect`). See
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` and `Cargo.lock`) |
| `logic/tests/` | `harness.rs` (every method on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | `forum.json` (v1's merobox workflow), `access.json` (the org's gate, guests, forged writes); run by `cargo test` and on `merod local` |
| `app/` | Vite + React frontend |
| `mobile/` | native iOS and Android apps (see [Mobile](#mobile)) |

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a space | an organization | a namespace |
| a forum | an instance of this app in the space's org | a subgroup and its context |
| joining | an org invite link (`?invite=<token>`, `&forum=<app id>` to land in one forum), redeemed after a passkey sign-in | a namespace invitation link, then joining the forum's context and waiting for it to sync |
| who you are | an account, signed in with a passkey | a node identity, signed in through the node |

Every member of a space (owner, admins, members, guests) reaches every forum in
it, including forums made later. Anyone else is refused before the contract runs
(`404 NOT_FOUND` for an outsider, `401 UNAUTHENTICATED` for an anonymous caller).


## Mero Forum's app team

An organization can hold several apps, each with its own **app team**
(core#4890; see Calimero Home's README). Mero Forum reaches its organization only
through `@calimero-apps/connect`'s org-app module
(`scripts/check-org-app-module.py` fails CI otherwise):

- A new organization made here gets Mero Forum's team at once, **open**
  (`standalone`: everyone in the org has the app). New forums use
  `{ kind: "team" }` access on it, invites name it (`appInvite`), and the
  people shown are its people (`appPeople`).
- Once an admin keeps the org's apps apart in Calimero Home (`shared`), an
  invite gives Mero Forum only (the dialog says so) and only its people are shown.
  **Leave** then leaves Mero Forum only, and offers to leave the organization
  too when it was your last app there; in open and legacy orgs Leave is
  leaving the org, as before. The space's owners and admins **Remove** people
  from the People card: Mero Forum only in such an org, out of the org in open
  and legacy ones.
- Adding Mero Forum to an organization whose apps have teams makes its team
  first: owners and admins only (anyone else is told so), open in an open org
  and closed in one that keeps its apps apart.
- An organization from before app teams stays **legacy** (organization
  access, org-wide invites). Under `pnpm dev:local` the app runs from a raw
  bundle, which has no package, so every organization is legacy there.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-forum     # merod local + the contract + the app on http://localhost:5173/
meroctl local dev apps/mero-forum  # the same with core's meroctl (1.0.0-rc.24 or later)
```

Sign up with a passkey, create a space, a forum in it, and post. To try a second
person, open the space's **Invite people** link in another browser profile.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo fmt --manifest-path apps/mero-forum/logic/Cargo.toml -- --check
cargo clippy --manifest-path apps/mero-forum/logic/Cargo.toml --all-targets -- -D warnings
cargo clippy --manifest-path apps/mero-forum/logic/Cargo.toml --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path apps/mero-forum/logic/Cargo.toml       # harness + scenarios
cargo run --release --manifest-path $M -- build apps/mero-forum/logic   # res/abi.json
pnpm merod-local e2e mero-forum                                   # the scenarios on merod local
pnpm -F mero-forum lint && pnpm -F mero-forum typecheck && pnpm -F mero-forum test && pnpm -F mero-forum build
```

## What changed in the port, and why

### Storage

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `Moderated<IndexedMap<String, Post>>`, `#[index(feed(deleted, created_at))]`, the author = the entry's owner stamp | `posts: Table<Post>`, `author` a field; `feed` index (`createdAt`) and `top` index (`score`, `createdAt`) |
| `Moderated<IndexedMap<String, Comment>>`, `#[index(thread(post_id, deleted, created_at))]` | `comments: Table<Comment>`, `author` a field; `thread` index (`postId`, `createdAt`); a maintained `perPost` count |
| `Authored<IndexedMap<String, Vote>>` keyed `"{post}\|{account}"`, tallied by scanning the post's rows | `votes: UnorderedMap<(postId, account), i8>`; the post's `score` kept on the post (so `top` is an index) |
| `Authored<IndexedMap<String, CommentVote>>` | `commentVotes: UnorderedMap<(commentId, account), i8>`; the comment's `score` on the comment |
| `UserStorage<Profile>` | `profiles: PerUser<String>` |
| `Moderated`'s writer set (the founder, then whoever the moderators appoint) | `moderators: Set<String>`; the app's owner at `init` |
| hand-written `Mergeable` rules, tombstones, per-owner keys and the "lowest holder" pick | gone: one leader orders every write in one log |

The write rules v1 kept in storage are checks in each method against
`env::caller()`: only a post's or comment's author edits or deletes it
(`Forbidden` otherwise), only a moderator moderates or appoints (`Forbidden`), and
no method takes the account it writes for (a vote and a name are always the
caller's own). v1's forged-write tests are the same calls made as another account
(`tests/harness.rs`, `scenarios/access.json`).

### What a client sees

| | v1 | now |
|---|---|---|
| method names | `create_post`, `list_posts`, … | the same methods, camelCase: `createPost`, `listPosts`, … |
| argument names | `post_id`, `comment_id` | `postId`, `commentId` (all other arguments unchanged) |
| `getPost`, `listPosts`, `listComments` answers | snake_case fields; `created_at`, `edited_at`, `score`, `comment_count` as JSON numbers | camelCase fields (`authorName`, `createdAt`, `editedAt`, `commentCount`, `myVote`, `postId`, `nextCursor`); `createdAt`, `editedAt`, `score`, `commentCount` as **decimal strings**; `myVote` still a number |
| timestamps | nanoseconds | milliseconds (the log entry's time) |
| paging cursors | the last row's post or comment id | opaque SDK cursors, good only for the same `sort` (`"top"` with a `"new"` cursor is refused) |
| `listPosts` `sort` | anything but `"top"` read as `"new"` | `null`, `"new"` or `"top"`; anything else is `Invalid` |
| `"top"` order | score, then newest, then id; computed by scoring every post on each read | score, then newest, from the `top` index |
| deleting a post (author or moderator) | the author's delete tombstoned it; its comments and votes stayed | removes the post, its comments and every vote on them; `getPost` then answers `NotFound` |
| deleting a comment | tombstoned | removed, with its votes |
| a deleted post or comment | `"post is deleted: …"` | `NotFound`, as for one that never existed |
| errors | `FunctionCallError` with a message string | `422 APP_ERROR`: `NotFound { what, id }`, `Forbidden { message }`, `Invalid { message }` (blank or oversized fields, an unknown sort, a vote outside -1..1, an account outside the forum) |
| `setModerators` | any parseable account id | each account must be the forum's owner or in its org (`Invalid` otherwise); duplicates collapse |
| `moderators` | every moderator | in key order (account ids sort as strings), at most 1,000 |
| `ModeratorsChanged.count` | a number | a decimal string (`"1"`) |
| event fields | `post_id`, `comment_id` | `postId`, `commentId` (same events, same names) |
| events | to every member of the context | to everyone the forum reaches (`Audience::All`), guests included; every event carries ids only |
| `vote` / `voteComment` | stored a row for a 0 vote | 0 removes the caller's vote |
| migrations | none | none (the component SDK has none yet) |

Everything else (`createPost`/`createComment` return a 32-hex id, `setNickname`
trims and an empty name clears it, `getNickname` answers `""` for no name, the
300 / 10,000 / 64-byte limits, page sizes 20 by default and 100 at most) is as in
v1.

### Frontend

- `MeroProvider`, the node login popup, `useApplicationId`, the generated
  `ForumClient` and its codegen, `@calimero-apps/names`, mero-platform deep links,
  and the namespace/subgroup/context plumbing in `lib/groups.ts` are gone. The
  session is `@calimero-apps/connect` (`src/session.ts`, `src/sessionContext.tsx`):
  passkey sign-in/up, the session stored per app and per target.
- The contract is called through `MeroForumClient` (`src/generated/client.ts`),
  which `meroctl app codegen` writes from `logic/res/abi.json` (committed;
  `pnpm -F mero-forum codegen` after a contract change, and CI fails when it is
  stale). `src/client.test.ts` checks it has exactly the ABI's methods, sends
  each as a call or a view with its parameter names, and syncs the session after
  each. The ABI names its records without their shapes, so the generated types
  are `unknown`: `src/lib/forumApi.ts` is the **one adapter** that turns each
  answer back into the shapes the screens were written against (snake_case,
  numbers), so the feed, post, comment and nickname screens are unchanged.
- `src/lib/spaces.ts` replaces `lib/groups.ts`: spaces are orgs (`/me`,
  `createOrg`, `getOrg`, `deleteOrg`, `removeMember`), forums are instances
  (`listApps` by the dev bundle or the package, `createApp(name, source, { org })`,
  `deleteApp`), invitations are org invites (`invite` is a passkey step-up). A
  name set for the whole space is org member metadata `{ name }`.
- v1's "Syncing…" states (`useJoinSync`, the join-and-wait on a forum, the
  replication watchdogs) are gone: nothing has to replicate before a member can
  read. The feed and the open post re-read on the forum's events instead.
- The TEE badge, the per-forum "joined" state and member count are gone with the
  subgroups; a forum row shows the space's member count and "Yours" on forums you
  created.
- The Playwright suites (journey, shell, landing spec, screenshot harness) are
  removed: the end-to-end run is `pnpm merod-local e2e mero-forum`, and the
  screens are tested with a mocked client (`App.test.tsx`).

## Mobile

The native iOS and Android apps move to Calimero 1.0 in #689, which calls this
contract's component ABI (the same 17 methods, camelCase arguments and answers
as `app/src/generated/client.ts`) and lands after this port. This port leaves
`mobile/` as it is on `main`.

## Production

The production frontend is the one bundled into the `.mpk` (`frontend-dir`), so
the cluster serves it from the package's own origin, where passkeys work. Build it
with `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (see
`app/.env.example`); without them the production build refuses to connect.
