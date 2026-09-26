# Mero Updates

**Investor updates and investor relations, peer to peer.** Visible, Cabal and Paperstreet do the same
basic job: a founder writes a structured update, sends it to investors, and asks them for help. Mero
Updates keeps that and changes where the data lives. There is no SaaS database. The company and its
investors share a Calimero context, and every update, reply and offer of help replicates between
their own nodes.

The conversation also runs both ways. Investors do more than open an email: they react, reply, offer
help on an ask with one click, and ask the team questions of their own.

| | |
| --- | --- |
| Package | `com.calimero.mero-updates` |
| Contract | [`logic/src/lib.rs`](logic/src/lib.rs), with 35 `TestHost` tests in [`logic/src/tests.rs`](logic/src/tests.rs) |
| Two-node scenario | [`logic/workflows/e2e.yml`](logic/workflows/e2e.yml), 90 steps that call every contract method on real nodes |
| Frontend | [`app/`](app): Vite, React and mero-react |
| Browser suites | `tests/` has the shell and landing page (no node). `e2e/` runs the founder's whole flow against a real merod |

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
| Drafts that autosave | ✓ | Stored in the contract's **private** storage, which stays on your node and never replicates. An unfinished update cannot reach an investor early. |
| Preview | ✓ | |
| Edit or delete after publishing | ✓ | Any teammate can. Edits merge on their own axis, so a typo fix cannot undo a status change. |
| "Next update due" reminder | ✓ | Driven by a cadence (weekly to quarterly) set in Settings, and shown on the team home screen. |
| Setup checklist | ✓ | Name the company → add categories → publish → invite. Shown until all four are done. |

### 2. Organize: categories and audiences (`Settings`, audiences page)

| Feature | Status | Notes |
| --- | --- | --- |
| Categories you define (name, emoji, colour) | ✓ | One-click starter set: Monthly, Fundraising, Product, Hiring, Board. |
| Filter the feed by category | ✓ | Each chip shows its unread count. |
| Readers **mute** categories | ✓ | Muted categories stop counting as unread. Set in the People tab. |
| Archive a category | ✓ | Archiving is permanent. Old updates keep their label. |
| Company → audiences | ✓ | A company (namespace) holds audiences (contexts), such as "All investors" or "Angels". An invite link can target the whole company or one audience. |
| Team roles | ✓ | The creator is admin, and admins make teammates. The role registry is an `AccessControl`, so a grant from a non-admin is rejected **at merge**. |

### 3. Converse: the two-way part (every post, `Q&A`, `Asks`)

| Feature | Status | Notes |
| --- | --- | --- |
| Reactions 👍 🎉 ❤️ 🚀 👀 🙏 | ✓ | One per person per emoji. A second device counts as the same person. |
| Threaded replies (one level) | ✓ | The team's replies carry a **Team** tag. The author can delete a reply, and the team can moderate any. |
| **I can help** on an ask | ✓ | One click, or add a note. The investor can edit or withdraw their offer. |
| Offer triage: Accept / Decline / Undo | ✓ | Team only. Accepted offers become **contributions**. |
| Asks board | ✓ | Every open ask across every update. For an investor, it lists the ways they can help right now. |
| Contributions ledger | ✓ | Who helped, with what, and when. |
| **Q&A**: investor-initiated threads | ✓ | Anyone can ask. The team answers and marks the question answered. The answer is visible to the whole audience, so a question only has to be asked once. |
| Live refresh | ✓ | Every contract event, and every reconnect of the event stream, triggers a re-read. The founder sees a reply arrive without refreshing. |

### 4. Understand: insight (`KPIs`, `People`)

| Feature | Status | Notes |
| --- | --- | --- |
| KPI trends | ✓ | One series per metric name across every update, with a sparkline, the latest change and the history. |
| KPI tiles with change since the last report | ✓ | Computed, not typed. |
| Read receipts | ✓ | Recorded when a member opens an update in the app, with first and latest open. Readers can see that the app records them. |
| **Who read what**, and a follow-up list | ✓ | Team only. For each update: who read it, and which named investors have not. |
| Per-investor engagement | ✓ | Updates read out of the total, last read, replies, offers made and offers accepted. |
| Profiles | ✓ | Name plus fund or firm, asked for once on the first visit, so the team sees names instead of 64-character hex IDs. |

