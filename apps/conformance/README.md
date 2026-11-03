# Conformance — every call a client makes, on 1.0

A rig with no product purpose: a matrix that runs every call a component app's
client (mero-js's `CalimeroClient`, through `@calimero-apps/connect`) makes, on
a Calimero 1.0 cluster, and reports one row per check — name, who called,
expected outcome, actual outcome, error text, duration. It exists so one place
proves, before an app or a core release ships, that each call behaves as the
apps assume: it succeeds and reads back what was written, or it is refused
**by name**.

A row passes only when what happened is what it expects: `ok`; a refusal the
node names (`NOT_FOUND`, `CONFIRM_REQUIRED`, `FORBIDDEN`, `UNAUTHENTICATED`,
`BAD_PACKAGE`, `NO_REGISTRY`, …); an app's own typed refusal
(`APP_ERROR:<code>`); or a trap (`TRAP`). Anything else fails — an unnamed
error, a value read back wrong, a timeout — and no row is ever marked expected
because it fails today.

```
apps/conformance/
├── logic/                     the contract the matrix calls (component SDK, standalone crate)
│   ├── src/lib.rs             one method set per storage kind, a confirm method, a public view
│   ├── tests/harness.rs       TestApp: every method on core's real wasmtime engine
│   ├── tests/scenarios.rs     every scenarios/*.json in the harness
│   ├── scenarios/             storage-kinds, access (+ .org.json): harness AND merod local
│   └── res/abi.json           the component's ABI (committed, diffed in CI)
├── app/                       the matrix (src/conformance/) and the page that runs it
│   ├── src/conformance/       matrix.ts, contract.ts (typed adapter), check.ts, mpk.ts, env.ts
│   └── cluster/               the matrix from Node on a running cluster (`test:cluster`, CI)
└── v0/                        the 0.x rig (mero-react, mock-TEE relay, mero-auth, Traefik), unchanged
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## Run it

```bash
pnpm install                       # once, at the repo root
rustup target add wasm32-wasip2    # once
pnpm dev:local conformance         # merod local + build + http://localhost:5173/
```

Open `http://localhost:5173/` (that origin exactly: it is the one `merod local`
trusts passkey ceremonies from), pick the built component
(`apps/conformance/logic/res/conformance.wasm`, which `dev:local` just built)
and press **Run the matrix**. The page signs up its own accounts with software
passkeys, so no passkey prompt appears, and fills the table row by row.

From Node, against a cluster already running (`pnpm merod-local up`):

```bash
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- build apps/conformance/logic
pnpm -F conformance-1.0 test:cluster
```

That runs the same matrix with the same clients (`@calimero-apps/connect`'s
`createClient` for a local target), writes
`app/test-results/conformance-report.json`, prints every row, and fails on any
row that is not as expected.

| env | default | what |
| --- | --- | --- |
| `CONFORMANCE_WASM` | `logic/res/conformance.wasm` | the built component |
| `CONFORMANCE_NODES` | merod local's `127.0.0.1:2501-2503` | the cluster's nodes, comma-separated |
| `CONFORMANCE_ORIGIN` | `http://localhost:5173` | the origin the software passkeys answer for: one the cluster trusts |

**Every write lands on the cluster**: accounts, an org, apps, packages, blobs.
The run cleans up what it can (apps, teams, the org, the package), but the
accounts stay. Point it only at a cluster you mean to test.

## Test it

