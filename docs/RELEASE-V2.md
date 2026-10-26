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
`scripts/cloud-v2-workflows.py`. v1 nodes become accounts, namespaces
organizations, invitations org invites, subgroups teams, contexts deployed
apps, and `wait_for_sync` disappears (a read sees every committed write). Each
port's header lists the v1 steps it dropped and why.

**58 of 80 pass** (`scripts/cloud-v2-workflows-baseline.json`; a regression fails
the script). Porting them found and fixed six merod-v2 gaps: init arguments,
caller identity, private storage, shared-storage writer rotation, context ids as
app ids, and a frozen-leader stall. The 22 that do not pass:

| Why | Workflows |
| --- | --- |
| **Blobs** — merod-v2 has no blob API yet | mero-models edit-a-scene, mero-sign e2e + e2e-test, scaffolding-e2e e2e |
| **Full-text search** — no search index host yet | mero-chat e2e, mero-docs docs-lifecycle |
| **Cross-app calls** (`xcall`) — not run yet | mero-sheets links, scaffolding-e2e workspace-registry |
| **Timers** — scheduled runs are not fired yet | hyperfeed feed |
| **v1 governance is the subject** — read-only and restricted subgroups as folders, devices, member capabilities | mero-docs (10 workflows), scaffolding-e2e group-membership |
| **v1-only tooling** — the fuzzy runner, v1 application-id migration | scaffolding-e2e fuzzy-test, mero-standup migrate-v1-v2 |

The first four are platform work in merod-v2. mero-docs models folders as nested
v1 subgroups with read-only and restricted visibility; on release-v2 that becomes
app-level roles over teams (`env::caller_org`), a change to the app, not the port.

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

The other frontends still use the v1 client and node discovery. Porting one means
replacing the node URL + JWT setup with `CalimeroClient` (`signUp`/`signIn` with a
passkey), `createApp(name, bundle, { initArgs })` instead of context creation, and
`call`/`view`/`events` for execution and subscriptions.
