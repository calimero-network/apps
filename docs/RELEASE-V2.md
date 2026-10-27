# Apps on release-v2 (Calimero Cloud)

release-v2 is the cloud-only release candidate: every app instance runs inside
attested TEE nodes (`merod-v2`) as one Raft group, instead of on each member's own
node with peer-to-peer CRDT sync. On this branch the workspace builds against
core's `release-v2` branch (see `Cargo.toml`).

## What carries over unchanged

- **Contracts.** The same WASM on the same runtime. All 28 contracts in this repo
  build against the release-v2 SDK and deploy and initialise on a 3-node cluster:
  `scripts/cloud-v2-smoke.py` (baseline in `scripts/cloud-v2-baseline.json`).
- **Storage collections.** `UserStorage`, `Authored`, `WriteOnce`, `Frozen` still work;
  the owner is the caller's account. Inside an app, `env::account_id()` and
  `env::executor_id()` are both the caller's account (there are no devices).

## What changes

| v1 | release-v2 |
| --- | --- |
| Context per group of members, created with init params | App instance, `POST /apps` with `initArgs` (JSON) |
| Namespaces, groups, invites on each node | Organizations, teams and invites in the cluster (`/orgs/*`) |
| Node identity + device keys, JWT from the node | Passkey sign-in or `cal_...` API keys, cluster session |
| `mero-js` `HttpClient` against your own node | `mero-js` `CalimeroClient` (attested, sealed) |
| Sync and conflicts between peers | One ordered log per app: calls are linearised, reads can be strong |

Per-app init arguments for the smoke run are in `scripts/cloud-v2-init-args.json`;
an app's frontend passes the same object as `initArgs` when it creates an instance.

## Run the smoke

```bash
# in core (branch release-v2)
cargo build -p calimero-cloud-node --bin merod-v2
# in calimero-client-py (branch release-v2): maturin develop
# here
cargo build --workspace --target wasm32-unknown-unknown --profile app-release
scripts/cloud-v2-smoke.py
```

It also runs one two-person flow (`battleships_two_players`): two accounts
register distinct player keys in one lobby and start a match.

## Workflows

Every app's merobox workflow has a release-v2 port beside it in
`apps/<app>/logic/workflows/cloud-v2/`, made by merobox's converter
(`scripts/port-workflows-to-cloud-v2.sh`) and run on merod-v2 by
`scripts/cloud-v2-workflows.py`, against contracts built with `cargo mero build`
(`scripts/build-cloud-v2-wasm.py`: merod-v2 reads handlers, xcall entry points,
timers and migrations from the embedded ABI). v1 nodes become accounts,
namespaces organizations, subgroups teams (open or restricted, with read-only
rows and capabilities), contexts deployed apps, paired devices passkeys, and
`wait_for_sync` disappears (a read sees every committed write). Each port's
header lists the v1 steps it dropped and why.

**79 of 80 pass** (`scripts/cloud-v2-workflows-baseline.json`; a regression fails
the script; the fuzzy soak runs 30 s here, `MEROBOX_FUZZY_SECONDS` to change).
Porting them brought merod-v2 to v1's feature set: blobs, full-text search,
event handlers, cross-app calls, TEE timers and sealed state, v1's subgroup
rules on teams, devices as passkeys, and upgrades whose migration is planned
from the ABIs and checked by the app.

The one that does not pass, `mero-docs/workflow-mero-docs-tags-views`, asserts
what a merge of two *partitioned* replicas leaves (the name Bob gave a tag while
he could not see Alice delete it). A cluster has no partitioned replica, so that
rename is refused instead; the property the test guards — a rename never
revives a deleted tag — holds. Reads made while a v1 node was stopped are not
asserted in any port, and writes made then may be refused; what the nodes
converge to afterwards is.

## Frontends

`apps/kv-store/app-cloud` is the first frontend on release-v2, beside the v1 app
it ports: passkey sign-up and sign-in (`browserPasskey`), a store per user
(`uploadBundle` + `createApp`), `call`/`view`, and live updates from `events`.
It depends on mero-js's `release-v2` branch (a scoped pnpm override in the root
`package.json`; mero-js builds on `prepare`). Its Playwright test starts
`merod-v2 local`, serves the app on `http://localhost:5173` and drives a real
passkey ceremony through Chromium's virtual WebAuthn authenticator:

```bash
cd apps/kv-store/app-cloud
KV_STORE_WASM=…/kv_store.wasm MEROD_V2_BINARY=…/merod-v2 pnpm test:e2e
```

Every other frontend runs on `@calimero-apps/cloud` (`packages/cloud`): v1's
app-facing API by name (`MeroProvider`, `useMero`, the hooks, `admin`, `rpc`,
`events`) running on release-v2's attested `CalimeroClient`. The mapping:

| v1 | release-v2 |
| --- | --- |
| namespace | organization |
| group / subgroup | the organization / a team (`orgId.teamId`) |
| context | app instance (context id = hex SHA-256 of the app id) |
| application id | signed package (`package:<name>[@<version>]`); a bundle hash on a dev cluster |
| member identity, executor | the account |
| node login, wallet enrolment | passkey sign-in on the cluster |
| signed open invitation | invitation token (carried inside v1's shape) |
| `/sse` | each app's committed event stream |

What the cluster lacks answers `NotOnCloudError` naming the method. The
provider installs the app's signed package from the registry when the cluster
lacks it (`packageName`); a development cluster can instead run a raw bundle
(`VITE_CALIMERO_BUNDLE`, or the page's own `app.wasm`).

Security defaults, all frontends:

- Mock quotes are refused unless a build sets `VITE_CALIMERO_ALLOW_MOCK=true`.
  Each app's `.env.development` sets it for `pnpm dev` against `merod-v2 local`;
  `pnpm build` never reads that file.
- The session token stays in memory; the tab keeps only the refresh token, in
  `sessionStorage`.
- Production builds carry a Content-Security-Policy `<meta>`
  (`@calimero-apps/cloud/vite`): scripts from the page's own origin, requests to
  the page, the cluster (`VITE_CALIMERO_URL`) and the registry.

Browser smoke for all of them (sign up through each app's own dialog, restore
the session on reload, the admin API on the cluster, no page errors):

```bash
MEROD_V2_BINARY=…/merod-v2 node scripts/cloud-frontend-smoke.mjs [app …]
```

App tests that drive admin flows use `@calimero-apps/cloud/testing`, an
in-memory cluster. `delegated-execution` is not ported: it demonstrates v1's
relays and warrants, which Calimero Cloud does not have
(`apps/delegated-execution/NOT-ON-CLOUD.md`).
