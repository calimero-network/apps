# mero-crm

A simple, private sales CRM built on [Calimero](https://calimero.network): a
visual pipeline, deals with a next step, the people behind them, a to-do list
that puts overdue follow-ups first, stage automations, insights, and a deal
assistant. A pipeline is an app instance in your team's workspace on Calimero
1.0: a component-SDK contract on attested nodes, with no vendor reading your
customer list.

## What it does, and what it deliberately leaves out

The category (Pipedrive, HubSpot Sales, Close, Zoho, Attio, folk) converges on
the same core. That core is here; the long tail around it is not.

| Every CRM in the category has… | Here |
| --- | --- |
| A visual pipeline you drag deals through | **Pipeline** board: one column per stage with count, total and weighted value; drag to move, drop on **Won** / **Lost** to close. |
| Customisable stages with win probabilities | **Settings → Stages**: rename, re-weight, reorder, add, delete (refused while a stage holds open deals). |
| Deals with value, owner, contact, expected close, source | The deal page, edited in place. Value accepts shorthand (`12k`, `1.5m`). |
| People and organisations | **Contacts**, with each person's open deals and won value. |
| Activities: calls, meetings, tasks, emails, deadlines | Scheduled on a deal or standalone. The earliest open one is the deal's *next step*, shown on its card. |
| A to-do list | **Activities**, grouped Overdue / Today / Upcoming / Done, with one-click *Tomorrow* snooze. |
| "Rotting" deals | A deal idle past the pipeline's threshold (14 days by default) is flagged on the board. |
| Won / lost with a lost reason | One click to win; a lost reason (one-click presets) feeds the report. |
| Workflow automation | **Settings → Automations**: *when a deal enters stage X, schedule activity Y due in N days* — run inside the contract, so it fires whoever moves the deal. |
| Reporting and forecasting | **Insights**: open and weighted pipeline, won this month, win rate, average deal, sales cycle, value by stage, weighted forecast by close month, lost reasons, per-owner totals, deals that need attention. |
| An AI sales assistant | The **Deal assistant** on every deal (below). |
| Team access | The workspace (an organization) is the team: invite links, roles, member names — the same shell as the rest of the fleet. |

Left out on purpose: email sync, calling, a marketplace, custom-field builders,
territories, quotes and products. Each is a product in itself, and none of them
is what closes the next deal.

### The deal assistant

Deterministic and local — it runs in the browser on the pipeline you already
read, and sends nothing anywhere:

- **Health score (0–100)** from the signals a sales manager checks by eye: no
  next step, an overdue step, days since anyone touched the deal, days in the
  current stage, a slipped or missing close date, no contact person, no owner.
  Paired with a **win likelihood** (stage probability adjusted by health).
- **Next best steps**: the playbook step for the deal's stage (discovery call →
  demo → proposal → follow-up → close), re-engagement for a rotting deal,
  and fixes for missing data — each schedulable or focusable in one click.
- **Follow-up email draft** appropriate to the stage, to copy, open in your
  mail app, or log as an email activity.
- **Copy AI coaching prompt**: the deal's full context (stage, value, health,
  activities, notes) as a prompt for whichever AI assistant you already use.

The rules live in `app/src/utils/crm.ts` as pure functions with unit tests.

## Layout

| Path | What |
| --- | --- |
| `logic/` | The contract, a standalone component crate (`calimero-sdk` at `component-core-tag`, `wasm32-wasip2`): stages, deals, contacts, activities, notes, automations, settings. One app instance = one pipeline. |
| `logic/tests/` | `harness.rs`: the built component on core's real wasmtime engine (`TestApp`); `scenarios.rs`: every `scenarios/*.json`. |
| `logic/scenarios/` | `smoke.json` (the v1 smoke workflow, as accounts) and `access.json` (who may do what, and the wire checks). Run by `cargo test` and on `merod local`. |
| `app/` | React (Vite) frontend on mero-js `CalimeroClient` through `@calimero-apps/connect`. The workspace shell (sign-in, invitations, members, roles) is shared with mero-issue-tracker. |
| `mobile/` | Native iOS and Android apps, still on v1 (see `mobile/README.md`). |

