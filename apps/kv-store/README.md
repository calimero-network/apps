# KV Store

The reference Calimero app, and the template every other app in this repo is
shaped after.

An `UnorderedMap<String, LwwRegister<String>>` in a Rust/WASM contract, driven
from a TypeScript client **generated out of that contract's own ABI**.

```
apps/kv-store/
├── logic/                 Rust → WASM. The whole backend.
│   ├── src/lib.rs         #[app::state], #[app::logic], #[app::event] + TestHost tests
│   ├── tests/converge.rs  3-replica convergence, no node, no wasm
│   ├── res/               abi.json + state-schema.json, emitted by `cargo mero build`
│   └── workflows/         merobox e2e across two real nodes
└── app/                   Vite + React + TypeScript
    └── src/generated/     the typed client — generated, committed, diffed in CI
```

## Run it

```bash
pnpm install                     # once, at the repo root
cargo mero build -p kv-store     # emits res/kv_store.wasm + res/abi.json
pnpm -F kv-store codegen         # regenerates src/generated from that ABI
pnpm -F kv-store dev             # http://localhost:5173
```

Install the wasm on a node, then use the app's own **Choose a context** screen —
under `AppMode.MultiContext` the auth callback returns tokens and an application
id and nothing else, so context selection is the app's job.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test -p kv-store` | `TestHost` unit tests + 3-replica convergence | no |
| `pnpm -F kv-store test` | the generated client covers the ABI | no |
| `merobox bootstrap run workflows/simple-store.yml` | two real nodes converging | yes |

The `cargo test` layer is the one worth knowing about: `converge_app` and
`TestHost` drive real CRDT state through a native mock host, so convergence is
testable with no node and no wasm at all.

## The three behaviours the e2e pins down

Easy to get subtly wrong, and all three pass a naive test:

- **`update_if_exists` must not insert.** Asserted *before* any write, so the map
  is genuinely empty — run it after a `set` and it passes either way.
- **`get_or_insert` returns the EXISTING value**, not the argument. If it
  returned the argument, `or_insert` would be overwriting, which is the opposite
  of the entry API's point.
- **`remove` and `clear` emit nothing for a no-op.** Emitting for an absent key
  broadcasts a change that never happened.

## Invitations and deep links

Ported from `mero-chat-pwa`, which is the reference implementation, with the
payload adapted: chat invites you to a chat group, this invites you to a KV
**context**, so the payload carries the signed namespace invitation plus the
namespace and context ids.

```
InviteCard   createNamespaceInvitation → payload → deflate → base58 → createLink
             → https://links.calimero.network/com.calimero.kv-store/join?invitation=…

main.tsx     primeDeepLinkCapture() — an IIFE at module scope, BEFORE createRoot
JoinCard     paste path, for a link that arrived some other way
```

Four things here are deliberate, and each exists because the naive version
breaks:

- **Capture happens before React mounts.** On a cold invite open the user is not
  authenticated, so the component that would read the invitation never mounts
  until after the auth reload — by which point the URL is gone. A component
  effect is always too late.
- **The intent is durable and only acked on success.** `PendingIntentStore`
  keeps it in localStorage across the login reload, and
  `isTerminalInvitationError` discards it *only* for errors that can never
  succeed (expired, invalid, bad signature, already a member). Anything
  unrecognised — a timeout, "no online member" — is kept and retried. The
  asymmetry is the point: a dropped invitation is unrecoverable for the user, a
  retried one costs a round trip.
- **The invitation object is passed through opaquely.** It carries a signature
  over a signed body plus unsigned bootstrap fields that sit outside it, so
  re-modelling it through a local type drops fields and invalidates the
  signature. `parseInvitationPayload` shape-checks only far enough to see the
  envelope, and a unit test asserts an unknown field survives the round trip.
- **One link, HTTPS.** The https link already hands off to the desktop launcher;
  a second `calimero://` link would ask the user to choose between two things
  they cannot tell apart.

### ⚠️ The launcher path needs the frontend actually deployed

The code is complete, and the **paste** path works now. Opening a link from a
browser or Calimero Desktop additionally needs the *published bundle* to declare
`links.frontend`: the launcher resolves the link to an installed app, reads that
field, and **forgets the link** when it is missing — `"app has no frontend URL;
cannot open"`.

`logic/Cargo.toml` now declares `frontend = "https://mero-kv-store.vercel.app"`,
so the next release carries it. Two things still have to be true, and neither is
enforced by CI:

1. **The Vercel project must exist, named `mero-kv-store`**, with Root Directory
   `apps/kv-store/app`. The project name is what owns `<project>.vercel.app`, so
   a project named anything else produces a different origin and silently
   invalidates the declared one.
2. **It must exist before the release publishes.** The release workflow runs on
   a push to main, so linking Vercel and merging are the same step. A merge
   without the project leaves a published bundle authorizing a login callback at
   an origin nobody controls — this field is the registered redirect URI, and it
   is compared by exact origin.

Until a release has actually published, the launcher path stays dark: what
matters to the launcher is the field in the *published* bundle, not the one in
this repo.

## Two caveats worth carrying to the next app

**The ABI loses `Option<T>`.** `get(key) -> Option<String>` is recorded as
`"kind": "string"`, so the generated client types it `Promise<string>` when a
missing key really returns `null`. Codegen makes **method names and argument
names** compile-time facts; it does not make nullability one. Needs fixing in
core's ABI emitter.

**`get_unchecked` panics on purpose.** It is in the contract as the
counter-example — a panic aborts the whole execution, so nothing in that call
commits. Keep it; it is the cheapest demonstration of why `get_result` exists.
