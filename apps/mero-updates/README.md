# Mero Updates

**Investor updates and investor relations, without the platform.** Visible, Cabal and Paperstreet do
the same basic job: a founder writes a structured update, sends it to investors, and asks them for
help. Mero Updates keeps that and changes where the data lives. There is no SaaS database: the
company and its investors share an app on [Calimero](https://calimero.network) 1.0, a contract on
core's **component SDK** (`calimero-app-sdk`, a `calimero:app` WebAssembly component on the node's
wasmtime runtime), developed on **`merod local`**, with a frontend on mero-js's **`CalimeroClient`**
that talks to a **Calimero Cloud** cluster in production and to the local nodes in development.

The conversation also runs both ways. Investors do more than open an email: they react, reply, offer
help on an ask with one click, and ask the team questions of their own.

```
apps/mero-updates/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           the contract: tables, maps, a set, a cell, per-account values
│   ├── tests/harness.rs     TestApp: every method on core's real engine (41 tests)
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           e2e, permissions, access (+ .org.json): harness AND merod local
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
├── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
└── mobile/                  native iOS/Android apps: move to Calimero 1.0 in #693 (see below)
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component apps are built, run and
tested in this repo.

---

## What the research said makes these tools easy

The research agent could not load the vendors' sites directly, because the network proxy blocked
them. It worked instead from search results that quote the vendors' own product pages, blogs and
FAQs. The same eight patterns came up across all three products:

1. **Structure beats a blank page.** Visible's default template is Highlights / Lowlights / KPIs /
   Asks. Paperstreet adds a TL;DR plus Product, Financial and Team sections. With a template, the
   update is half written before the founder types anything.
2. **Reuse the last update.** Paperstreet lets you duplicate the previous update. Visible's KPIs
   update themselves through integrations. In both, nobody retypes last month's metric names.
3. **The ask matters most.** Visible calls asks "the most important part". Cabal cuts answering an
   ask down to a couple of clicks, then tracks and thanks each contribution in the next update.
4. **Reading costs nothing.** The update is in the investor's inbox, with no login and no portal.
5. **Regularity is prompted.** Visible sends recurring reminders and Paperstreet has nudges. A
   monthly cadence is where the trust comes from.
6. **Engagement is visible.** Founders can see who opened each update and use that to decide
   who to follow up with.
7. **Audiences are segmented.** Board, all investors and prospects each get a different update.
8. **Replies feel personal.** Cabal sends from the founder's own inbox and uses mail merge, so
   replying feels natural.

## The feature set, and how it is organized
## The feature set, and how it is organized

Features are grouped by the job they do, and each group maps to one tab in the app. **✓** means built
and tested. **→** means designed but not built yet (see [Roadmap](#roadmap)).

### 1. Write: the founder's cockpit (`Updates` tab, team view)

| Feature | Status | Notes |
| --- | --- | --- |
| Templates: Monthly, Quarterly/board, Fundraising, Milestone, Blank | ✓ | Sections come pre-titled with prompts. Sections left empty are dropped on publish. |
| **Reuse the last one** | ✓ | Copies the previous update's section headings and KPI names, not its words or numbers. |
| KPIs as structured rows | ✓ | Each row shows *"last: $42k"* and the computed delta while you type. The value is stored exactly as written ("$1.2M", "38%"). |
| TL;DR summary | ✓ | The one paragraph a busy investor reads. |
| Asks with a type (intro, hire, customer, advice, fundraising, other) | ✓ | Up to 10 per update. |
| **Thank contributors** in one click | ✓ | Adds a "Thank you" section listing every offer accepted since the last update. |
| Drafts that autosave | ✓ | Kept per author: no other account can list, read or change them, so an unfinished update cannot reach an investor early. (v1 kept them node-local; see [What changed](#what-changed-in-the-port-and-why).) |
| Preview | ✓ | |
| Edit or delete after publishing | ✓ | Any teammate can. An edit never touches an ask's or a question's status, so a typo fix cannot undo a triage decision. |
| "Next update due" reminder | ✓ | Driven by a cadence (weekly to quarterly) set in Settings, and shown on the team home screen. |
| Setup checklist | ✓ | Name the company → add categories → publish → invite. Shown until all four are done. |

### 2. Organize: categories and audiences (`Settings`, audiences page)

| Feature | Status | Notes |
| --- | --- | --- |
| Categories you define (name, emoji, colour) | ✓ | One-click starter set: Monthly, Fundraising, Product, Hiring, Board. |
| Filter the feed by category | ✓ | Each chip shows its unread count. |
| Readers **mute** categories | ✓ | Muted categories stop counting as unread. Set in the People tab. |
| Archive a category | ✓ | Archiving is permanent. Old updates keep their label. |
| Company → audiences | ✓ | A company (an organization) holds audiences (instances of this app), such as "All investors" or "Angels". An invite link can target the whole company or land in one audience. |
| Team roles | ✓ | The audience's creator and the company's admins are admins, and admins make teammates. Every team write is checked in the contract against the caller. |

### 3. Converse: the two-way part (every post, `Q&A`, `Asks`)

| Feature | Status | Notes |
| --- | --- | --- |
| Reactions 👍 🎉 ❤️ 🚀 👀 🙏 | ✓ | One per person per emoji. A second device is the same account. |
| Threaded replies (one level) | ✓ | The team's replies carry a **Team** tag. The author can delete a reply, and the team can moderate any. |
| **I can help** on an ask | ✓ | One click, or add a note. The investor can edit or withdraw their offer. |
| Offer triage: Accept / Decline / Undo | ✓ | Team only. Accepted offers become **contributions**. |
| Asks board | ✓ | Every open ask across every update. For an investor, it lists the ways they can help right now. |
| Contributions ledger | ✓ | Who helped, with what, and when. |
| **Q&A**: investor-initiated threads | ✓ | Anyone can ask. The team answers and marks the question answered. The answer is visible to the whole audience, so a question only has to be asked once. |
| Live refresh | ✓ | Every event of the audience (`client.events`), and every reconnect of the stream, triggers a re-read. The founder sees a reply arrive without refreshing. |

### 4. Understand: insight (`KPIs`, `People`)

| Feature | Status | Notes |
| --- | --- | --- |
| KPI trends | ✓ | One series per metric name across every update, with a sparkline, the latest change and the history. |
| KPI tiles with change since the last report | ✓ | Computed, not typed. |
| Read receipts | ✓ | Recorded when a member opens an update in the app, with first and latest open. Readers can see that the app records them. |
| **Who read what**, and a follow-up list | ✓ | Team only. For each update: who read it, and which named investors have not. |
| Per-investor engagement | ✓ | Updates read out of the total, last read, replies, offers made and offers accepted. |
| Profiles | ✓ | Name plus fund or firm, asked for once on the first visit, so the team sees names instead of 64-character hex IDs. |

## The model

| | what it is |
|---|---|
| **company** | an organization (`createOrg`); its members are the people who can read its audiences |
| **audience** | an instance of this app in the organization (`createApp(name, source, { org })`), such as "All investors", holding its updates, questions, asks, replies, reactions and reads |
| **invitation** | an org invite (`invite(org, 'member', passkey)`, a passkey step-up), shared as a link to this frontend (`/?invite=<token>`, plus `&audience=<id>` to land in one audience); the invitee signs in and confirms |
| **admins** | the audience's creator (the instance's owner) and the organization's owner and admins |
| **team** | admins, plus the members an admin adds with `addTeammate` |
| **readers** | everyone else the organization lets in: members and guests |

```
Company (organization) ─ invite link ─▶ investors join
 └── Audience (an app instance)  "All investors"
      teammates      Set<account>          admins come from the organization
      settings       Cell                  company name, cadence
      categories     Table<Category>       byCreated; archive is permanent
      updates        UnorderedMap<id, Post>  sections + KPIs (lists, so not a table record)
      questions      UnorderedMap<id, Post>
      asks           Table<Ask>            byPost
      offers         Table<Offer>          key (ask, account); byAsk, byAccount
      comments       Table<Comment>        thread (post, time); counts perPost, perAuthor
      reactions      Table<Reaction>       key (post, account, emoji); count perEmoji
      reads          Table<Read>           key (post, account); byPost, byAccount; count perPost
      profiles       Table<Profile>        key account
      mutes          PerUser<Vec<category>>
      drafts         UnorderedMap<(account, id), Draft>