**Light / dark and Log out.** Light is the default; the sun/moon button in the
top bar (`app/src/components/ThemeToggle.tsx`) and **Settings → Your account**
switch to dark. The choice is kept in `localStorage` under `mero-crm:theme`
(`app/src/theme.ts`), which the landing page's toggle also writes, and an inline
script in `app/index.html` applies it before the first paint. **Log out** sits
in the sidebar's identity block and in Settings (and in the corner of the
no-workspace screen): `app/src/auth/signOut.ts` forgets the open workspace,
then ends the session. The theme choice survives a log out.

## The model

| | what it is |
|---|---|
| **workspace** | an organization (`createAppOrg`), with this app's own **app team** in it (below); its people are the sales team |
| **pipeline** | an instance of this app in the organization (`createApp(name, source, { org })`), holding its stages, deals, people, activities, notes, automations and settings |
| **invitation** | an org invite naming the app team (`appInvite`, a passkey step-up), shared as a link to this frontend; the invitee signs in and confirms |
| **member names** | org member metadata `{ name }` (Members → Set my alias) |
| **roles** | the org's: owner and admins hold every capability; members get the workspace default (add pipelines, invite), which admins change per member |

### Mero CRM's app team

An organization can hold several apps, each with its own **app team**
(core#4890; see Calimero Home's README). This app reaches its organization
only through `@calimero-apps/connect`'s org-app module
(`scripts/check-org-app-module.py` fails CI otherwise):

- A new workspace gets the app's team at once, **open** (`standalone`:
  everyone in the org has the app). New pipelines use `{ kind: "team" }` access
  on it, invites name it (`appInvite`), and the member list is its people
  (`appPeople`).
- Once an admin keeps the org's apps apart in Calimero Home (`shared`), an
  invite gives Mero CRM only (the dialog says so), the member list shows its
  people, and **Remove** takes someone out of Mero CRM (its team), never out of
  the organization. **Leave workspace** (Members page, anyone but the owner)
  leaves Mero CRM only, and offers to leave the organization too when it was
  your last app there. In standalone and legacy orgs Remove and Leave are out
  of the org, as before.
- Adding Mero CRM to an organization whose apps have teams makes its team
  first: owners and admins only (anyone else is told so), open in an open org
  and closed in one that keeps its apps apart.
- An organization from before app teams stays **legacy** (organization
  access, org-wide invites) until an admin gives the app its own access list
  in Calimero Home. Under `pnpm dev:local` the app runs from a raw bundle,
  which has no package, so every workspace is legacy there.

Every member of the workspace (owner, admins, members, guests) may read and
work the whole board. Only a deal's or a contact's creator may delete it, and
only a note's author may delete the note; the contract checks both against the
caller and answers `Forbidden`.

## Data model

State is plain tables (`calimero-sdk`); the app runs on its cluster's
leader, which applies every write in one ordered log.

- `stages: Table<Stage>` — name, probability and position. A new pipeline
  starts (in `init`) with *Lead in 10% → Qualified 25% → Meeting 40% →
  Proposal 60% → Negotiation 80%*, with fixed ids. At most 12.
- `deals: Table<Deal>` — indexes `byCreated`, `byStage`, `byOwner`,
  `byStatus`, `byContact`, and a maintained `perStageStatus` count (what
  "a stage with open deals cannot be deleted" reads).
- `contacts`, `activities` (index `byDeal`), `notes` (index `byDeal`),
  `automations` (index `byStage`, maintained `perStage` count: at most 10 per
  stage) — tables keyed by id.
- Each record carries `createdBy` (a note, its `author`): the account that
  created it, from `env::caller()`.
- `currency: Cell<String>`, `rotting_days: Cell<u32>` — pipeline settings.
- Money is `u64` whole units of the pipeline currency; no floats.

`listDeals` returns each deal with its next activity, open-activity count,
last touch and contact name, computed in one pass over activities and notes.

## Run it

