# Scaffolding E2E

The SDK test bench: one contract that exercises the SDK's surface (KV, handlers,
per-user, frozen and shared storage, roles and capabilities, an owned cell,
counters, registers, nested maps, a vector, sets, ordered collections, a text
document, authored entries, file records and a workspace directory), and a
frontend where you can call every method by hand and run an automated suite
against a node.

A component app on Calimero 1.0: the contract is on core's component SDK
(`calimero-sdk` at `1.0.0-rc.7`, `wasm32-wasip2`), local development runs on
`merod local`, and the frontend talks to the local nodes in development and to
Calimero Cloud in production through mero-js's `CalimeroClient`
(`@calimero-apps/connect`). See [`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` and `Cargo.lock`) |
| `logic/tests/` | `harness.rs` (v1's tests and the access and wire checks, on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | one file per area, ported from v1's merobox workflows, plus `access.json`; run by `cargo test` **and** on `merod local` |
| `app/` | Vite + React frontend: every method reachable from a screen, and the in-app "Run All Tests" suite |

Core keeps its own copy of this scaffold (`core/apps/scaffolding-e2e`, still on
the v1 SDK). The conformance workflow bundles **that** copy from core's
checkout, so this move does not touch it.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local scaffolding-e2e   # merod local + the contract + the app on http://localhost:5173/
meroctl local dev apps/scaffolding-e2e  # the same with core's meroctl (1.0.0-rc.24 or later)
```

`merod local` is core's development cluster in one process: three nodes on
`127.0.0.1:2501-2503`, mock attestation, passkeys trusted from
`http://localhost:5173`. It replaces v1's `merod init --server-port … --auth-mode
embedded` + `merod run` per node, and `setup.sh`. At core `1.0.0-rc.7` it runs on
Linux only.

In the browser: sign up with a passkey, create an instance with "shared"
ticked, claim the workspace in **Setup**, and open any section. To try a second
person, create an invitation link in **Setup** and open it in another browser
profile. **Run All Tests** runs the in-app suite against the open instance.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo fmt --manifest-path apps/scaffolding-e2e/logic/Cargo.toml -- --check
cargo clippy --manifest-path apps/scaffolding-e2e/logic/Cargo.toml --all-targets -- -D warnings
cargo clippy --manifest-path apps/scaffolding-e2e/logic/Cargo.toml --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path apps/scaffolding-e2e/logic/Cargo.toml          # harness + scenarios
cargo run --release --manifest-path $M -- build apps/scaffolding-e2e/logic  # res/abi.json
pnpm merod-local e2e scaffolding-e2e                                      # the scenarios on merod local
pnpm -F scaffolding-e2e lint && pnpm -F scaffolding-e2e typecheck && pnpm -F scaffolding-e2e test && pnpm -F scaffolding-e2e build
```

| scenario | ported from | what it covers |
|---|---|---|
| `kv.json` | `e2e.yml` (KV part), `simple-sync.yml`, `handler-test.yml` | three accounts writing and reading one store; the handler methods and the `*WithHandler` calls |
| `storage.json` | `e2e.yml` (user, frozen, private, blob parts) | `whoami`, per-user values, nested per-user maps, frozen values, the secrets game, file records |
| `collections.json` | `e2e.yml` (nested CRDTs, RGA), `sorted-collections.yml` | counters, registers, nested maps, the metrics vector, tags, ordered map and set, the text document |
| `access-control.json` | `access-control.yml` | the role registry, projection onto capabilities, admins, the owned cell |
| `authored-shared.json` | `authored-shared.yml` | per-owner entries, the authored vector, the shared cell and its writer rotation |
| `workspace-registry.json` | `workspace-registry.yml` | the claim, roles, channels, groups, the ping and `wsPong`'s refusal |
| `host-logging.json` | `host-logging.yml` | `tracingProbe` at both levels |
| `access.json` | — | guests, outsiders (404), anonymous callers (401), a removed member, `BadArgs`, forged writes as the calls an account is refused |

v1's node-level workflows (`groups*.yml`, `group-*.yml`: namespaces, subgroups,
late joiners, three-node meshes, multi-service bundles, capabilities on groups)
test merod's group machinery, not this contract; on 1.0 that is the
organization's job and core's own tests cover it, so they are not ported. The
15-minute `soak/fuzzy-test.yml` load loop went with merobox.