```

The app runs on its cluster's leader, which applies every write in one replicated log, so these are
plain data structures: there is nothing to merge, and a later write replaces an earlier one. Every
write rule v1 kept in storage is a check in the method, against the caller:

- **team data** (settings, categories, updates, asks, and the triage of questions and offers) is
  written by the team only; anyone else gets `Forbidden`;
- **questions and comments** record their author; the author edits a comment, the author or the team
  deletes a question or a comment;
- **reactions, reads, offers, profiles, mutes and drafts** are keyed by the caller's own account; no
  method takes an account to act as.

## What "team only" does and does not mean

- **Readers can read everything in an audience except the team-only views and other people's drafts.**
  The offer list on an ask and the read report are answered to the team only (`offers` is empty for a
  reader, `getEngagement` is `Forbidden`).
- **Every company member can open every audience in it.** For something truly confidential, such as a
  board, create a **separate company** and invite only the board. The audiences page says this where
  you create one.
- **Events go to everyone the audience reaches, guests included.** They carry ids only
  (`UpdatePublished { id }`, `Commented { postId, id }`…), and the screens re-read on each, so a
  guest learns nothing from one that a read would not show.

## Roadmap

In rough priority order:

1. **Private 1:1 threads** between the team and one investor, using an invite-only team per
   investor. This covers "reply privately", which is how Cabal's reply-by-email feels.
2. **Restricted audiences** (board-only) inside one company, instead of a separate company.
3. **Email and PDF export of an update**, for investors who will never sign in. Their reply
   would then be a manual paste.
4. **Scheduled publish.** A `#[app::every]` timer on the component runtime could publish a draft at
   its time, now that drafts live in the app.
