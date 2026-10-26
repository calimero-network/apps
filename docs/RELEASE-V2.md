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

## Not ported yet

Frontends still use the v1 client and node discovery. Porting one means replacing
the node URL + JWT setup with `CalimeroClient` (`signUp`/`signIn` with a passkey),
`createApp(name, bundle, { initArgs })` instead of context creation, and
`call`/`view`/`events` for execution and subscriptions.