## Architecture

```
Company (namespace) ─ invite link ─▶ investors join
 └── Audience (subgroup + context)  "All investors"
      ├── roles        AccessControl         admin tier + "team" role, verified at merge
      ├── settings     company name, cadence
      ├── categories   id → Category          archive is permanent
      ├── posts        id → Post              kind = update | question
      ├── asks         id → Ask               carries post_id
      ├── offers       ask|account → Offer    one per person per ask
      ├── comments     id → Comment           carries post_id, parent_id
      ├── reactions    post|account|emoji → Reaction
      ├── reads        post|account → Read    first = min, latest = max
      ├── profiles     account → Profile      name, firm, muted categories
      └── (private)    Drafts                 on the author's node only
```

A few decisions do most of the work:

- **Flat maps with parent IDs**, never a nested collection per parent. When two nodes each create
  a nested CRDT on their own, the copies only merge if they get deterministic keys. A flat map
  avoids that problem.
- **Independent merge axes.** An author's edit (`edited_at`), the team's triage (`status_at`) and a
  deletion are merged separately. So a typo fix cannot reopen an answered question, and a helper
  editing their note cannot undo "accepted".
- **Last-write-wins over a total order.** When two timestamps tie, the Borsh bytes decide, so every
  replica picks the same winner.
- **Timestamps are milliseconds.** `env::time_now()` returns nanoseconds, which is past 2^53: a
  browser decoding it as JSON would silently lose digits. There is a test for this.
- **Everything is keyed by account.** One person has one vote, one offer and one read, whether
  they use a laptop or a phone.

## What "team only" does and does not mean

These limits are stated here so nobody assumes something stronger:

- **Readers can read everything in an audience's contract state.** The offer list and the read report
  are hidden from readers *in the UI*, but every member's node holds the same rows. That is a filter
  on what the app shows, not confidentiality.
- **Every company member can open every audience in it**, because audiences are open subgroups. For
  something truly confidential, such as a board, create a **separate company** and invite only the
  board. The audiences page says this where you create one.
- **Write gating runs on the writer's node.** The role registry itself is checked at merge. Publishing,
  triage and moderation are guarded by the contract on the node that makes the call, using that node's
  copy of the roles. Two consequences follow. A demotion takes effect only once it reaches the
  demoted member's node; the two-node scenario found this and now waits for it explicitly. And a
  deliberately modified node could bypass the guard. See the roadmap.

## Roadmap

In rough priority order:

1. **Enforce post writes at merge.** Put updates in a writer-set storage whose writers are rotated
   along with the team, the way the role registry already works. This closes the modified-node gap.
2. **Private 1:1 threads** between the team and one investor, using a restricted subgroup per
   investor. This covers "reply privately", which is how Cabal's reply-by-email feels.
3. **Restricted audiences** (board-only) inside one company, instead of a separate company.
4. **Email and PDF export of an update**, for investors who will never run a node. Their reply
   would then be a manual paste.
5. **Scheduled publish.** This needs the author's node to be online at the scheduled time, so it
   would probably be a desktop-app feature.
6. **KPI import from CSV or Sheets**, plus a real chart on the KPIs tab.
7. **Investor-side requests** (Visible's "Requests"): an investor asks the company for specific
   metrics, and the answer is filed into the next update.
8. **Draft co-editing** between teammates. Drafts are node-local today by design.

## Working on it

```bash
cargo test -p mero-updates                       # contract unit tests
cargo mero build -p mero-updates                 # wasm + res/abi.json
pnpm -F mero-updates codegen                     # ABI → src/generated/UpdatesClient.ts
pnpm -F mero-updates dev                         # http://localhost:5190

pnpm -F mero-updates test                        # vitest
pnpm -F mero-updates exec playwright test        # shell + landing, no node

# The real-node founder flow (needs merod and the bundle):
cargo mero bundle --manifest-path apps/mero-updates/logic/Cargo.toml --dev \
  --app-version 0.0.0 --output apps/mero-updates/logic/dist/com.calimero.mero-updates.mpk
pnpm -F mero-updates run test:e2e:node

# The two-node scenario:
cd apps/mero-updates/logic && merobox bootstrap run workflows/e2e.yml
```