## What changed in the port, and why

### Storage

The app runs on its cluster's leader, which applies every write in one
replicated log, so state is plain data structures and a later write replaces an
earlier one. v1's CRDT types become the collection that stores the same thing:

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `UnorderedMap<String, LwwRegister<String>>` (KV, registers, games, title) | `UnorderedMap<String, String>` |
| `Counter` (handlers, RGA edits, pongs) | `Counter` |
| `UnorderedMap<String, Counter>` / `Counter<true>` (G- and PN-counters) | `UnorderedMap<String, u64>` / `UnorderedMap<String, i64>` |
| `UserStorage<LwwRegister<String>>` | `PerUser<String>` |
| `UserStorage<NestedMap>` | `UnorderedMap<(account, key), String>` |
| `FrozenStorage<String>` | `Frozen<String>` |
| `UnorderedMap<String, UnorderedMap<String, LwwRegister<String>>>` | `UnorderedMap<(outer, inner), String>` |
| `Vector<Counter>` | `Vector<u64>` |
| `UnorderedMap<String, UnorderedSet<String>>` | `Set<(key, tag)>` plus `UnorderedMap<key, count>` |
| `SortedMap` / `SortedSet` | `UnorderedMap` / `Set` (every collection reads in key order; ranges and `last` are seeks) |
| `ReplicatedGrowableArray` | `Text` (Fugue) |
| `AuthoredMap<String, LwwRegister<String>>` | `UnorderedMap<(key, owner), String>` |
| `AuthoredVector<LwwRegister<String>>` | `Vector<{ owner, value: Option<String> }>` (a removed slot keeps its place) |
| `SharedStorage<LwwRegister<String>>` (shared cell, ACL document) | a `Cell<String>` and a writer `Set<String>` |
| `Ownable<LwwRegister<String>>` | an owner `Cell<String>` and a `Cell<String>` |
| `AccessControl` (+ `OpMask` projection onto a `SharedStorage`) | admin `Set<String>`, role `Set<(role, account)>`, projected `UnorderedMap<account, u8>` |
| `SharedStorage<LwwRegister<WsClaim>>`, `SharedStorage<UnorderedMap<…>>`, `Moderated<UnorderedMap<…>>` | `Cell<WsClaim>`, `UnorderedMap<identity, role>`, a workspace admin `Set`, `UnorderedMap<id, record>` |
| `#[app::private] PrivateSecrets` (node-local) | `UnorderedMap<(account, game), String>` (see below) |

v1's storage-enforced write rules are checks in each method against
`env::caller()`, answered `Forbidden`: the shared cell's writers, the owned cell's
owner, ACL admins (grants, admin changes, `aclProject`), the projected `write`
capability (`aclDocSet`), an authored entry's or slot's owner, and the workspace
roles (`read-only` cannot write the directory, only workspace admins claim and
set roles, only a registrant or an admin removes a channel or group). The app's
owner holds every first seat v1 gave the context creator.

### What a client sees

