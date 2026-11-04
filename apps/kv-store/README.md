# KV Store

The reference Calimero app, and the template every other app's port to the
1.0 runtime follows. A string key-value store: a contract on core's **component
SDK** (`calimero-app-sdk`, a `calimero:app` WebAssembly component on the node's
wasmtime runtime), developed on **`merod local`**, with a frontend on mero-js's
**`CalimeroClient`** that talks to a **Calimero Cloud** cluster in production
and to the local nodes in development.

```
apps/kv-store/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           #[app::state], #[app::logic], #[app::event], #[app::error]
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           simple-store, converge, access (+ .org.json): harness AND merod local
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
└── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local kv-store          # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), **create a store** (shared stores live in an
organization of their own, so you can invite others), and use it. A second
browser profile with its own passkey and the invitation link is a second member.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/kv-store/logic/Cargo.toml` | v1's `TestHost` tests method for method, v1's convergence tests as what they become under one log, access and wire checks, and every `scenarios/*.json`, on core's wasmtime engine | no |
| `pnpm -F kv-store test` | the methods the UI calls are exactly the committed ABI's, with its parameter names; the panel, sign-in, stores, invitations, session restore (mocked client) | no |
| `pnpm merod-local e2e kv-store` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

The scenarios are ported from the two merobox workflows: `simple-store.json`
walks the whole surface with writes from one account read back by another;
`converge.json` keeps what `converge.yml` checked that still means something
under one log (every account's write survives, one key holds one value, an
account that wrote nothing reads everything). `access.json` adds what merobox
never could: anonymous callers and accounts outside the org refused, a guest
allowed, typed errors, a trap, malformed arguments.

## The behaviours the tests pin down

- **`updateIfExists` must not insert.** Asserted *before* any write, so the map
  is genuinely empty.
- **`getOrInsert` returns the EXISTING value**, not the argument.
- **`remove` and `clear` emit nothing for a no-op.** An event for an absent key
  announces a change that never happened.
- **`getUnchecked` panics on purpose**: the node answers `422 TRAP` and nothing
  in that run commits. It is the cheapest demonstration of why `getResult` exists.

## What changed in the port, and why

Same methods, same arguments, same events. What a client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `update_if_exists`, `get_or_insert`, `get_result`, `get_unchecked` | `updateIfExists`, `getOrInsert`, `getResult`, `getUnchecked` (others unchanged) | the ABI names methods and arguments in camelCase |
| transport | JSON-RPC `execute` on your own node, a context id | `POST /apps/{app}/intents` (calls) and `/views` (reads) on any node of the cluster, an app id | one app per replicated log; any node serves any request |
| `len` result | the number `2` | the string `"2"` | `u64` travels as a decimal string (no precision loss in JSON) |
| `entries` | every entry | at most the first 1,000, in key order | multi-row reads are pages of at most 1,000 |
| reads | any method | `entries`, `len`, `get`, `getUnchecked`, `getResult` are views (`#[app::view]`); calling a write as a view is `NotAView` | a view is answered without touching the log |
| `getResult` on a missing key | `{"kind":"NotFound","data":"k"}` | `422 APP_ERROR` `{ code: "NotFound", fields: { key: "k" } }` | `#[app::error]`'s wire shape |
| `getUnchecked` on a missing key | the execution aborted | `422 TRAP` | the same panic, reported by the node |
| a concurrent write to one key | `LwwRegister` picks by timestamp | the leader's log orders them; the later one holds | no CRDT merge under one log |
| events | emitted before the write | emitted after it, to everyone the app reaches (`Audience::All`) | an event describes a write that happened |
| who may call | any member of the context | any member, admin or guest of the app's org, and the owner; anonymous `401`, others `404` | the org is the access boundary |
| malformed arguments | depends on the decoder | `BadArgs` (unknown keys refused, every parameter required) | the generated dispatcher |
| `Option` results in the ABI | lost (`get` typed `string`) | kept (`option<string>`) | the component ABI records it |

The frontend changed with it: mero-react's provider, the node login, the
context picker, the namespace invitations, the desktop SSO hand-off and the
generated `KvStoreClient` are gone. It now resolves its target from the build
(`@calimero-apps/connect`: `merod local` under `vite`, a Cloud cluster under
`vite build`), signs in with a **passkey**, lists and creates **stores** (app
instances: v1's contexts), shares one through an **organization** (v1's
namespace) with an **invite link** (making it is approved with your passkey;
opening it after signing in redeems it), and calls the contract by method
name through a small typed wrapper (`src/kvStore.ts`) whose method list a test
checks against `logic/res/abi.json`.

## Production

`vite build` connects to Calimero Cloud, and refuses to start without the
attestation floor set where the bundle's frontend is built:

```
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
VITE_CALIMERO_CLUSTER=<optional: a cluster name in the cloud's node directory>
```

The publish workflow passes them from the repository variables
`CALIMERO_MIN_RELEASE` (optional: unset, it is the lowest mero-tee release the
cluster's nodes run at publish time, from `scripts/cluster-min-release.py`) and
`CALIMERO_CLUSTER` (default `eu-shared-1` for that derivation). On a page the cluster serves, a build without a cluster
connects to the nodes serving it; on any other page it asks the directory
where `com.calimero.kv-store` runs and connects to its primary cluster, and
when no cluster runs it, says it is the listing page and links to Calimero
Cloud, where the app is deployed and opened.

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`),
which the cluster serves from the package's own origin: a Cloud node trusts
passkey ceremonies only from its own origins and from frontends it serves from a
bundle, so a copy on another origin cannot sign in. On that page the client
takes the cluster's nodes from `/.well-known/calimero.json` (the page's CSP
allows only those), and instances are created from the package
(`com.calimero.kv-store`). The `frontend` link in `logic/Cargo.toml` and the
Vercel project (`app/vercel.json`) stay as the listing's link; they are not
where people sign in.

```bash
pnpm -F kv-store build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/kv-store/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").
