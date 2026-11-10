# mero-issue-tracker

A private, real-time issue board for a small engineering team, on
[Calimero](https://calimero.network) 1.0: a contract on core's **component
SDK** (`calimero-sdk`, a `calimero:app` WebAssembly component on the
node's wasmtime runtime), developed on **`merod local`**, with a frontend on
mero-js's **`CalimeroClient`** that talks to a **Calimero Cloud** cluster in
production and to the local nodes in development.

Issues use a structured format built for handing bugs to a coding agent:

- **Summary** - what is wrong, in one or two sentences.
- **Impact** - who or what it affects and how badly.
- **Repro** - the steps, logs, or conditions that trigger it.
- **Resolution criteria** - what "fixed" must satisfy.

Plus status, priority, assignee, labels, and a per-issue comment thread.
Two surfaces make it agent-friendly: a **Copy fix prompt** button on each
issue, and an **MCP server** (`mcp/`) that lets an agent create, list, read,
comment on, triage and assign issues.

```
apps/mero-issue-tracker/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           issues, comments, labels (Tables), the repo URL (Cell)
│   ├── tests/harness.rs     TestApp: every method on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           smoke, permissions (+ .org.json): harness AND merod local
│   ├── res/abi.json         the component's ABI (committed, diffed in CI)
│   └── GUIDE.md             the agent guide the bundle carries
├── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
├── mcp/                     the stdio MCP server (mero-js CalimeroClient + an API key)
├── recipes/                 reference modules for other patterns (1.0 client + component SDK)
└── mobile/                  native iOS/Android apps (ported in #691; see below)
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## The model

| | what it is |
|---|---|
| **workspace** | an organization (`createAppOrg`), with this app's own **app team** in it (below); its people are the team |
| **repository** | an instance of this app in the organization (`createApp(name, source, { org })`), named after the repo, holding its issues and its GitHub URL |
| **invitation** | an org invite naming the app team (`appInvite`, a passkey step-up), shared as a link to this frontend; the invitee signs in and confirms |
| **member names** | org member metadata `{ name }` (Members -> Set my alias) |
| **roles** | the org's: owner and admins hold every capability; members get the workspace default (add repos, invite), which admins change per member |

### Mero Issue Tracker's app team

An organization can hold several apps, each with its own **app team**
(core#4890; see Calimero Home's README). This app reaches its organization
only through `@calimero-apps/connect`'s org-app module
(`scripts/check-org-app-module.py` fails CI otherwise):

- A new workspace gets the app's team at once, **open** (`standalone`:
  everyone in the org has the app). New repositorys use `{ kind: "team" }` access
  on it, invites name it (`appInvite`), and the member list is its people
  (`appPeople`).
- Once an admin keeps the org's apps apart in Calimero Home (`shared`), an
  invite gives Mero Issue Tracker only (the dialog says so), the member list shows its
  people, and **Remove** takes someone out of Mero Issue Tracker (its team), never out of
  the organization. In standalone and legacy orgs Remove is out of the org,
  as before.
- Adding Mero Issue Tracker to an organization whose apps have teams makes its team
  first: owners and admins only (anyone else is told so), open in an open org
  and closed in one that keeps its apps apart.
- An organization from before app teams stays **legacy** (organization
  access, org-wide invites) until an admin gives the app its own access list
  in Calimero Home. Under `pnpm dev:local` the app runs from a raw bundle,
  which has no package, so every workspace is legacy there.

Every member of the workspace may read and triage every issue. Only a
comment's author may edit or delete it, and only an issue's creator may delete
it; the contract checks both against the caller and answers `Forbidden`.

## Run it

```bash
pnpm install                              # once, at the repo root
rustup target add wasm32-wasip2           # once
pnpm dev:local mero-issue-tracker         # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser:
**create an account** (a passkey), **create a workspace**, **add a repository**,
file issues. **Invite** someone from the Members page; a second browser profile
with its own passkey opening that link is a second member.

## Use it from Claude Code (MCP)

1. In the app, open **Members -> Agent key** and create a key (your passkey
   approves it). It shows the environment the server needs, once.
2. Register the server with those values:

   ```bash
   claude mcp add issue-tracker --scope user \
     --env CALIMERO_TARGET=cloud --env CALIMERO_CLUSTER=<cluster> \
     --env CALIMERO_MIN_RELEASE=<release> --env CALIMERO_API_KEY=<key> \
     --env TRACKER_WORKSPACE=<workspace id> --env TRACKER_REPO=<repo name> \
     -- npx -y @calimero-network/mero-issue-tracker-mcp
   ```

   (Against `pnpm dev:local`, the key's environment says `CALIMERO_TARGET=local`
   and names the dev bundle.)
3. Talk to it: "list the repos in the tracker", "file an issue in repo core:
   ...", "move ISS-3 to In progress", "get the fix prompt for ISS-3".

`mcp/README.md` has every tool and variable. The key acts for your account:
issues and comments the agent files are yours, and it may delete only what
you may.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-issue-tracker/logic/Cargo.toml` | v1's `TestHost` tests method for method; v1's storage write rules (`Authored`) as the same calls made by other accounts; v1's convergence test under one log; access, API keys, wire checks, list sizes; and every `scenarios/*.json` | no |
| `pnpm -F mero-issue-tracker test` | the methods the UI calls are exactly the committed ABI's, with its parameter names; the wire-to-view mapping; sign-in, the remembered workspace and its repos, the invitation prompt (mocked client); roles, names, search, fix prompt | no |
| `cd mcp && npm test` | the MCP tools' requests (method names, call vs view, arguments), workspace/repo resolution, config | no |
| `pnpm merod-local e2e mero-issue-tracker` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

The scenarios are ported from the v1 smoke workflow (`logic/workflows/smoke.yml`, removed):
`smoke.json` walks it as two accounts (node 1 is `owner`, node 2 is `bob`):
repo URL, an issue, status, priority, assignee, labels, a comment, the
non-author edit refused, the author's edit and delete, and every event bob
hears. `permissions.json` adds what v1 kept in storage: only the creator
deletes an issue (not the app owner, not an admin), only the author edits or
deletes a comment, triage is shared (a guest moves an issue), outsiders and
anonymous callers never reach the app.

## What changed in the port, and why

Same methods, same arguments, same answers and events, renamed to the
component ABI's conventions. What a client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `create_issue`, `set_status`, `list_issues`, `get_issue`, `get_status_counts`, `set_repo_url`, `get_repo_info`, `add_label`, `remove_label`, `add_comment`, `edit_comment`, `delete_comment`, `delete_issue`, `set_summary`, `set_impact`, `set_repro`, `set_resolution_criteria`, `set_priority`, `set_assignee` | the same in camelCase: `createIssue`, `setStatus`, `listIssues`, … | the ABI names methods in camelCase |
| argument names | `issue_id`, `resolution_criteria`, `comment_id`, `new_body` | `issueId`, `resolutionCriteria`, `commentId`, `newBody` | and arguments too |
| result fields | `resolution_criteria`, `created_by`, `created_at`, `issue_id`, `edited_at`, `repo_url` | `resolutionCriteria`, `createdBy`, `createdAt`, `issueId`, `editedAt`, `repoUrl` | results are camelCase |
| `createdAt`, `editedAt`, status `count` | numbers | decimal strings (`"1700000000000"`) | `u64` travels as a decimal string |
| event fields | `IssueCreated { id, created_by }`, `CommentAdded { id, issue_id }` | `IssueCreated { id, createdBy }`, `CommentAdded { id, issueId }` (the other events unchanged) | event data is camelCase |
| events | emitted with the write, to the context | after the write, to everyone the app reaches (`Audience::All`) | an event describes a write that happened |
| errors | `{"kind":"NotFound","data":"issue-…"}`, `Invalid`, `Forbidden` with a message string | `422 APP_ERROR` `{ code: "NotFound", fields: { id } }`, `{ code: "Invalid", fields: { message } }`, `{ code: "Forbidden", fields: { message } }`; the messages are v1's | `#[app::error]`'s wire shape |
| reads | any method | `listIssues`, `getIssue`, `getStatusCounts`, `getRepoInfo` are views; a write called as a view is `NotAView` | a view is answered without touching the log |
| `listIssues` | every match | at most the first 1,000 matches, oldest first | multi-row reads are pages |
| `getIssue` comments | every comment | at most the first 1,000, oldest first | the same |
| `deleteIssue` | removed the issue, its labels and the deleter's own comments; other people's comments stayed in storage, unreachable | removes the issue, its labels and its whole thread | nothing unreachable is left behind; what a client saw is the same |
| who wrote it | an `Authored` owner stamp each node checked on a peer's write | `createdBy` / `author` fields, set from `env::caller()` and checked in the method | one leader applies every write: the method is the check |
| a triage row removed by a patched node | read as a fresh `Open` issue | cannot happen: no write skips the method | the same |
| concurrent triage | `LwwRegister`s merged by timestamp | the log orders the calls; the later one holds | no CRDT merge under one log |
| labels | could not contain `\u{1}` (the index key separator) | any 1-64 characters | labels are keyed `(issueId, label)` |
| who may call | any member of the workspace | any owner, admin, member or guest of the workspace's org; anonymous `401`, others `404`; an API key acts as its account | the org is the access boundary |
| an omitted `Option` argument | `null` | `null` (still optional); unknown keys and wrong types are `BadArgs` | the generated dispatcher |
| the bundle | `services/issue-tracker.wasm`, a context created with `serviceName` | one `app.wasm`; instances created from the package | a component bundle is one app |

The frontend changed with it, and keeps its screens: the landing page, the
list, the board, the routed issue detail, filters, search, My Issues, the
members table with roles and permissions, aliases, the fix prompt, the
light/dark theme. Behind them:

- **gone**: mero-react's `MeroProvider` and node login popup, the generated
  `IssueTrackerClient` and its codegen, the desktop SSO hand-off, the v1
  invitation link codec (deflate + base58 payload, `links.calimero.network`),
  namespace/context/alias plumbing, the "syncing"/"warming up" states of a
  joined context, TEE node badges (every 1.0 node is attested before the
  client sends it anything), `studio.config.json`, the Playwright suites that
  drove v1 nodes (Docker, `merod` 0.x), and `vite-plugin-node-polyfills`;
- **new**: `src/session.ts` + `src/sessionContext.tsx` (target -> client ->
  passkey sign-in/up, the stored session), `src/workspaces.ts` (orgs, app
  instances, invites, member names), `src/tracker.ts` (the contract by method
  name, mapped onto the shapes the screens render; a test pins its method list
  to `logic/res/abi.json`), a passkey sign-in dialog as the landing page's
  connect action, the invitation prompt after sign-in, and **Members -> Agent
  key** for the MCP server;
- **URLs**: the app still lives at `/issue-tracker` (`/issue-tracker/board`,
  `/issue-tracker/issues/:id`, `/issue-tracker/members`); an invitation is
  `/?invite=<token>`.

`mobile/`, the native iOS and Android apps, moves to Calimero 1.0 in its own PR,
#691, which is built against this contract's ABI. Until #691 merges,
`mobile/` holds the v1 apps.

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start
without two variables set where the bundle's frontend is built:

```
VITE_CALIMERO_CLUSTER=<cluster name in the cloud's node directory>
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
```

An operator's own attested node is reached by URL instead:
`VITE_CALIMERO_TARGET=node`, `VITE_CALIMERO_NODES=<its https URLs>` and the same
release floor. The target is fixed by the build: nobody picks a node or a
cluster at sign-in. The Agent key's environment follows the build's target
(`CALIMERO_TARGET=local`, `cloud` or `node`).

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`),
which the cluster serves from the package's own origin: a Cloud node trusts
passkey ceremonies only from its own origins and from frontends it serves from
a bundle. On that page the client takes the cluster's nodes from
`/.well-known/calimero.json`, and instances are created from the package
(`com.calimero.mero-issue-tracker`). The `frontend` link in `logic/Cargo.toml`
and the Vercel project (`app/vercel.json`) stay as the listing's link.

```bash
pnpm -F mero-issue-tracker build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-issue-tracker/logic --key <production key> --app-version <x.y.z>
```

The package id stays `com.calimero.mero-issue-tracker`, but a 1.0 cluster
starts from no v1 data: v1 workspaces, repos and issues are not migrated.

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").