```bash
pnpm install                       # once, at the repo root
rustup target add wasm32-wasip2    # once
pnpm dev:local mero-crm            # merod local + build + deploy + http://localhost:5173/
meroctl local dev apps/mero-crm    # the same with core's meroctl (1.0.0-rc.24 or later)
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser:
**create an account** (a passkey), **create a workspace**, **add a pipeline**,
add deals. **Invite** someone from the Members page; a second browser profile
with its own passkey opening that link is a second member.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-crm/logic/Cargo.toml` | v1's `TestHost` tests method for method; v1's storage write rules (`Authored` notes, `WriteOnce` creation stamps) as the same calls made by other accounts; v1's convergence test under one log; access, API keys, wire checks, list sizes; and every `scenarios/*.json` | no |
| `pnpm -F mero-crm test` | the generated client has exactly the committed ABI's methods, sent as calls or views with its parameter names, and syncs the session after each; the wire-to-view mapping (u64 strings to numbers); sign-in, the remembered workspace and its pipelines, the invitation prompt (mocked client); the deal assistant, roles, names, theme | no |
| `pnpm merod-local e2e mero-crm` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

`smoke.json` is the v1 smoke workflow (`logic/workflows/smoke.yml`, removed) as two accounts (node 1
is `owner`, node 2 is `bob`): settings, stages, an automation, a contact, a
deal moved into the automated stage, an activity, the note and deal gates,
won/reopened/lost, cleanup, and every event bob hears. `access.json` adds what
v1 kept in storage: only the creator deletes a deal or a contact (not the app
owner, not an admin), only the author deletes a note, a guest works the board,
outsiders and anonymous callers never reach the app, and v1 names or wrong
argument types are refused.

## What changed in the port, and why

Same methods, same arguments, same answers and events, renamed to the
component ABI's conventions. What a client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `create_deal`, `list_deals`, `get_deal`, `move_deal`, `mark_won`, … (33) | the same in camelCase: `createDeal`, `listDeals`, `getDeal`, `moveDeal`, `markWon`, … | the ABI names methods in camelCase |
| argument names | `deal_id`, `stage_id`, `contact_id`, `expected_close`, `job_title`, `due_at`, `due_in_days`, `activity_id`, `note_id`, `automation_id`, `stage_ids` | `dealId`, `stageId`, `contactId`, `expectedClose`, `jobTitle`, `dueAt`, `dueInDays`, `activityId`, `noteId`, `automationId`, `stageIds` | and arguments too |
| u64 arguments | numbers | decimal strings: `value`, `expectedClose`, `dueAt` (`"24000"`) | a `u64` travels as a decimal string |
| result fields | snake_case | **unchanged** (snake_case: `stage_id`, `created_by`, `rotting_days`, …) | the results are plain structs; keeping v1's names kept every screen as it was |
| u64 result fields | numbers | decimal strings: `value`, `expected_close`, `stage_entered_at`, `closed_at`, `last_touch_at`, `created_at`, `due_at`, `done_at`, `won_value` | the same; `app/src/crm.ts` turns them back into numbers |
| event fields | `DealCreated { id, stage_id }`, `DealMoved { id, stage_id }`, `AutomationFired { automation_id, deal_id }`, `NoteChanged { id, deal_id }` | `stageId`, `automationId`, `dealId` | event data is camelCase |
| `StagesChanged`, `AutomationsChanged`, `SettingsChanged` | `{}` | no data | unit events |
| events | emitted with the write, to the context | after the write, to everyone the app reaches (`Audience::All`) | an event describes a write that happened |
| errors | `"not found: deal …"`, `"invalid input: …"`, `"forbidden: …"` message strings | `422 APP_ERROR` `{ code: "NotFound", fields: { what, id } }`, `{ code: "Invalid", fields: { message } }`, `{ code: "Forbidden", fields: { message } }`; the messages are v1's without the prefix | `#[app::error]`'s wire shape |
| reads | any method | `getSettings`, `listStages`, `listDeals`, `getDeal`, `listContacts`, `listActivities`, `listAutomations` are views; a write called as a view is `NotAView` | a view is answered without touching the log |
| `listDeals` | every match, newest first | at most the newest 1,000 matches | multi-row reads are pages |
| `listContacts`, `listActivities` | every row | at most 1,000 (the first by name, the first by due date) | the same |
| `getDeal` | every activity and note | at most 1,000 of each | the same |
| `deleteDeal` | removed the deal, its activities and the deleter's own notes; other members' notes stayed in storage, unreachable | removes the deal, its activities and all its notes | nothing unreachable is left behind; what a client saw is the same |
| who created it | the owner stamp of a write-once `created_by` entry; a second claimant made the creator `""` | a `createdBy` field set from `env::caller()` and checked in the method; never `""` except on the seeded stages | one leader applies every write: the method is the check |
| `deleteNote` by someone else | `Forbidden` | `Forbidden` | unchanged |
| `updateDeal` / `updateContact` | wrote only the fields that changed, so a concurrent edit to another field survived | writes every field | the log orders the calls; there is no concurrent merge |
| concurrent edits | `LwwRegister`s merged by timestamp | the later call holds | no CRDT merge under one log |
| a deal moved into a stage deleted concurrently | shown in the first stage | cannot happen (deleting a stage with open deals is refused, in the same log); a closed deal reopened after its stage was deleted is still shown in the first stage | the same rule, one case fewer |
| a stage's automations | capped at 10 when a deal enters it (a patched node could plant more) | `addAutomation` refuses the 11th | every write goes through a method |
| who may call | any member of the namespace | any owner, admin, member or guest of the workspace's org; anonymous `401`, others `404`; an API key acts as its account | the org is the access boundary |
| the bundle | `services/crm.wasm`, a context created with `serviceName: crm` | one `app.wasm`; instances created from the package | a component bundle is one app |