5. **KPI import from CSV or Sheets**, plus a real chart on the KPIs tab.
6. **Investor-side requests** (Visible's "Requests"): an investor asks the company for specific
   metrics, and the answer is filed into the next update.
7. **Draft co-editing** between teammates. Drafts are per author today by design.

## Run it

```bash
pnpm install                       # once, at the repo root
rustup target add wasm32-wasip2    # once
pnpm dev:local mero-updates        # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`); `pnpm dev:local` prints
how to get it when it is missing. In the browser: **create an account** (a passkey), **create a
company**, then an **audience** in it, and publish. **Invite** someone from the company or audience
menu; a second browser profile with its own passkey opening that link is an investor.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-updates/logic/Cargo.toml` | v1's 35 `TestHost` tests method for method; v1's storage write rules (`AccessControl`, `SharedStorage`, `Moderated`, `Authored`, `UserStorage`) as the same calls made by accounts the methods refuse; v1's merge tests under one log; drafts private to their author; access (anonymous `401`, outsider `404`, a removed member, a guest), `BadArgs`, `UnknownMethod`, `NotAView`; and every `scenarios/*.json` | no |
| `pnpm -F mero-updates test` | the methods the screens call are exactly the committed ABI's, with its parameter names; the wire-to-screen conversion; the feed, the company and audience pages and invitations on a mocked client; where a visitor lands; the KPI, people, theme and contrast helpers | no |
| `pnpm merod-local e2e mero-updates` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

`scenarios/e2e.json` is v1's two-node Docker workflow (`logic/workflows/e2e.yml`, removed), with node
1 as `owner` (the founder) and node 2 as `bob` (an investor): roles and the refused self-promotion,
settings, categories, a draft, publishing and editing an update, the investor's reads, reaction,
reply, question and mute, the draft invisible to him, the team-only report refused, the founder's
answer and triage, moderation, the delete, and every event bob hears. Two v1 steps are not in it:
the offer of help and its acceptance address an ask by id, and the scenario format can save a whole
result but not a field inside one (the ask's id is inside `getPost`'s answer), so they are covered
by the harness instead. `scenarios/permissions.json` adds what v1 kept in storage write rules:
readers and guests refused every team write, authorship of comments and questions, no account
argument to forge, drafts private, and a demoted teammate losing publishing and moderation at once.
`scenarios/access.json`: a guest is a reader, anonymous and outsider callers never reach the app,
wire errors.

## What changed in the port, and why

Same methods, arguments, answers and events, renamed to the component ABI's conventions. What a
client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `get_me`, `set_profile`, `set_muted_categories`, `list_people`, `add_teammate`, `remove_teammate`, `get_settings`, `set_settings`, `create_category`, `edit_category`, `archive_category`, `list_categories`, `publish_update`, `edit_update`, `ask_question`, `set_question_status`, `delete_post`, `get_post`, `list_posts`, `mark_read`, `react`, `add_comment`, `edit_comment`, `delete_comment`, `list_comments`, `list_asks`, `set_ask_status`, `offer_help`, `withdraw_offer`, `set_offer_status`, `list_contributions`, `list_metrics`, `get_overview`, `get_engagement`, `save_draft`, `list_drafts`, `delete_draft` | the same in camelCase: `getMe`, `setProfile`, … `deleteDraft` | the ABI names methods in camelCase |
| argument names | `post_id`, `category_id`, `parent_id`, `comment_id`, `ask_id`, `draft_id`, `company_name`, `cadence_days`, `category_ids`; inside `input`: `category_id` | `postId`, `categoryId`, … `categoryIds`; inside `input`: `categoryId` | arguments too; nested input fields are camelCase and unknown ones refused |
| result fields | snake_case (`is_team`, `created_at`, `next_cursor`, …) | camelCase (`isTeam`, `createdAt`, `nextCursor`, …) | results are camelCase |
| times and counts | numbers | decimal strings (`"1700000000000"`, `"3"`): every `*At`, every count; `cadenceDays` and `limit` stay numbers (`u32`) | `u64` travels as a decimal string |
| `listContributions(since)` | a number | a decimal string (`"0"`) | the same, for an argument |
| event fields | `StatusChanged { post_id }`, `AskChanged { post_id, ask_id }`, `OfferChanged { post_id, ask_id }`, `Commented { post_id, id }`, `Reacted { post_id }`, `Read { post_id }` | `postId`, `askId` (the other events unchanged) | event data is camelCase |
| events | emitted with the write, to the context | after the write, to everyone the instance reaches (`Audience::All`), guests included | an event describes a write that happened |
| errors | a message string (`AppError::msg`) | `422 APP_ERROR` `{ code, fields: { message } }` with `code` one of `NotFound`, `Invalid`, `Forbidden`; the messages are v1's | `#[app::error]`'s wire shape |
| reads | any method | `getMe`, `getSettings`, `getPost`, `getOverview`, `getEngagement` and every `list*` are views; a write called as a view is `NotAView` | a view is answered without touching the log |
| admins | the context's creator (an `AccessControl` admin) | the instance's owner (its creator) **and** the organization's owner and admins | the organization is the access boundary; its admins govern it |
| `addTeammate(account)` | any well-formed account id | a member (or guest) of the company; another account is `Invalid` | there is an organization to check against |
| `removeTeammate` on an admin | revoked the `team` role, the admin stayed admin | the same: an admin stays team | — |
| demoting a teammate | bound once the demotion synced to their node | binds at once | one log |
| `listPeople` | every admin and teammate, and everyone who wrote something | the owner, every teammate, and everyone who wrote something (an org admin who never wrote is not listed until they do) | the contract cannot enumerate the organization's admins |
| `askQuestion` / comments / offers / reactions / reads written by a patched node under another key | ignored on merge (owned keys) | cannot happen: no method takes an account to act as | the method is the check |
| drafts | `#[app::private]`: node-local, never replicated, per node | per **account**, in the app's state; listed, read, overwritten and deleted only by their author; a draft follows its author across devices | the component SDK has no private (node-local) storage; per-account values readable only through methods that check the caller keep a draft from every other account |
| `saveDraft` | a write only on the author's node (no event) | a logged write (still no event) | the same |
| a deleted update | tombstoned; `getPost` says `post is deleted` | the same | — |
| reactions turned off | a row flagged `on: false` | the row removed | counts are maintained per emoji |
| the bundle | `app.wasm` for `wasm32-unknown-unknown`, contexts created with `{}` | a `calimero:app` component; instances created from the package (or the dev bundle) | component bundle |
| v1 migrations | — | none: this release starts from no v1 data | the component SDK has no migrations yet (`#[app::migrate]`) |

The frontend changed with it, and keeps its screens: the landing page, companies, audiences, the
feed, compose (templates, reuse the last one, thank contributors, drafts), a post with its asks and
thread, Q&A, asks, KPIs, people and engagement, settings, the light/dark theme. Behind them:

- **gone**: mero-react (`MeroProvider`, the node login popup, `useSubscription`, the invitation
  dialog/gate and join-sync gate), mero-platform, the generated `UpdatesClient` and its codegen, the
  v1 invitation link codec (deflate + base58 payload, `links.calimero.network`), the namespace /
  subgroup / context / identity plumbing (`lib/groups.ts`, hosting state, TEE badges: every 1.0 node
  is attested before the client sends it anything), `@calimero-apps/names`, and the Playwright
  suites that drove merod 0.x (`e2e/`, `tests/shell.spec.ts`, `tests/theme.spec.ts`);
- **new**: `src/lib/session.ts` + `src/lib/sessionContext.tsx` (target → client → passkey sign-in/up,
  the stored session), `src/lib/companies.ts` (orgs, instances, invites, member names),
  `src/lib/updatesClient.ts` (the contract by method name, converted back to the shapes the screens
  render; a test pins its method list to `logic/res/abi.json`), `src/lib/active.ts` (the open
  audience), a passkey sign-in dialog as the landing page's connect action, and a "Join this
  company?" prompt after sign-in;
- **names**: a company-wide name is org member metadata `{ name }` (was namespace member metadata).

`mobile/` moves to Calimero 1.0 in its own PR, #693: the native iOS and Android apps call this
contract's component ABI through a `ComponentWire` layer that maps their v1 method names and
snake_case fields to the camelCase ABI and reads 64-bit numbers back from decimal strings. #693
depends on this PR and merges right after it; until then `mobile/` is as on `main`.

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start without two variables
set where the bundle's frontend is built (`app/.env.example`):

```
VITE_CALIMERO_CLUSTER=<cluster name in the cloud's node directory>
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
```

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`), which the cluster
serves from the package's own origin: a Cloud node trusts passkey ceremonies only from its own origins
and from frontends it serves from a bundle. Instances are created from the package
(`com.calimero.mero-updates`). The `frontend` link in `logic/Cargo.toml` and the Vercel project
(`app/vercel.json`) stay as the listing's link.

```bash
pnpm -F mero-updates build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-updates/logic --key <production key> --app-version <x.y.z>
```

The package id stays `com.calimero.mero-updates`, but a 1.0 cluster starts from no v1 data: v1
companies, audiences and updates are not migrated.

⚠️ Known gap: mero-js checks a Cloud node's release against `cloud.calimero.network` mirrors, which
the served page's CSP does not list (docs/COMPONENT-APPS.md, "What the component SDK does not have
yet").
