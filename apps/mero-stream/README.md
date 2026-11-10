# Mero Stream — streaming media *over* Calimero

> **Experimental capacity probe, not a shippable feature.** This app
> deliberately does the *wrong* thing — pushing audio/video through a Calimero
> app (its replicated log, or its presence channel) instead of WebRTC — to
> learn the platform's ceiling **with numbers**. The deliverable is a stated
> ceiling with the first bottleneck named. See
> `ROADMAP-TASKS/task-3-streaming-over-calimero.md`.
>
> For real, low-latency calls, media rides native WebRTC peer-to-peer and never
> touches the contract — that is **Mero Meet**, and it remains the right answer.

Mero Stream runs on Calimero 1.0: a contract on core's **component SDK**
(`calimero-sdk`, a `calimero:app` WebAssembly component on the node's
wasmtime runtime), developed against **`merod local`**, and a frontend that
talks to **Calimero Cloud** in production and to the local nodes in development
through mero-js's **`CalimeroClient`** (`@calimero-apps/connect`). See
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).

The web call needs a browser with WebCodecs (H.264) and a camera. The native
iOS and Android apps in `mobile/` move to 1.0 in #698, which depends on this
port (see [Mobile](#mobile)).

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local mero-stream       # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), **create a stream** (an organization), a
**room** in it (an app instance: one call), and press **Go live**. **Invite**
mints a link (approved with your passkey); a second browser profile with its own
passkey that opens it joins the stream and lands in the room.

## The three approaches, all live in this app

The task doc lists three ways to move media through Calimero. They fail for
different reasons and the contrast IS the finding:

| | `/stream` — approach 3 | contract — approach 2 | `/live` — approach 1 |
|---|---|---|---|
| How the bytes travel | `encodeFrame` (the app's log) | `postChunk` (the app's log) | **presence** (`/apps/{app}/presence`) |
| Where the codec runs | **inside the app component** | **in the browser** (WebCodecs) | in the browser (WebCodecs) |
| Codec | toy: 4-bit quantize + RLE | real: hardware H.264 | real: hardware H.264 |
| Resolution | 64×48 greyscale | **640×480** | **640×480** |
| Why it's capped there | every reader must decode bit-identical bytes (C1), and real codecs are float-heavy → non-deterministic | not capped by determinism — the app never computes the media | same |
| Per frame on the cluster | a contract run that encodes | a contract run that stores (a memcpy) | no contract run at all |
| New state at 480p30 | ~4.6 MB/s | ~188 KB/s | **zero — nothing is persisted** |
| Receive path | `FramePosted` → `getFrame` | `ChunkPosted` → `getChunks` | the bytes ride the presence event |
| Remaining risk | contract CPU **and** log size | log size | 4 KiB slices; a lossy channel |

The call page (`/live`) uses approach 1 only; `postChunk`/`getChunks` stay in the
contract and the typed client for measurement (a test, `ephemeralOnly.test.ts`,
keeps them off the call path). `/stream` is the approach-3 baseline, reachable by
URL.

### Approach 3: the codec runs in the contract

The frontend hands the contract a *raw* luma frame; `encodeFrame` compresses it
in the component and stores only the compressed fragments; a `getFrame` view
reconstructs the frame in the component on any read.

```
 sender                                           peer(s)
 getUserMedia → canvas → raw luma                 event FramePosted{seq}
   → encodeFrame(raw,w,h,track,now)  ══log══▶       → getFrame(afterSeq) [view, decode in the component]
   [CALL, the component encodes]     only the         → luma → canvas
   store (from, seq, chunk)          compressed
   prune < seq-WINDOW                fragments are
   emit FramePosted                  stored
```

### Approach 1: media on presence

The node's presence channel carries one entry per (account, device) per app:
never persisted, never in the log, the newest `seq` wins, gone 7 s after the
last update, every change pushed to every subscriber as one event.
`app/src/lib/ephemeralFrames.ts` turns that register into a lossy datagram pipe:

- An entry is at most **4 KiB** on a 1.0 node (v1's ephemeral slice was
  16 KiB), so a frame is fragmented: a 1.5 Mbps / 25 fps delta frame (~7.5 KB)
  is two fragments, a keyframe a dozen. A frame that loses a fragment is never
  shown; the next keyframe (at most 2 s away) is the retry.
- The framing header carries a per-sender `msgSeq` that advances every frame, so
  two byte-identical frames never coalesce, and a reassembler drops replays.
- The stream's opening `snapshot` (each author's current entry, up to 7 s old)
  is skipped: for media a stale frame is worse than none.

**None of the three is shippable media.** Approach 2 removes the CPU wall,
approach 1 removes the storage wall as well; what is left on approach 1 is a
4 KiB MTU, one HTTP publish per fragment, and a channel that may drop things.

## Constraints (in the contract)

- **C1 Determinism.** The codec is integer-only (no float / SIMD / threads /
  randomness / wall clock — the contract takes `now` as an argument). Every
  reader's `getFrame` decodes the same bytes; `frameChecksum` makes that
  assertable.
- **C2 Small entries.** Every stored fragment stays far below the 1 MiB a run
  may write: frames are split at `MAX_CHUNK_BYTES = 16 KiB`, opaque chunks are
  capped at 256 KiB (which also keeps a chunk's base64 under the node's 512 KiB
  argument cap).
- **C3 Keys are never reused.** Frame and chunk sequences are monotone, so a
  pruned key is never written again and a reader's cursor never points at a
  recycled one.
- **C4 Toy codec.** Downscale (in the browser canvas) + 4-bit luma quantize +
  RLE, in the component.

## Contract API (`logic/src/lib.rs`)

| Method | Kind | Purpose |
|--------|------|---------|
| `init(name?)` | init | Create the room; `name` is the stream name (the frontend passes the room's name). |
| `join(username, now)` | call | Become a member (gates the writes), or rename yourself. Returns the `Member`. |
| `getMembers()` | view | Roster, in account order. |
| `encodeFrame(raw, width, height, track, now) -> seq` | call | **Task-3 core.** Encode raw luma in the component, chunk, store, prune the caller's frames older than 30 seqs, emit `FramePosted`. |
| `getFrame(afterSeq) -> DecodedFrame[]` | view | Reassemble + decode every frame after the cursor, by seq. |
| `frameChecksum(seq) -> u64?` | view | FNV-1a over the decoded pixels; `null` = frame not live. |
| `pruneFrames(beforeSeq)` | call | Prune the caller's own frames below the watermark. |
| `getStats() -> StreamStats` | view | Approach-3 instrumentation: live fragments, next/oldest seq, pruned frames. |
| `postChunk(dataB64, track, isKeyframe, codec, width, height, timestampUs, now) -> seq` | call | Approach 2: store one opaque WebCodecs chunk in the caller's own ring; age out the caller's chunks older than 6 s (never their newest keyframe); for the owner, sweep senders silent for 30 s. Emits `ChunkPosted`. |
| `getChunks(cursors) -> ChunkView[]` | view | Every chunk past each sender's cursor; a sender missing from `cursors` starts at their newest live keyframe. |
| `keyframeCursors() -> SenderCursor[]` | view | Each sender's newest live keyframe. |
| `getLiveStats() -> LiveStats` | view | Approach-2 instrumentation, per sender. |
| `pruneChunks(beforeSeq)` | call | Prune the caller's own chunks, never past their newest keyframe. |
| `renameStream(name)` | call | The room's owner only (`NotOwner`). |
| `isMemberAdmin(member) -> bool` | view | Whether `member` (an account) is the room's owner. |

Errors (`422 APP_ERROR`, `{ code, fields }`): `NotJoined`, `ZeroDimension`,
`DimensionTooLarge {max}`, `RawTooLarge {max}`, `RawLengthMismatch {expected, got}`,
`BadBase64`, `EmptyChunk`, `ChunkTooLarge {max}`, `CodecRequired`, `NotOwner`.

Events (to everyone the room reaches): `Initialized`, `MemberJoined { account }`,
`FramePosted { seq }`, `FramesPruned { beforeSeq }`, `ChunkPosted { seq }`; every
field is named (core D63), so the data is `{"seq": "5"}`, never `{"0": …}`.

**Timestamp units.** `join`'s `now` is unix seconds; `encodeFrame`'s and
`postChunk`'s are milliseconds (end-to-end media latency is meaningless at
second resolution).

**Who can write what.** Every write lands under the caller's own account:
fragments are keyed `(from, seq, chunk)`, chunks `(from, seq)`, cursors and
member rows by account, and no method takes a sender id. So nobody can rewrite,
prune or plant media under someone else's name, and readers need no
"who wrote this row" checks. The room's owner (its creator, `env::app_owner()`)
renames it and sweeps departed senders' buffers. Still open, as in v1:
approach 3's global frame seq is shared, so a member can advance it.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-stream/logic/Cargo.toml` | the codec's unit tests (C1 bit identity, >255 runs, truncated and oversized streams, the 4-bit contract); v1's `TestHost` tests method for method on core's wasmtime engine (encode/decode, chunking, the frame window, checksums, approach 2's per-sender rings, keyframe clamp, wall-clock window, count backstop, stale-sender sweep, four broadcasters); v1's forged-write tests as "every write is the caller's own"; access and wire checks; every `scenarios/*.json` | no |
| `pnpm -F mero-stream test` | the typed client's methods and parameter names are exactly `logic/res/abi.json`'s, and its conversions; streams (orgs), rooms (app instances) and invitation links; presence encoding; the media framing, codecs, metrics, slots, congestion control; sign-up, stream and room creation, invitation, redemption into a room (mocked client) | no |
| `pnpm merod-local e2e mero-stream` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node | yes |

The scenarios are v1's two- and three-node Docker workflows with accounts instead of nodes:

| scenario | v1 workflow | proves |
|---|---|---|
| `fragment-round-trip.json` | `e2e.yml` | a frame encoded by one account decodes to the same checksum, geometry and pixels for another |
| `tombstones.json` | `e2e-tombstones.yml` | after 40 frames both readers see the exact bounded window (31 live, 9 pruned, oldest 10); a post-prune frame decodes; a pruned frame reads as absent |
| `fanout.json` | `e2e-fanout.yml` | one sender, two other readers, one checksum |
| `live-chunks.json` | `e2e-live-chunks.yml` | approach 2: opaque bytes and their decoder config cross exactly; `pruneChunks(everything)` still leaves the keyframe; another member's prune cannot touch them |
| `access.json` | — | anonymous and outsider callers refused by the node, `NotJoined` before `join`, `NotOwner`, the owner as admin, a member's whole write surface aimed at the owner's media reaching only its own, a guest streaming, malformed arguments |

v1's `e2e-ephemeral-frames.yml` (approach 1 over v1's `set_ephemeral`) has no
scenario: presence is a node channel, not a contract method, so it is covered
by `presence.test.ts` and `ephemeralFrames.test.ts` (fragmenting to the 4 KiB
entry and reassembling). The capacity ladder probe and `scripts/load-curve.py`
drove v1 nodes over JSON-RPC in Docker; they are removed, and a load run on the
component runtime is still to be written (it would drive `encodeFrame` /
`postChunk` through `CalimeroClient` against `merod local`).

## What changed in the port, and why

Same methods, same arguments (in camelCase), same answers and events, with these
differences a client sees:

| | v1 (`calimero-sdk`, wasmer, a context) | now (component SDK, an app instance) | why |
|---|---|---|---|
| transport | JSON-RPC `execute` on your own node, a context id | `CalimeroClient.call` / `.view` on any node of the cluster, an app id | one app per replicated log |
| method and argument names | `encode_frame`, `after_seq`, `data_b64`, `is_keyframe`, `timestamp_us`, `before_seq`, … | `encodeFrame`, `afterSeq`, `dataB64`, `isKeyframe`, `timestampUs`, `beforeSeq`, … | the ABI is camelCase |
| `init` | `init(name)` | `init(name?)`, `""` without it | the harness and `merod-local e2e` create apps without init arguments; the frontend passes the room name |
| `u64` arguments (`now`, `afterSeq`, `beforeSeq`, `seq`, `timestampUs`, cursors' `afterSeq`) | numbers | decimal strings (`"1751955010000"`) | D20 |
| `encodeFrame`'s `raw` | a JSON array of byte values | base64url bytes | D20 (`Vec<u8>`); also ~4x smaller on the wire |
| `u64` results and fields (`seq`, `joinedAt`, `updatedAt`, `createdAt`, `nextSeq`, `oldestLiveSeq`, `prunedFrames`, `timestampUs`, `afterSeq`, `oldestLive`, `lastKeyframe`, `newestAt`, `pruned`, `liveBytes`, `prunedChunks`, `frameChecksum`) | numbers (the checksum lost precision above 2^53) | decimal strings | D20 |
| `DecodedFrame.pixels` | a JSON array of byte values | base64url | D20 |
| `ChunkView.dataB64`, `postChunk`'s `dataB64` | standard base64 | unchanged | it is the app's own field, not a `Vec<u8>` |
| `memberId`, `from`, `MemberJoined`'s id | a device key (hex), not the account | the caller's **account id** | identity is an account (passkeys); one broadcast per account |
| `join` | refused a device another account had registered | no such case | accounts, not device keys |
| reads | any method (every one ran through `execute`) | `getMembers`, `getFrame`, `frameChecksum`, `getStats`, `getChunks`, `keyframeCursors`, `getLiveStats`, `isMemberAdmin` are views; a write called as a view is `NotAView` | a view is answered without touching the log |
| refusals | `app::bail!` strings ("join the stream before this operation", …) | typed codes, listed above | `#[app::error]`'s wire shape |
| events | tuple payloads, bare values (`FramePosted: 5`) | same names, named fields: data `{"seq": "5"}` (`{"account": …}` for `MemberJoined`, `{"beforeSeq": …}` for `FramesPruned`); `Initialized` has no data | the component event shape |
| owner / admin | `Ownable` stream name and an `AccessControl` admin role, both the creator's account | the app instance's owner (its creator) | `env::app_owner()` replaces the owner stamps |
| who sweeps a departed sender | moderators of `chunks` (the creator) | the room's owner | same person |
| write rules | owner stamps on every row (`Authored`, `Moderated`), readers re-checking who wrote each fragment and chunk | every key embeds the caller's account; nothing to re-check | one log, and no method takes a sender id |
| `get_frame` order | seq, then sender's device key | seq, then sender's account id | |
| `getMembers` order | none in particular | account order | keys read in order |
| who may call | any member of the context | any member, admin or guest of the room's org, and the owner; anonymous `401`, others `404` | the org is the access boundary |
| v1 `init`'s `Frozen` initial name and `Ownable` workaround | needed (rc.20 dropped writes in `init`) | gone: `init` writes the name | |

The frontend changed with it:

- **Gone:** mero-react (`MeroProvider`, the node/cloud login popup,
  `useExecute`, `useSubscription`, `useJoinSync`, the invitation dialog and
  gate), mero-platform, the desktop SSO hash bootstrap and Tauri bridge, the
  web-only notice for the desktop window, the v1 namespace/subgroup/context
  admin calls (`lib/groups.ts`), the invitation codec and deep links, the
  application-id resolution, TEE badges and hosting checks, `@calimero-apps/names`
  (namespace member metadata), the Playwright and node-driving e2e scripts
  (`app/e2e`, `app/tests`), and their tests.
- **Now:** `@calimero-apps/connect` resolves the target from the build
  (`merod local` under `vite`, a Cloud cluster under `vite build`); sign-in is a
  **passkey**; a **stream** is an organization (`client.me().orgs`,
  `createOrg`); a **room** is an app instance in it (`listApps`,
  `createApp(name, source, { org, initArgs: { name } })`); an **invitation** is
  an org invite link (`client.invite(org, "member", passkey)`, a passkey
  step-up; opening it after sign-in redeems it and opens the stream or room);
  stream-wide display names are org member metadata (`setMemberMetadata`); the
  call carries media on the node's **presence** channel (`publishPresence`,
  `presenceStream`); `/stream` listens on the room's event stream
  (`client.events`).
- `src/lib/meroStream.ts` is the one typed adapter: it calls the contract by
  method name and converts the answers back to the shapes the screens were
  written against (numbers, `pixels` as bytes), so the pages kept their logic.
  A test checks its method list against `logic/res/abi.json`.
- Rooms are no longer "joined" separately from the stream: everyone in the
  org reaches every room, and a room row shows "joined" once you have called
  `join` in it.
- Each presence entry is 4 KiB (v1's slice: 16 KiB), so frames are fragmented
  four times finer.

**Removed with no replacement:** the v1 Docker workflows (`logic/workflows`, the
capacity-ladder probe), the Docker dev-node scripts (`scripts/dev-node*.sh`,
`dev-invite.sh`), `e2e-live-call.sh` and the browser drivers, `load-curve.py`,
`ensure-cargo-mero.sh`, `build.sh` / `build-bundle.sh`, `res/state-schema.json`,
`rust-toolchain.toml` (the component CI uses stable). A two-browser call is now
`pnpm dev:local mero-stream` and two browser profiles.

## Mobile

The native **iOS and Android** apps move to Calimero 1.0 in a separate PR,
#698, which builds on this port's contract (`logic/res/abi.json`) and merges
after it. Until then `mobile/` is as on `main`; see
[mobile/README.md](mobile/README.md).

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
a bundle. Rooms are created from the package (`com.calimero.mero-stream`). The
`frontend` link in `logic/Cargo.toml` and `app/vercel.json` stay as the
listing's link; they are not where people sign in. See
[docs/DEPLOY.md](docs/DEPLOY.md).

```bash
pnpm -F mero-stream build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-stream/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").