The frontend changed with it, and keeps its screens: the landing page, the
pipeline board with drag and drop, deals, the deal page with the assistant,
activities, contacts, insights, settings, the members table with roles and
permissions, aliases, the light/dark theme. Behind them:

- **gone**: mero-react's `MeroProvider` and node login popup, the generated
  `CrmClient` and its codegen, the desktop SSO hand-off, the v1 invitation
  link codec (deflate + base58 payload), namespace/context/alias plumbing, the
  "syncing"/"warming up" states of a joined context, TEE node badges (every
  1.0 node is attested before the client sends it anything),
  `studio.config.json`, the app-root `package.json` (`cargo mero` and v1 smoke-test
  scripts), the Playwright suites that drove v1 nodes, and
  `vite-plugin-node-polyfills`;
- **new**: `src/session.ts` + `src/sessionContext.tsx` (target → client →
  passkey sign-in/up, the stored session), `src/workspaces.ts` (orgs, app
  instances, invites, member names), `src/generated/` (`MeroCrmClient`:
  `meroctl app codegen` from `logic/res/abi.json`, committed; `pnpm -F
  mero-crm codegen` after a contract change, and CI fails when it is stale),
  `src/crm.ts` (v1's shapes and the conversion of each answer to them: the ABI
  names its records without their shapes, so the generated types are
  `unknown`), a passkey sign-in dialog
  as the landing page's connect action, the invitation prompt after sign-in;
  teammates' changes arrive on the app's event stream (`client.events`), and
  org-level changes (a new pipeline, a new member) are re-read on window focus.
- **URLs**: the app still lives at `/crm` (`/crm/deals/:id`, `/crm/members`,
  …); an invitation is `/?invite=<token>`. The dev server is on
  `http://localhost:5173/` (the origin `merod local` trusts), not 5186.

`mobile/` is **not ported**: the native apps use the swift-sdk / kotlin-sdk
v1 session, and those SDKs have no Calimero 1.0 client yet;
`mobile/README.md` says what they wait for.

**Mero Forms** (still a v1 app) hands responses to v1 CRM pipelines. Its
generated `CrmClient` now comes from the v1 ABI frozen in
`apps/mero-forms/app/src/fixtures/abi/mero-crm-v1.json`, and its journey's CRM
fixture bundle is built from the last v1 commit
(`apps/mero-forms/logic/build-multi-service-bundle.sh`).

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start
without two variables set where the bundle's frontend is built:

```
VITE_CALIMERO_CLUSTER=<cluster name in the cloud's node directory>
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
```

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`),
which the cluster serves from the package's own origin: a Cloud node trusts
passkey ceremonies only from its own origins and from frontends it serves from
a bundle. Instances are created from the package (`com.calimero.mero-crm`).
The `frontend` link in `logic/Cargo.toml` and the Vercel project
(`app/vercel.json`) stay as the listing's link.

```bash
pnpm -F mero-crm build
meroctl app pack apps/mero-crm/logic --key <production key> --app-version <x.y.z>
```

The package id stays `com.calimero.mero-crm`, but a 1.0 cluster starts from
no v1 data: v1 workspaces, pipelines and deals are not migrated.

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").