| | v1 | now |
|---|---|---|
| method and argument names | `get_result`, `account_hex`, … | the same methods, camelCase: `getResult`, `accountHex`, … |
| 64-bit integers | `usize`/`u64`/`i64` as JSON numbers | `u64`/`i64` as **decimal strings**, in arguments (`pushMetric { value: "3" }`, `getMetric { index: "0" }`, `uploadFile { size: "12" }`, `rgaInsertText { position: "0" }`), results (`len`, counters, indexes, lengths) and event fields |
| record results | snake_case fields (`blob_id`, `uploaded_at`, `channel_count`, …) | camelCase fields (`blobId`, `uploadedAt`, `channelCount`, …), integer fields as decimal strings |
| errors | `FunctionCallError` with a message (`app::bail!` strings, `Error::NotFound(..)`) | `422 APP_ERROR` with a code: `NotFound { key }` (every "not found": KV, counters, registers, metadata, metrics, tags, files, authored entries), `FrozenNotFound { hash }`, `NoHash`, `Forbidden { message }` (a rule refused the caller), `Invalid { message }` (v1's other messages, verbatim) |
| identity | `whoami` → `{ device_id, account_id }`, two different 64-hex ids | `{ deviceId, accountId }`; 1.0 runs a method for the account, so `deviceId` is the account again (an API key's id for an API-key caller). Account ids are the node's, not 64 hex |
| account arguments | parsed as 64 hex (`not an account id` otherwise) | any id; a **grant** (`aclGrant`, `aclGrantAdmin`, `ownedTransfer`, `sharedAddWriter`, `sharedRotateWriters`) must name the app's owner or an account in its org, else `Invalid` |
| `tracingProbe` | `tracing` macros through the SDK subscriber, `set_log_level` retuning it | `env::log` lines (the component SDK has no `tracing` subscriber or level filter): the warn line always, info and debug with `debug: true`; still only in the node's log |
| handlers | `setWithHandler` & co. emitted the event with a handler name, and every node that received it ran the handler | the `*WithHandler` calls run the handler method inline, once, in the same call (no event handlers in the component SDK); the handler methods stay callable |
| frozen hash | hex SHA-256 v1's storage computed | hex SHA-256 of the stored (CBOR) value; `addFrozen` of the same value twice is one entry and the same hash |
| secrets game | the secret in node-local `#[app::private]` storage: `mySecrets` returned this node's secrets | no private storage in the component SDK: the secret is the setter's own entry in the app's state, returned only by `mySecrets` of the same account (the node operator can read state); only its SHA-256 is public, as before. `addGuess` is a call (it emits) |
| files | `uploadFile` announced the blob to the context (`blob_announce_to_context`); id `file_<device>_<time>` | the bytes are in the instance's blob store (`client.uploadBlob`), which every node serves; the contract keeps the record and checks the id is 64 hex. Id `file_<unique id>`. A contract cannot read blobs at core `1.0.0-rc.7` |
| `searchFiles` | a scan of every record | a scan of the first 1,000 records (no full-text search at `1.0.0-rc.7`) |
| listings (`entries`, `listFiles`, `sortedKeys`, `wsList*`, `aclAdmins`, …) | every entry | at most 1,000 (one page), in key order |
| `sortedRange` / `sortedTagsRange` with `start >= end` | (a host error) | `{}` / `[]` |
| `rgaInsertText` / `rgaDeleteText` out of range | an RGA error | `Invalid` |
| `authoredInsert` | an error when the caller already holds the key | the same, `Invalid` |
| `authoredUpdate` on a key the caller does not hold | a storage error | `NotFound` |
| `authoredVecUpdate` / `authoredVecRemove` | by the slot's owner | the same; another account gets `Forbidden`, a missing or removed slot `NotFound` |
| `acl*` | grants enforced at merge; `aclProject` gated on the caller's own `admin` mask | grants and `aclProject` are ACL-admin only (`Forbidden`); unchanged otherwise: a grant confers nothing until projected, admin grants and revokes project themselves, the last admin cannot be revoked |
| `wsSetMemberRole` | rotated the admin set only for an identity that parsed as an account | every identity; `admin` adds it to the workspace admins, any other role removes it |
| `wsRegisterChannel` / `wsRegisterGroup` on another account's id | refused by storage (`Invalid`-like message) | `Forbidden` |
| `wsPingChannel` | queued an `xcall` to the target's `ws_pong` | records the ping and emits `ChannelPinged`; **nothing is sent** (core `1.0.0-rc.7` components cannot send an xcall), so the target's `wsPingCount` does not move |
| `wsPong` | `#[app::xcall(from_same_app)]`: a call from another context of this app | `#[app::allow(app = "*")]`: accepts another app as the caller (`Caller::App`) whose id equals `fromContext`; an account calling it directly gets `Invalid`, as v1 refused a direct call |
| `sharedIsFrozen` | the cell's frozen flag (always `false` here) | always `false` |
| events | to every member of the context | to everyone the instance reaches (`Audience::All`); camelCase fields; `FrozenAdded.hash` a hex string, `UserSimpleSet.accountId` / `ChannelPinged.toContext` / `PongReceived.fromContext` strings, integer fields decimal strings |
| migrations | none | none |

### Frontend

- mero-react's `MeroProvider`, the node connect screen and node-URL switching,
  `lib/mero.ts`, the admin API client (`api/adminApi.ts`, `api/appScope.ts`,
  `api/ids.ts`), v1 invitations (`lib/invite.ts`, `InvitationPrompt`) and
  `@calimero-apps/node-served` are gone. The session is `@calimero-apps/connect`
  (`src/session.ts`): passkey sign-in/up, stored per app and per target.
- Contexts are app instances (`src/instances.ts`, `InstancePicker`: `listApps` by
  the dev bundle or the package, `createApp(name, source, { org })`); namespace
  invitations are org invites (`components/InviteCard.tsx`, a passkey step-up,
  redeemed after sign-in, which opens that org's instance). The pending invite
  is `@calimero-apps/connect`'s `createInviteStore`, dropped on sign-out.
- The contract is called through `ScaffoldingE2eClient` (`src/generated/client.ts`),
  which `meroctl app codegen` writes from `logic/res/abi.json` (committed;
  `pnpm -F scaffolding-e2e codegen` after a contract change, and CI fails when
  it is stale). `src/api/kvStore.ts` has one function per contract method for
  the sections, each calling the class with the ABI's argument names (`u64` for
  64-bit integers) and answering the envelope the sections display;
  `src/api/rpc.ts` builds that envelope (`run`), folds contract errors into it
  and turns 64-bit results back into numbers (`int`), and `v1Record` turns
  record results back into v1's shape. So the sections are unchanged apart from
  copy. `client.test.ts` checks the class against the committed ABI;
  `abi.test.ts` that every method is called with the ABI's parameter names, and
  that **every method is reachable from a screen** (it replaces
  `scripts/check-contract-calls.mjs`).
- Blobs go to the open instance (`client.uploadBlob` / `downloadBlob`);
  presence is `client.publishPresence` / `presenceStream`.
- **Setup** (was the node/namespace/context wizard) shows the open instance,
  creates an invitation link and claims the workspace. **Workspace Manager**
  (was namespaces, subgroups and contexts through the admin API) is the `ws_*`
  directory, the ping, `wsPong`'s refusal and the org. **Sync Test** (two nodes,
  one context, and `sync-test-server` comparing their reads) is gone: one log
  orders every write, so there is no cross-node convergence to watch; the
  scenarios check every account reads every write.
- The Playwright suites (`tests/`, `e2e/`, `playwright*.config.ts`) drove a v1
  node and its auth frontend and are removed; the end-to-end run is `pnpm
  merod-local e2e scaffolding-e2e`, and the screens are tested with a mocked
  client (`App.test.tsx`).

### Removed

- `setup.sh` (started one or two v1 `merod` nodes with `--server-port` and
  `--auth-mode embedded`, or merobox, authenticated them and created the
  namespace and context), `install-calimero.sh` (downloaded merod/meroctl
  `0.12.0-rc.3`), `docs/setup.md` (the same by hand), `Makefile` (the v1 CI
  mirror) and `sync-test-server/` (the Node server Sync Test posted to). All of
  them only served v1 nodes; `pnpm dev:local scaffolding-e2e` replaces them.
- `logic/workflows/` (merobox), `logic/build*.sh`, `check-bundle-fresh.sh`,
  `build-multi-service-bundle.sh` (a two-service v1 `.mpk` fixture),
  `logic/static/` (blob fixtures for those workflows), `logic/README.md`,
  `res/state-schema.json`, the `rlib` crate type and the CRDT merge tests
  (`tests/converge.rs`, `tests/authorization.rs`, the `TestHost` module).
- `.github/workflows/soak.yml`, which ran only this app's merobox
  `soak/fuzzy-test.yml`, nightly.

## Production

The production frontend is the one bundled into the `.mpk` (`frontend-dir`), so
the cluster serves it from the package's own origin, where passkeys work. Build
it with `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (see
`app/.env.example`); without them the production build refuses to connect.