| | what it covers | needs a node |
| --- | --- | --- |
| `cargo test --manifest-path apps/conformance/logic/Cargo.toml` | every contract method on core's wasmtime engine: the author and writer checks, the step-up, typed errors, the trap, access (anonymous, outsider, guest, a removed member), malformed calls; and every `scenarios/*.json` | no |
| `pnpm -F conformance-1.0 test` | the adapter's methods and parameter names are exactly the committed ABI's; row classification; the package signer (its signature verifies); the matrix runs to the end when every request fails; the page | no |
| `pnpm merod-local e2e conformance` | every `scenarios/*.json` as real accounts on `merod local` (components.yml's `e2e` job) | yes |
| `pnpm -F conformance-1.0 test:cluster` | the whole matrix on `merod local` (conformance.yml's `matrix` job) | yes |

## The 1.0 matrix (`app/src/conformance/matrix.ts`)

The 0.x matrix ran every admin and RPC call mero-react makes twice — once on a
node connection, once on an account behind a relay — because the two paths
differed. On 1.0 there is one path: every person is an account with a passkey,
every node of the cluster serves every account, and every request is sealed to
an attested node. So there is one run, and the "mode" axis becomes **who
calls**: account **A** (the run's subject, signed up on node 1), account **B**
(on node 2, invited into A's org, reads what A wrote and writes for A to read),
an **outsider** (node 3, in no org), an **anonymous** client and an **API key**.

| phase | rows |
| --- | --- |
| accounts | `signUp` ×3, `me`, `signIn` (same passkey, another node), `refresh` (a new single-use refresh token), `attestation`, `usage`, `labelPasskey`, `addPasskey` (self-approval refused, `UNKNOWN_CHALLENGE`; approved), `signIn` (added passkey), `removePasskey` (412 without the step-up; done) |
| packages | `uploadBundle`, `uploadPackage` (garbage refused, 0.0.0, 0.0.1, another key refused), `packages`, `package`, `installPackage` (`NO_REGISTRY` on a dev cluster) |
| orgs, teams | `createOrg`, `getOrg`, `setOrgMetadata`, `createTeam` ×3, `getTeam`, `updateTeam` (name + metadata, parent, join), `setCapabilities` (default), `invite` (412; member; guest with teams, uses and TTL), `redeemInvite` (and again: one use, `REJECTED`), `getOrg` (B; an outsider refused), `setMemberMetadata` ×2 |
| apps | `createApp` (bundle; package ×2; team access ×2; no org), `listApps` (all; by bundle; by package; B's), `getApp`, `setAppMetadata`, `appAbi`, `setAlias`/`alias`/`aliases`/`deleteAlias` (another account's alias refused) |
| calls | `call` with an idempotency key (a retry answered once), `view`, stale `view` with `minIndex` on another node, a `u64` result, `myAccount` ×2, one write and read-back per storage kind as A and B (user, frozen, authored map, authored vector, shared with its writer set), `callConfirmed` (412; A; B), an app error, a trap, `BadArgs`, `UnknownMethod`, `NotAView` |
| access | outsider view/call refused, anonymous refused, an open team's app reached by inheritance, an invite-only team's app refused, `setAccess` (accounts; public) and a public method read anonymously while a non-public one is refused, `createApiKey` (412; read-only for one app), `listApiKeys`, an API key's view (acts as A) and write (refused), `revokeApiKey` |
| members | `setMember` (promote, demote), `setTeamMember` (member → reaches the team's app; lead + capabilities; read-only → its write refused), `setCapabilities` (on a team; org-wide), `removeTeamMember` |
| events, presence | each account's stream hears the other's writes, a new stream replays from index 0; `publishPresence`, `presence`, `presenceStream` (snapshot first), retract |
| blobs | `uploadBlob`, `blobInfo`, `listBlobs` (the upload is listed), `downloadBlob` (A by hex id, B by base58 id), refused through another app, `deleteBlob`, `blobInfo` after it. A component app's blobs are its own host records since core 1.0.0-rc.8 (R8, core #4815); rc.7 refused them (`409 NOT_SUPPORTED`), which `BLOBS` in `matrix.ts` can be set back to for a node without them |
| upgrades, releases | `upgradeApp` (412; to 0.0.1, state kept), `listApps` at 0.0.1, `upgradeOrg`, `upgradeRun` until finished, `retryUpgradeRun` (nothing left), `releaseRules`, `pendingApprovals`, `appsReport`, `approveRelease` (org, account, withdrawn; a member without the capability refused), `approveOutbound` |
| teardown | `transferApp`, B leaves (`removeMember` itself) and is cut off, `deleteApp` ×5, `getApp` refused, `deleteTeam` (with its sub-team), `deleteOrg` (412; done; `getOrg` refused), `uninstallPackage`, `signOut`, `signOutEverywhere` (another device's session ends) |

The matrix makes its own two releases of a per-run package
(`com.calimero.conformance.run-<tag>`, `mpk.ts`): the built component with a
different trailing custom section each, signed with a fresh Ed25519 key, as
core's `calimero-bundle` signs. A development cluster takes any signer.

### From the 0.x matrix to 1.0

| 0.x area | 0.x rows (mero-react `AdminApiClient`, JSON-RPC) | 1.0 (`CalimeroClient`) |
| --- | --- | --- |
| Identity | `getNodeIdentity`, `getContextIdentitiesOwned`, `my_account` | `me`, `signIn` on another node, `myAccount` (the contract's view of the caller) |
| Namespaces | `createNamespace`, `listNamespaces`, `listNamespacesForApplication`, `getGroupInfo`, `createNamespaceInvitation`, `joinNamespace`, `leaveNamespace`, `deleteNamespace` | orgs: `createOrg`, `getOrg`, `invite`, `redeemInvite`, `removeMember` (self: leave), `deleteOrg` |
| Groups | `createGroupInNamespace` (open, restricted), `listSubgroups`, `listGroupMembers`, `getMemberCapabilities`, `setDefaultCapabilities`, `setSubgroupVisibility`, `setGroupMetadata`, `setMemberMetadata`, `reparentGroup`, `addGroupMembers`, `updateMemberRole`, `setMemberCapabilities`, `removeGroupMembers`, `joinSubgroupInheritance`, `leaveGroup`, `deleteGroup` | teams: `createTeam` (`everyone` / `invite`), `getTeam` and `getOrg` (members, capabilities), `setCapabilities` (default; member; member on a team), `updateTeam` (join, metadata, name, parent), `setMemberMetadata`, `setTeamMember` (add, role, lead, capabilities), `setMember` (org role), `removeTeamMember`, inherited reach of an open team, `deleteTeam` |
| Contexts | `createContext`, `getContexts`, `getContext`, `getContextGroup`, `setContextMetadata`, `joinContext`, `leaveContext`, `detachContextFromGroup`, `deleteContext` | apps: `createApp` (`{ org }`, team access), `listApps`, `getApp` (owner, org), `setAppMetadata`, reached through the org (no join), `setAccess`, `transferApp`, `deleteApp` |
| RPC writes | `set`/`get`, `set_user_simple`/`get_user_simple(_for)`, `add_frozen`/`get_frozen`, `authored_insert`/`authored_get_owner`, `authored_vec_push`/`authored_vec_get_owner`, `shared_set`/`shared_get` | the same methods on this app's contract, camelCase, as A and B; plus idempotency, stale views, `callConfirmed`, typed errors, a trap |
| Blobs | `uploadBlob` (announced to a context), `getBlobInfo`, `getBlob`, `deleteBlob` | `uploadBlob(app)`, `blobInfo`, `listBlobs`, `downloadBlob`, `deleteBlob` (component apps have blobs since core 1.0.0-rc.8) |
| Events | SSE subscription per context (`useSubscription`) | `events(app, from)` per account |
| Presence | `ephemeral` publish/subscribe (`useEphemeral`) | `publishPresence`, `presence`, `presenceStream` |
| Aliases | context, application and device aliases: create, lookup, list, delete | app aliases per account: `setAlias`, `alias`, `aliases`, `deleteAlias` |
| Devices | `listAccountDevices`, `revokeAccountDevice` | passkeys: `addPasskey`, `labelPasskey`, `removePasskey`; API keys; `signOut`, `signOutEverywhere` |
| Upgrades | `upgradeGroup` (cascade), `getGroupUpgradeStatus`, `getMigrationStatus`, `getCascadeStatus` | `upgradeApp`, `upgradeOrg`, `upgradeRun`, `retryUpgradeRun`, `appsReport` |
| TEE policy | `getTeeAdmissionPolicy`, `setTeeAdmissionPolicy` | `attestation` (verified by the client on every node before anything is sent), `releaseRules`, `pendingApprovals`, `approveRelease`, `approveOutbound` |

### 0.x rows with no 1.0 equivalent

| 0.x row | why there is none |
| --- | --- |
| everything run twice, node mode and account mode (`NotForAccountError`, `NoRelayError`, `AdminOnly`) | 1.0 has one path: every caller is an account, every node serves it. There are no node-only calls, so no refusal-by-mode to check |
| the rig seating a relay as `RelayTee`, `CAN_AUTHOR_ON_BEHALF`, invitations naming admitters | there are no relays: the cluster's nodes hold every account's apps; an invite names an org and a role |
| `joinContext`, `leaveContext` (`NotDirectMember` included) | an app is reached through the org (or its access setting), not joined; leaving the org is `removeMember` on oneself |
| `getContextIdentitiesOwned`, `generateContextIdentity` | no per-context identities: the caller is the account |
| `syncContext` | one replicated log per app: nothing to sync |
| `detachContextFromGroup` | an app's org is fixed at creation; `setAccess` and `transferApp` are what changes who reaches or owns it |
| `listNamespacesForApplication` | no application id: apps are instances of a bundle or a package, listed with `listApps({ bundle })` / `listApps({ package })` |
| `createGroupInvitation` (a subgroup) | an org invite names the teams it adds the invitee to (`invite(org, role, passkey, teams)`) |
| `getMigrationStatus`, `getCascadeStatus` | an upgrade's outcome is the `upgradeApp` answer itself, or the `upgradeRun`; the component SDK has no migrations yet (`#[app::migrate]`) |
| `getTeeAdmissionPolicy`, `setTeeAdmissionPolicy` | admission is the cluster's: the client verifies each node's attestation itself, and an org approves releases (`approveRelease`) instead of setting measurements |
| device aliases, `listAccountDevices`, `revokeAccountDevice` | no devices: an account's credentials are its passkeys (and API keys), managed with the rows above |
| a blob announced to a context | a blob belongs to an app; another app is refused it (a row checks that) |

## The contract (`logic/`)

The 0.x matrix called core's `apps/scaffolding-e2e` (a v1 contract); this is
that contract's counterpart on the component SDK, cut down to what the matrix
calls. Same methods, arguments and events; what a client sees differently:

| | scaffolding-e2e (v1) | now | why |
| --- | --- | --- | --- |
| method names | `my_account`, `set_user_simple`, `get_user_simple_for`, `add_frozen`, `get_frozen`, `authored_insert`, `authored_get_owner`, `authored_vec_push`, `authored_vec_get_owner`, `shared_set`, `shared_get`, … | `myAccount`, `setUserSimple`, `getUserSimpleFor`, `addFrozen`, `getFrozen`, `authoredInsert`, `authoredGetOwner`, `authoredVecPush`, `authoredVecGetOwner`, `sharedSet`, `sharedGet`, … | the ABI names methods and arguments in camelCase |
| `get_user_simple_for` argument | `user_key` (core) / `account_hex` (apps repo copy) | `account` | one name; an account id, not a key |
| `get_frozen` argument | `hash_hex` | `hashHex` | camelCase |
| `authored_vec_push` result, indexes | a number (`usize`) | a decimal string (`"0"`) | `u64` travels as a decimal string |
| `get_frozen` on a missing or malformed hash | `{"kind":"FrozenNotFound"}` / `NotFound("dehex error")` | `422 APP_ERROR` `FrozenNotFound { hashHex }` for both | `#[app::error]`'s wire shape |
| `shared_get` before any write | an error | `null` | an unset `Cell` reads as none |
| who may write the shared value | the context's creator (`init`'s executor), then added writers | the app's owner (`init` runs as the owner), then accounts a writer adds; others `NotAWriter { account }` | the writer set is a `Set` of accounts checked by the method |
| authored entries | per-owner `AuthoredMap` / `AuthoredVector`, enforced when a signed delta is applied | a map keyed by `(key, author)` and a vector of `{ value, owner }`, enforced by the method: changing another's entry is `NotAuthor { key }` / `NotItemOwner { index }` | one log, no deltas to verify |
| `authored_get_owner` with two authors | the first by entry id | the first by account id | rows are ordered by key |
| events | before the write | after it, to everyone the app reaches; `UserSimpleSet { account, value }` (v1 `executor_id`), `AuthoredVecPushed { index, value, owner }` (v1 `entry_id`) | an event describes a write that happened; ids are accounts and positions |
| new | — | `confirmedSet` (`#[app::confirm]`), `publicGet` (`#[app::public]`), `getResult` (typed error), `getUnchecked` (trap), `authoredUpdate`, `authoredRemove`, `authoredVecUpdate`, `authoredVecLen`, `sharedAddWriter`, `sharedGetWriters`, `len`, `remove` | the 1.0 call kinds the matrix checks, and each author/writer check from both sides |
| left out | blobs, private storage, CRDT counters/registers/RGA, handlers, xcall, sorted maps | — | the 1.0 matrix checks the client; the component SDK has no blobs, private storage or handlers in a contract yet (docs/COMPONENT-APPS.md) |

`scenarios/storage-kinds.json` is the 0.x matrix's RPC rows as two accounts
(what `p:start`, `s:join` and `p:members` wrote and read back);
`scenarios/access.json` adds the guest, the outsider, anonymous callers, the
step-up, typed errors, a trap, malformed calls and a removed member.

## The page (`app/`)

The 0.x page was driven by a Playwright runner through `window.__conformance`
in two browser tabs, with mero-react's provider and a node or relay login. The
1.0 page needs neither: it resolves its target with `@calimero-apps/connect`
(`merod local` under `vite`, a Cloud cluster under `vite build`), signs up its
own accounts with software passkeys for its own origin, and runs the whole
matrix in the tab. CI runs the same `matrix.ts` from Node (`test:cluster`),
which keeps the job free of a browser. Running the browser half in CI too
(the CORS and WebCrypto paths a page takes) is a follow-up.

## The 0.x rig (`v0/`)

Kept, unchanged, until the 1.0 job has replaced it: the rig, its page and its
Playwright runner moved from `apps/conformance/{app,rig}` to
`apps/conformance/v0/{app,rig}` so the component app could take
`apps/conformance/app`. `pnpm --filter conformance test:rig` still runs it, and
`.github/workflows/conformance.yml`'s `rig` job still runs it against the newest
core 0.x release; see [v0/README.md](v0/README.md).
