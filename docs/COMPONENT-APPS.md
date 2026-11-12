# Component apps

How an app in this repo runs on Calimero 1.0: a contract on core's **component
SDK** (`calimero-sdk`, a `calimero:app` WebAssembly component on the node's
wasmtime runtime), developed against **`merod local`**, and a frontend that
talks to **Calimero Cloud** in production and to the local nodes in development
through mero-js's **`CalimeroClient`**.

Apps move one PR at a time. Until an app's own PR moves it, it stays a v1 app
(`calimero-sdk`, wasmer, merobox, `MeroJs`) and its CI is unchanged.
[`apps/kv-store`](../apps/kv-store) is the first component app and the template
for the rest; [Porting an app](#porting-an-app-the-checklist) is the checklist.

- [The pieces](#the-pieces)
- [Layout of a component app](#layout-of-a-component-app)
- [Build, test, bundle](#build-test-bundle)
- [Local development on merod local](#local-development-on-merod-local)
- [The frontend: local in dev, Cloud in production](#the-frontend-local-in-dev-cloud-in-production)
- [The app's typed client](#the-apps-typed-client)
- [CI](#ci)
- [Moving to a new core release](#moving-to-a-new-core-release)
- [Migration guide: v1 SDK to the component SDK](#migration-guide-v1-sdk-to-the-component-sdk)
- [Porting an app: the checklist](#porting-an-app-the-checklist)
- [What the component SDK does not have yet](#what-the-component-sdk-does-not-have-yet)

## The pieces

| | what | where |
|---|---|---|
| core pin | `component-core-tag` (now `1.0.0-rc.8`: core#4813's collections, plus blobs, search, xcall, actions and outbound HTTP) and `component-min-runtime-version` | root `Cargo.toml`, `[workspace.metadata.mero-apps]` |
| builder / bundler | `mero-component build \| bundle \| inspect \| abi`: core's `calimero-app-build` and `calimero-bundle` at the pinned tag | [`tools/component-bundle`](../tools/component-bundle) |
| local cluster | `pnpm dev:local <app>`, `pnpm merod-local up \| deploy \| e2e` | [`packages/merod-local`](../packages/merod-local) |
| frontend helper | `@calimero-apps/connect`: target (local / cloud) from env, the client, the stored session | [`packages/connect`](../packages/connect) |
| CI | `Components` workflow | [`.github/workflows/components.yml`](../.github/workflows/components.yml) |
| JS client | `@calimero-network/mero-js` 28 via `"catalog:component"` | `pnpm-workspace.yaml` |

Why a separate builder: `cargo mero bundle` at the pinned tag builds
`wasm32-unknown-unknown` (v1) only and cannot take a prebuilt component.
`mero-component` writes the same `.mpk` a single-service v1 app gets
(`manifest.json` signed with core's own signer, `app.wasm`, `frontend/…`), from
the same `[package.metadata.calimero]` table, and the node verifies it with the
same `calimero-bundle`. The manifest has no `abi` artifact: a component carries
its ABI in its own `calimero:abi` section, which is what the node reads.

## Layout of a component app

```
apps/<app>/
├── logic/                      a STANDALONE crate: its own [workspace] and Cargo.lock
│   ├── Cargo.toml              calimero-sdk @ component-core-tag; [package.metadata.calimero]
│   ├── src/lib.rs              #[app::state], #[app::logic], #[app::event], #[app::error]
│   ├── tests/common/mod.rs     builds the crate once per test run (core's calimero-app-build)
│   ├── tests/harness.rs        TestApp: the component on core's real wasmtime engine
│   ├── tests/scenarios.rs      every scenarios/*.json in the harness
│   ├── scenarios/<name>.json   neutral steps: run by cargo test AND on merod local (e2e)
│   ├── scenarios/<name>.org.json   the org the scenario needs
│   └── res/abi.json            the component's ABI, committed, diffed in CI
└── app/                        Vite + React; mero-js CalimeroClient via @calimero-apps/connect
```

The crate is excluded from the root Cargo workspace (`[workspace].exclude` in
the root `Cargo.toml`): the root's `apps/*/logic` glob would otherwise match a
manifest that is its own workspace root, which cargo refuses. Being out of that
workspace is also what takes the app out of the v1 pipeline, which finds its
apps through `cargo metadata` of the root workspace. The pin cannot be inherited
from `[workspace.dependencies]` either, so
`scripts/check-component-pins.py` asserts every component crate names
`component-core-tag`.

`Cargo.toml` of a component app:

```toml
[package]
name = "my-app"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
calimero-sdk = { git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.10" }

[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]
calimero-sdk       = { git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.10", features = ["testing"] }
calimero-app-build = { git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.10" }
serde_json = "1"

[package.metadata.calimero]
package = "com.calimero.my-app"
name = "My App"
min-runtime-version = "1.0.0-rc.10"
# … the same keys as a v1 app (icon, frontend, frontend-dir, tags, …)

[workspace]
```

## Build, test, bundle

```bash
rustup target add wasm32-wasip2

M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/<app>/logic/Cargo.toml                    # harness + scenarios
cargo run --release --manifest-path $M -- build  apps/<app>/logic          # res/<lib>.wasm + res/abi.json
cargo run --release --manifest-path $M -- bundle apps/<app>/logic --dev    # dist/<package>-<version>.mpk
cargo run --release --manifest-path $M -- bundle apps/<app>/logic --key key.json --app-version 1.2.3
cargo run --release --manifest-path $M -- inspect <file.mpk>               # files + verified manifest
```

`build` is core's `build_component`: `cargo build --release --target
wasm32-wasip2`, then the `calimero:abi` section lifted to the component's top
level. `bundle --dev` signs with the well-known development key (fine on
`merod local`, refused by the registry); `--key` (or `MERO_SIGN_KEY`) with a
production key from `cargo mero key generate`. `frontend-dir` from the metadata
is packed when it exists (`--no-frontend` skips it).

## Local development on merod local

`merod local` is core's development cluster in one process: three nodes on
`127.0.0.1:2501-2503`, mock attestation, a development storage key, passkey
ceremonies trusted from `http://localhost:3000` and `http://localhost:5173`. It
replaces merobox and Docker for component apps.

```bash
# merod at component-core-tag, once (either):
curl -fsSL https://github.com/calimero-network/core/releases/download/1.0.0-rc.10/merod_x86_64-unknown-linux-gnu.tar.gz | tar xz
cargo install --locked --git https://github.com/calimero-network/core --tag 1.0.0-rc.10 merod

pnpm dev:local <app>             # everything below in one command; Ctrl-C stops it all
```

`pnpm dev:local <app>`:

1. starts `merod local` (state and log in `.merod-local/`, kept across runs;
   `--fresh` starts over), or uses one already running on :2501;
2. builds the component (`mero-component build`);
3. signs up a throwaway deployer account with a software passkey and uploads
   the component as a raw bundle (`POST /bundles`, development clusters only);
4. writes `apps/<app>/app/.env.development.local` (gitignored):
   `VITE_CALIMERO_TARGET=local`, `VITE_CALIMERO_NODES`, `VITE_CALIMERO_BUNDLE`;
5. runs the app's Vite dev server on exactly `http://localhost:5173/` and prints it.

In the browser you sign up with a real passkey; the app creates **your own**
instance from that bundle. A raw bundle no package ships is visible to every
account on the cluster, which is why the deployer and you need not be the same
account. The pieces run separately too:

```bash
pnpm merod-local up [--fresh]         # the cluster in this terminal
pnpm merod-local deploy <app>         # build + upload + .env.development.local, against a running cluster
pnpm merod-local e2e <app>            # the app's scenarios on the cluster (fresh one if none runs)
```

`MEROD_BIN` names the merod binary; `--wasm FILE` uses a component built
elsewhere.

## The frontend: local in dev, Cloud in production

```ts
import { appSource, connectTarget, createClient, SessionStore } from "@calimero-apps/connect";
import { MyAppClient } from "./generated/client";      // see "The app's typed client"

// local in `vite`, cloud in `vite build`; on a page the cluster serves, its own node list
const target = await connectTarget(import.meta.env, { app: "my-app" });
const client = await createClient(target);              // CalimeroClient
const sessions = new SessionStore("my-app", target);    // per app and per target
sessions.restore(client);

await client.signUp(browserPasskey(), name);            // or signIn(browserPasskey())
sessions.sync(client);
const app = await client.createApp("my-app", appSource(import.meta.env, "com.calimero.my-app"));
const my = new MyAppClient(client, app, { after: () => sessions.sync(client) });
await my.set({ key: "a", value: "1" });
```

| env | local (dev server) | cloud (production build) |
|---|---|---|
| `VITE_CALIMERO_TARGET` | `local` (default under `vite`) | `cloud` (default under `vite build`), or `node` for an attested node reached by URL |
| `VITE_CALIMERO_NODES` | written by `dev:local`; default `127.0.0.1:2501-2503` | `node` only, **required**: the node's `https` URLs |
| `VITE_CALIMERO_BUNDLE` | written by `dev:local` | — (instances come from the package) |
| `VITE_CALIMERO_CLUSTER` | — | the cluster's name in the cloud's node directory: optional override: without it a served page connects to the cluster serving it, and any other page to the primary cluster running the app's package (`GET {directory}/package/{package}`); when none does, the page shows the shared listing (`<AppListing>`, `@calimero-apps/passkey`): "Open {App}" at the copy Calimero Cloud serves, `https://{label}.apps.calimero.network/`, and a link to deploy it on Calimero Cloud |
| `VITE_CALIMERO_MIN_RELEASE` | — | **required**: the lowest mero-tee release a node may run |
| `VITE_CALIMERO_ZONE`, `VITE_CALIMERO_DIRECTORY` | — | optional: zone first; another directory (staging) |
| `VITE_CALIMERO_PACKAGE`, `VITE_CALIMERO_VERSION` | — | optional: default the app's package, newest version |

- **Local**: `new CalimeroClient({ baseUrl, nodes, policy: { allowMock: true } })`,
  failing over across the three nodes. Mock quotes are trusted for a local
  target only.
- **One target, set at start.** The build's environment fixes where the
  service connects; there is no cloud/node picker, and the sign-in screen only
  offers a passkey sign-in or sign-up. Old flows that asked the person for a
  node URL or a "Cloud" tab are removed in every port.
- **Node** (`VITE_CALIMERO_TARGET=node`): an attested node the operator runs,
  reached by its `https` URLs with no directory, under the same release policy
  as the cloud. It is a cloud target with `direct: true`, so app code needs no
  case for it.
- **Cloud**: `CalimeroClient.connect({ cluster, policy: { release: { minReleaseVersion } } })`:
  the node list comes from the cloud's node directory, every node is attested
  under that policy before anything is sent, and calls fail over between nodes
  with the same idempotency key. A production build without a cluster or a
  release floor throws `ConfigError` at start instead of connecting anywhere.
- **Where the production frontend lives.** A Cloud node trusts passkey
  ceremonies from its configured origins and from the frontends **it serves
  from a package's bundle**, each on the package's own origin
  (`{label}.{apps_domain}`; core `crates/node/src/app_host.rs`). So the
  production frontend is the one packed into the `.mpk` (`frontend-dir`), not a
  copy on a static host: a page on another origin (a `*.vercel.app` deploy) is
  outside the relying party and cannot sign in. A session opened there is bound
  to the package, which is why production instances are created from
  `{ package }`.
- **On a served page** the node publishes the cluster's API URLs at
  `/.well-known/calimero.json`, and the page's CSP (`connect-src`) allows
  those origins only. `connectTarget` reads that list and the client uses it
  directly; the node directory is used everywhere else.
- **Sessions** are stored per app and per target (`calimero-session:<app>:<target>`),
  so a dev session never reaches a cloud cluster. The client swaps the
  single-use refresh token on a `401`; `SessionStore.sync(client)` after a
  request keeps the stored copy current.
- **Passkey step-ups**: a `confirm` method answers `412 CONFIRM_REQUIRED`; the
  generated client's method takes the answer as `{ confirm: passkeyConfirm(passkey) }`
  (mero-js's other step-ups, `orgs.inviteCreate` and the rest, take the same option).
- **Errors** are typed (`AppError` with `appCode` and `fields`, `TrapError`,
  `LoginRequired`, `ConfirmRequired`, `NotFound`, …); `describeError(e)` is a
  one-line message for the UI.

## The app's typed client

A frontend calls its contract through the class core's `mero-app-build codegen`
writes from the app's committed ABI, never through `client.apps.call` /
`client.apps.view` with method names in strings. [`apps/kv-store`](../apps/kv-store)
is the worked example; core's guide is `docs/src/content/docs/build/guides/typed-clients.mdx`
at the generator's tag.

```bash
scripts/install-mero-app-build.sh     # once: mero-app-build at its pinned tag, into ~/.cargo/bin
pnpm -F <app> codegen                 # logic/res/abi.json -> app/src/generated/{client.ts,openapi.json}
```

How an app adopts it:

1. In `app/package.json`, a `codegen` script, with `--name` the app's directory
   (it names the class: `kv-store` gives `KvStoreClient`):

   ```json
   "codegen": "mero-app-build codegen --abi ../logic/res/abi.json --lang ts --name <app> -o src/generated"
   ```

   Run it and **commit** `src/generated/` (both files). It is generated from
   the committed ABI, so every build, `tsc -b`, Vercel and a fresh clone work
   without a Rust toolchain. Add `"src/generated/*.ts"` to `tsconfig.test.json`'s
   `include` (the test project compiles what the tests import).
2. Build the class where the app has a signed-in client and an instance, with
   `after` syncing the stored session (mero-js refreshes it without an event):

   ```ts
   const kv = useMemo(
     () => (client && opened ? new KvStoreClient(client, opened.appId, { after }) : null),
     [client, opened, after],
   );
   ```

   Components take the class (`kv: KvStoreClient`) and call its methods with
   the ABI's argument records (`kv.set({ key, value })`); the event stream is
   `kv.events(from, signal)`, typed by `AppEvent`. A `confirm` method takes
   `{ confirm: passkeyConfirm(passkey) }` as its last argument.
3. Delete the hand-written wrapper and its method lists. Its test becomes
   `src/client.test.ts` (copy kv-store's): the class has exactly the ABI's
   methods, sends each one as a call or a view with the ABI's parameter names,
   runs `after` on failures too, and a `CalimeroClient` still satisfies the
   generated `AppTransport` (a compile-time line, so a mero-js bump that breaks
   it fails `tsc -b`).
4. Screen tests build the real class over a fake transport
   (`{ apps: { call, view }, async *events() {} }`, or `withRoutes(...)` from
   `@calimero-apps/connect/testing`) rather than mocking the class: it has
   private fields, so an object literal does not type as it.

Kept fresh by CI: `ci.yml`'s `frontend` job installs `mero-app-build` with
`scripts/install-mero-app-build.sh`, runs every app's `codegen`, and fails when
`apps/*/app/src/generated` differs from what is committed; the `rust` job of
`components.yml` already fails when `logic/res/abi.json` differs from the
build. So a contract change is: build (`mero-component build`), `pnpm -F <app>
codegen`, fix what `tsc -b` now reports, commit all three.

The generator has its own pin (`TAG` in `scripts/install-mero-app-build.sh`),
which may run ahead of `component-core-tag`: moving it regenerates every app's
client in the same PR. A record or enum type in the ABI is an interface or a
union only when the contract derives `Record` or `AbiType` and was built at
`1.0.0-rc.18` or later; otherwise it is `unknown`, so cast it where it is used.

## CI

`.github/workflows/components.yml`, alongside `ci.yml`:

| job | runs | what |
|---|---|---|
| `checks` | always | `check-component-pins.py` (+ its test); `tools/component-bundle` fmt, clippy, test; `packages/connect` and `packages/merod-local` typecheck and test |
| `rust` | per changed app | `cargo fmt --check`; `cargo clippy -D warnings` on the host (tests included) and on `wasm32-wasip2`; `cargo test` (TestApp harness + scenarios); release build; committed `res/abi.json` current; a dev-signed `.mpk` packed and verified |
| `frontend` | per changed app | `pnpm lint`, `typecheck`, `test`, `build` (the generated client's freshness is `ci.yml`'s `frontend` job: [The app's typed client](#the-apps-typed-client)) |
| `e2e` | per changed app | core's release `merod` at `component-core-tag` (checked against its `SHA256SUMS`), `merod local`, then `pnpm merod-local e2e <app>`: every `scenarios/*.json` as real accounts on three nodes |

A change to anything every component app depends on (the root `Cargo.toml`,
the lockfiles, `tools/component-bundle`, `packages/connect`,
`packages/merod-local`, the workflow) runs every component app.

### Release to the App Registry

`.github/workflows/release.yml` routes a component app to
[`publish-component.yml`](../.github/workflows/publish-component.yml) (a v1 app
to `publish-bundle.yml`):

```bash
gh workflow run release.yml -f app=kv-store          # one app
gh workflow run release.yml                          # every component app
gh workflow run release.yml -f app=kv-store -f version=1.0.0
```

1. The registry owns the version: the highest published `X.Y.Z` plus a patch
   (`scripts/registry-release.sh next-version`).
2. The frontend is built for the page the cluster serves from the bundle:
   `VITE_CALIMERO_TARGET=cloud`, `VITE_CALIMERO_CLUSTER` from the repository
   variable `CALIMERO_CLUSTER` (default `eu-shared-1`) and
   `VITE_CALIMERO_MIN_RELEASE` from `CALIMERO_MIN_RELEASE` (required). No
   Vercel deploy is involved.
3. `mero-component bundle --key` signs it with `MERO_SIGN_KEY`; the key file is
   removed right after.
4. The signed manifest's `signerId` must be the package's published one
   (`scripts/registry-release.sh check-signer`): the registry pins the signer
   and the node derives the application id from (package, signer).
5. `scripts/publish-bundle.sh` uploads it.

A push to `main` that changes a component app releases it only when the
repository variable `RELEASE_COMPONENTS_ON_PUSH` is `true`; otherwise the run
lists what it would have released.

## Moving to a new core release

1. `component-core-tag` and `component-min-runtime-version` in the root `Cargo.toml`.
2. The tag in `tools/component-bundle/Cargo.toml` and in each component app's
   `Cargo.toml` (`python3 scripts/check-component-pins.py` lists every one
   left), then `cargo update` in each.
3. `"@calimero-network/mero-js"` in the `component` catalog of
   `pnpm-workspace.yaml`, to the release that speaks that node's API.
4. Rebuild each app's `res/abi.json`; CI's e2e job downloads the new `merod`.

## Migration guide: v1 SDK to the component SDK

The v1 SDK runs an app on every node and merges replicas with CRDTs. The
component runtime runs each app on its cluster's leader, which applies every
write in one replicated log, so state is **plain data structures**: there is
nothing to merge, and a later write simply replaces an earlier one.

### Collections

| v1 (`calimero-storage`) | component SDK (`calimero_sdk::prelude::*`) | notes |
|---|---|---|
| `UnorderedMap<K, V>` | `UnorderedMap<K, V>` | `get`, `contains`, `insert`/`remove` (return the old value), `len`, `clear`; with `K: FromKey`: `page`, `range`, `prefix`, `starts_with`, `first`, `last` |
| `UnorderedMap<K, LwwRegister<V>>` | `UnorderedMap<K, V>` | the register is gone: the log already orders writes |
| `SortedMap<K, V>` | `UnorderedMap<K, V>` | keys are order-preserving tuples, so every map reads in key order |
| `NestedMap` | `UnorderedMap<(K1, K2), V>` | tuple keys; `prefix` reads one outer key |
| `LwwRegister<T>` | `Cell<T>` | `get`, `set`, `clear` |
| `Counter` / `GCounter` / `PNCounter` | `Counter` | `get`, `add`, `increment` |
| `UnorderedSet<T>` / `SortedSet<T>` | `Set<T>` | `insert`/`remove` return a bool; paged reads like the map |
| `Vector<T>` | `Vector<T>` | `push` returns the position; `set` past the end is `OutOfBounds` |
| `UserStorage<T>` | `PerUser<T>` | the caller's own value; `get_for(account)` |
| `FrozenStorage<T>` | `Frozen<T>` | content-addressed; `insert` returns the hex hash |
| `FugueText` / `RGA` | `Text` | still a sequence CRDT (Fugue): editors send edits against a stale view |
| `RichText` | `RichText` | `RichDocument`, undo and mark schemas are not carried over |
| records with secondary lookups | `Table<Record>` + `#[derive(Record)]`, `#[table(key = …)]` | indexes, unique constraints (SQL NULL semantics), maintained counts |

- **Iteration is paged.** `entries()`/`iter()` become `page(FindOpts::default().limit(n))`
  (at most 1,000 rows per page, with a cursor). A method that returned "every
  entry" now returns at most a page: say so in its doc comment.
- **Lengths are stored counts**, never a scan; `len()` returns `u64`.
- Keys over 1 KiB are refused (`KeyTooLong`).

### How state is stored: collections, not `Vec`

The collections exist for storage, not for merging. Each one keeps its
entries under their own keys in the node's store, so a call reads and writes
only the entries it touches:

| collection | keys | one call costs |
|---|---|---|
| `Vector<T>` | one per element, `(name, "e", position)`, plus a stored length | `push`/`get`/`set`/`pop`: one element; `page`: at most 1,000 |
| `UnorderedMap<K, V>`, `Set<T>`, `PerUser<T>` | one per entry | the entries it reads or writes |
| `Table<R>` | one per row, plus one per index entry | the row and its index entries |
| `Text` / `RichText` | one per character (and mark) | edits and reads load every node: keep documents in their own instance |
| `Cell<T>`, a map value, a table row | **one value**: `T` is CBOR-encoded whole | the whole value, on every read and write |

So a `Vec` (or `HashMap`, or a nested struct) **inside** a stored value is
read and rewritten in full every time that value is. That is fine for a short,
**bounded** list, and wrong for anything that grows with use:

- **Fine**: a few tags on a record, the 3 rounds of a match, the last
  `RECENT_HITS` blows (capped and cleared), a value written once and never
  changed.
- **Not fine**: comments on an issue, messages in a channel, members of a
  team, an append-only history, anything a user can add to without limit. Put
  these in their own `Vector`, `Table` (with an index on the parent id) or
  `UnorderedMap<(parent, child), V>`, and page them.
- A `Table` record's fields are key parts, so a list can't be a field at all:
  keep a short list in a map beside the record (`UnorderedMap<Id, Notes>`), a
  long one in its own table.
- `Vec` in a **view's or call's result** (`IssueDetail { comments: Vec<_> }`)
  is not stored: it is built per request from a page. Say in the method's doc
  comment that it returns at most a page.
- State fields themselves can only be collections (`#[app::state]` accepts
  types implementing `StateField`), so a top-level `Vec` field does not compile.

When a stored value holds a list, write its bound in the field's doc comment
(`/// at most RECENT_HITS, cleared each round`) and enforce it in the method
that appends to it.

### Attributes and API

| v1 | component SDK |
|---|---|
| `#[app::state(emits = for<'a> Event<'a>)]` + borsh derives | `#[app::state(version = 1)]`, fields are collection handles only |
| `#[app::init] fn init() -> Self { Self { items: UnorderedMap::new() } }` | `#[app::init] fn init() -> app::Result<Self> { Ok(Self::load()) }` |
| a `&self` method is a view | a view says so: `#[app::view]`. A `&mut self` method is a call (logged) |
| method names as written (`get_result`) | ABI names are camelCase (`getResult`), arguments too |
| `&str` arguments | `String` (arguments are a JSON object, unknown keys refused) |
| `usize` / `u64` results | `u64`, which travels as a **decimal string** (`"3"`), as do `i64`; `Vec<u8>` as base64url |
| `#[app::event] enum Event<'a> { Inserted { key: &'a str } }` | `#[app::event] enum Event { Inserted { key: String } }`, **inside** the `#[app::logic]` module |
| `app::emit!(Event::…)` | `env::emit(Event::…, Audience::All)?` (or `Caller`, `Org`, `Team`, named accounts) |
| `#[derive(Error, Serialize)] #[serde(tag = "kind", content = "data")] enum Error<'a> { NotFound(&'a str) }` + `app::bail!(…)` | `#[app::error] enum Error { NotFound { key: String } }`, inside the logic module; `return Err(Error::NotFound { key }.into())`. On the wire: `422 APP_ERROR`, `{ code: "NotFound", fields: { key } }` |
| `app::log!(…)` | `env::log(&format!(…))` |
| `env::executor_id()` | `env::caller()` (an account, `System`, or an app); `env::org_role`, `env::in_team` |
| permission wrappers (`Ownable`, `AccessControl`, `SharedStorage`, `Authored`…) | explicit checks against `env::caller()` / `env::org_role()` in each method, stated in its doc comment |
| `#[app::private]`, blobs, xcall, event handlers, TEE methods, migrations | not in this version (see below) |
| new: | `#[app::confirm]` (passkey step-up, 412), `#[app::public]` (anonymous callers on a public app), `#[app::every("5m")]` timers, `allow(system)` / `allow(app = …)` |

### Tests

| v1 | component SDK |
|---|---|
| `calimero_sdk::testing::TestHost` (native mock host) | `calimero_sdk::testing::TestApp`: the built component on core's real wasmtime engine, in an org (`Org::new().members([..]).guests([..])`), as named accounts, with the node's own access checks |
| `converge_app` / 3-replica convergence tests | gone: one leader orders every write, there is nothing to converge |
| merobox `workflows/*.yml` (Docker, two or three merod containers) | `scenarios/*.json`: neutral steps run by `cargo test` in the harness **and** by `pnpm merod-local e2e` on `merod local` |
| "forged write" checks (a node writing under another's key) | method checks: the same call as an account the method refuses (`expect: { error: "Forbidden" }`), or as an outsider (`refused: "NOT_FOUND"`) / anonymous (`refused: "UNAUTHENTICATED"`) |

### Frontend

| v1 | component |
|---|---|
| `MeroJs`, mero-react `MeroProvider` / `ConnectButton`, JSON-RPC `execute` | mero-js 28 `CalimeroClient` (`"catalog:component"`) through `@calimero-apps/connect` |
| a node URL + auth frontend login | passkeys: `client.signUp(browserPasskey(), name)` / `signIn(browserPasskey())` |
| application id + context | a **package** + an **app instance** (`createApp`, `listApps({ package })`) |
| namespace / group, namespace invitations | an **org** (`createOrg`, `invite`, `redeemInvite`), instances created `{ org }` |
| abi-codegen client from `res/abi.json` | `mero-app-build codegen --lang ts` from `res/abi.json` into `src/generated/` (camelCase names, typed arguments, results, errors and events): [The app's typed client](#the-apps-typed-client) |
| SSE subscriptions | `client.events(app, from, signal)`, an async generator of `{ id, kind, data }` |

## Porting an app: the checklist

From moving `apps/kv-store`; its PR is the worked example to copy from. One PR
per app, branched off `main` once this groundwork has merged.

**Logic**

1. Read the app's `logic/src/lib.rs`; list every method, argument, result,
   event and error, and every collection and SDK feature it uses. Check each
   against the [migration tables](#migration-guide-v1-sdk-to-the-component-sdk)
   and [what the SDK does not have yet](#what-the-component-sdk-does-not-have-yet).
   If something is missing, stop and raise it: do not fake it.
2. Replace `logic/Cargo.toml` with the component shape above: `cdylib` only (the
   tests run the built component, so no `rlib`), `calimero-sdk` (+ the
   `testing` feature and `calimero-app-build` as host-only dev-dependencies) at
   `component-core-tag`, an empty `[workspace]`, and the same
   `[package.metadata.calimero]` with `min-runtime-version =
   component-min-runtime-version`. Keep `frontend-dir`: the production frontend
   is the bundled one.
3. Add `apps/<app>/logic` to `[workspace].exclude` in the root `Cargo.toml`;
   run `cargo metadata --format-version 1 > /dev/null` at the root (it drops the
   app from the root `Cargo.lock`) and `cargo generate-lockfile` in the crate.
4. Port `src/lib.rs` with the tables: the same method names (camelCase on the
   wire), arguments and events. Mark every read `#[app::view]`; return `u64`
   for counts. No unbounded `Vec` (or map) inside a `Cell`, map value or table
   row: anything that grows goes in its own `Vector`, `Table` or map (see
   [How state is stored](#how-state-is-stored-collections-not-vec)); a list
   that stays inside a value states and enforces its bound. Write down **every** change a client sees in the app's README
   (kv-store's "What changed in the port" table is the format).
5. Copy `tests/common/mod.rs` and `tests/scenarios.rs` from `apps/kv-store` as
   they are. Port the old `TestHost` tests into `tests/harness.rs` method for
   method; turn convergence tests into what they mean under one log (every
   member's write survives; one key holds the later write); add access tests
   (anonymous `Refused 401`, an outsider `Refused 404`, a guest, a member a
   method refuses) and `BadArgs` / `UnknownMethod` / `NotAView` checks.
6. Port each merobox workflow to `scenarios/<name>.json` (+ `.org.json`): each
   merobox node becomes an account (`owner`, `bob`, …); installs, `create_mesh`,
   joins and `wait_for_sync` disappear; assertions become `expect` and
   `events`. Add an `access.json` with what merobox could not express. Keep
   every step to `call`/`view`/`removeMember`, so the e2e runs it too (a `tick`,
   `advance` or `@system` step makes the cluster runner skip the file).
7. `rustup target add wasm32-wasip2` for the toolchain `cargo` uses (the tests
   build the crate for it), then `cargo fmt`, `cargo clippy --all-targets -D
   warnings`, `cargo clippy --target wasm32-wasip2 -D warnings`, `cargo test`,
   and `mero-component build` to write `res/abi.json`; commit it. Delete
   `res/state-schema.json` (v1 only).

**Frontend**

8. `package.json`: drop mero-react, mero-platform(-react), abi-codegen,
   node-served, e2e-node, Playwright, the invitation codecs; add
   `"@calimero-network/mero-js": "catalog:component"` and
   `"@calimero-apps/connect": "workspace:*"` and
   `"@calimero-apps/passkey": "workspace:*"`; scripts `dev`, `build`,
   `typecheck`, `test`, `lint` (an `eslint.config.js` like kv-store's), and
   `codegen` running `mero-app-build codegen` (not abi-codegen). Keep
   `vercel.json` (the v1 guards still check it).
9. Replace the provider, node login and context picker with kv-store's
    `session.ts` (a few lines over `@calimero-apps/passkey`'s
    `usePasskeySession`: target → client → passkey sign-in/up, `SessionStore`),
    its `<PasskeySignIn>` sign-in screen, and its
    store picker (`listApps` by bundle in dev, by package in production;
    `createApp(name, appSource(…), { org })`). v1 contexts are app instances, v1
    namespaces are orgs, v1 invitations are org invites (`client.invite(org,
    role, passkey)` is a passkey step-up; the link carries the token and is
    redeemed after sign-in).
10. Call methods through the generated client (`src/generated/client.ts`,
    committed; [The app's typed client](#the-apps-typed-client)), with kv-store's
    `client.test.ts` checking it against the committed `res/abi.json`. Test the
    screens with a mocked client (`App.test.tsx`).
11. `.env.example` lists the `VITE_CALIMERO_*` variables; the production build
    needs `VITE_CALIMERO_MIN_RELEASE` where the bundle's frontend is built
    (publish-bundle passes the repository variable `CALIMERO_MIN_RELEASE`, or
    else the lowest mero-tee release the cluster's nodes run at publish time,
    and `CALIMERO_CLUSTER` when set, into it).

**Remove and verify**

12. Delete `logic/workflows/`, `tests/converge.rs` and other CRDT-merge tests,
    `res/state-schema.json`, `src/generated/`, the Playwright e2e that drove
    merobox or merod 0.x, the v1 invitation / deep-link / desktop-SSO code and
    helper scripts, and every reference to them (`merobox-coverage-baseline.json`
    entries, README tables). `grep -rn merobox apps/<app>` comes back empty.
13. Run the repo's guards (`python3 scripts/check-component-pins.py`, the v1
    `metadata` job's scripts: the coverage check skips an app with no
    `workflows/`, the desktop-SSO check one with no `MeroProvider`),
    `pnpm -F <app> lint typecheck test build`, and `pnpm -r typecheck test`
    when the lockfile moved.
14. `pnpm dev:local <app>`: sign up in the browser, exercise every method and
    an invitation between two browser profiles. `pnpm merod-local e2e <app>`:
    every scenario passes on the cluster.
15. Update the app's README (run, test, what changed and why, production) and
    its row in the root README.

## What the component SDK does not have yet

Since `1.0.0-rc.8` the component SDK has what most v1 apps reached for beyond
collections: **blobs** (`BlobRef` in state, `info`, download grants; core#4815),
**full-text search** (`#[table(search = [..])]`, `Table::search` from views;
core#4816), **cross-app calls** (`env::xcall` through the outbox, and
synchronous `env::xcall_call` / `env::xcall_view`, within one organization;
core#4816, core#4820), **actions** (`#[app::action]`, leader-run, with
`ctx.view`/`ctx.call`/`ctx.fetch`; core#4818) and **outbound HTTP** from
actions and from calls (`env::fetch`, recorded in the log, through the
manifest's `outbound` prefixes and the owner's approval; core#4818, core#4822).
See core's `crates/sdk/AGENTS.md` at the tag for each API.

Still missing at `1.0.0-rc.8`; an app that needs one stays on the v1 SDK, or
ports without it and says so in its PR:

- **Event handlers** (`#[app::on_*]`, reacting to another app's events).
- **TEE-decided methods** (`#[app::tee]`) and **private (node-local) storage**
  (`#[app::private]`).
- **Migrations** (`#[app::migrate]`, `upgrade_to` in the harness).
- **CRDT types beyond `Text`/`RichText`**: `RichDocument`, undo, deltas, RGA,
  custom `Mergeable` rules (a plain record is usually what they become).
- **Release attestation from a served page.** mero-js verifies a node's
  release against `cloud.calimero.network` (the signed `published-mrtds.json`
  and Intel collateral mirrors), but a bundle-served page's CSP `connect-src`
  lists only the cluster's API origins, so those fetches are refused there.
  Until core adds the mirror to that CSP (or the node proxies it), a production
  frontend needs `policy.fetchCollateral`/`verifyQuote` supplied some other way.
  `merod local` is unaffected (mock quotes, no fetch).
- **Typed app types in an older ABI.** The generated client types a record or
  enum only from an ABI built at `1.0.0-rc.18` or later (core#4997) whose type
  derives `Record` or `AbiType`; anything else is `unknown`.
