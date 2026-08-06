# Mero Stream — streaming media *over* Calimero

> **Experimental capacity probe, not a shippable feature.** This app
> deliberately does the *wrong* thing — pushing audio/video through the Calimero
> contract state (CRDT → DAG → gossipsub → apply) instead of WebRTC — to learn
> the node's ceiling **with numbers**. The deliverable is a stated ceiling with
> the first bottleneck named. See `ROADMAP-TASKS/task-3-streaming-over-calimero.md`.
>
> For real, low-latency calls, media rides native WebRTC peer-to-peer and never
> touches the contract — that is **Mero Meet**, and it remains the right answer.

## The distinguishing move (approach 3)

The toy **codec runs deterministically inside the WASM contract**, not in the
browser. The frontend hands the contract a *raw* luma frame; `encode_frame`
compresses it in WASM and stores only the compressed fragment; a `get_frame`
view reconstructs the frame in WASM on any node.

```
 sender node                                     peer node(s)
 getUserMedia → canvas → raw luma                SSE FramePosted(seq)
   → encode_frame(raw,w,h,track,now)  ══gossip══▶   → get_frame(seq) [view, decode in WASM]
   [MUTATION, WASM encodes]          only the        → luma → canvas → <video>
   store frag-{seq}-{chunk}          compressed
   prune < seq-WINDOW                fragment
   emit FramePosted                  crosses (≤ ~1 MiB, target 4–32 KiB)
        raw frame stays LOCAL to the sender ▲
```

Because the raw frame is a mutation *argument*, it is local to the executing
node — only the resulting **state delta** (the compressed fragment) is sealed and
gossiped. So `encode_frame(raw)` runs on the sender and only the compressed
fragment propagates.

## Hard constraints (baked into the contract)

- **C1 Determinism.** The codec is **integer-only** (no float / SIMD / threads /
  randomness / wall clock — the contract takes `now: u64` as an arg). A `view`
  decode returns the same bytes on every node.
- **C2 Small deltas.** Every stored fragment stays well under the 1 MiB
  gossip/delta cap; we target 4–32 KiB and **sub-frame chunk** anything larger
  (`MAX_CHUNK_BYTES = 16 KiB`).
- **C3 Delete is a tombstone.** Fragment keys are globally monotone and **never
  reused** (`frag-{seq}-{chunk}`); pruning the live window emits *more*
  tombstones. Tombstone growth is a primary metric, not a footnote.
- **C4 Toy codec.** Codec #1: downscale (in the browser canvas) + 4-bit luma
  quantize + RLE, in WASM. Trivially deterministic; ratio tunable by geometry.

## Contract API (`logic/src/lib.rs`)

| Method | Kind | Purpose |
|--------|------|---------|
| `init(name)` | init | Create the stream context. |
| `join(username, now)` | mutation | Become a member (gates `encode_frame`). |
| `get_members()` | view | Roster. |
| `encode_frame(raw, width, height, track, now) -> seq` | mutation | **Task-3 core.** Encode raw luma in WASM, chunk, store, prune, emit `FramePosted`. |
| `get_frame(after_seq) -> DecodedFrame[]` | view | Reassemble chunks + decode in WASM. |
| `frame_checksum(seq) -> u64?` | view | FNV-1a over the decoded pixels, computed in WASM. Two nodes agreeing on it **is** the C1 bit-identity proof; `null` = frame not live. |
| `prune_frames(before_seq)` | mutation | Explicit reaper (also inline in `encode_frame`). |
| `get_stats() -> StreamStats` | view | §4 instrumentation: live fragments, next/oldest seq, pruned count. |
| `rename_stream(name)` | mutation | Owner-only. |

> **Timestamp units.** `encode_frame`'s `now` is unix **milliseconds**; every
> other `now` is **seconds**. Fragments are the one thing whose timestamp gets
> subtracted from a receiver's clock (§4 end-to-end latency), and that
> measurement is meaningless quantized to whole seconds.

Events (SSE): `Initialized`, `MemberJoined`, `FramePosted(seq)`, `FramesPruned(beforeSeq)`.

## Two approaches, both live in this app

The task doc lists three ways to move media through Calimero. This repo now
implements two of them, on separate routes, because they fail for opposite
reasons and the contrast IS the finding:

| | `/stream` — approach 3 | `/live` — approach 2 |
|---|---|---|
| Where the codec runs | **inside the WASM app** | **in the browser** (WebCodecs) |
| Codec | toy: 4-bit quantize + RLE | real: hardware H.264 |
| Resolution | 64×48 greyscale | **640×480** |
| Why it's capped there | every node must compute bit-identical bytes (C1), and real codecs are float-heavy → non-deterministic | not capped by determinism — the app never computes the media, so a float codec is fine |
| Node CPU per frame | ~9.93 ms measured | ~0 (a memcpy; no codec work) |
| New state at 480p30 | ~4.6 MB/s (≈230× chat) | ~188 KB/s (≈9× chat) |
| Compression | ~2–10× | ~60× |
| Remaining risk | WASM CPU **and** replication | replication + tombstones only |

Approach 2 needs a **keyframe-clamped reaper**: a delta frame is undecodable
without the keyframe it references, so pruning past the newest keyframe leaves a
stream that replicates happily and shows nothing. That clamp is the one piece of
media awareness the app has, and it's unit- and e2e-tested.

**Neither is shippable media.** Approach 2 removes the CPU wall; whether
replication can carry 188 KB/s of permanently-stored, tombstone-generating state
is exactly what the P3 run is for.

## Status (phased — see the task doc §7)

- **P0 — Contract skeleton + determinism proof — ✅ DONE.** `Fragment` state,
  `encode_frame` / `get_frame` / `prune_frames`, codec #1. **28 unit tests**,
  incl. bit-identical round-trip (C1), chunk split/reassemble (C2), the
  no-key-reuse-across-prune regression (C3), the `frame_checksum` properties the
  e2e leans on, codec edges (>255 runs, truncated/oversized streams, the 4-bit
  quantization contract), the geometry guards, and multi-sender frame grouping.
- **P1 — Frontend dev route — ✅ DONE.** Capture → `encode_frame`;
  `FramePosted` SSE → `get_frame` → render, with a slow poll behind it.
  Desktop/dev-gated, off any call path. **54 unit tests** across the luma path,
  the §4 metric arithmetic, and session bootstrap.
- **P2 — e2e — ✅ DONE.** Three merobox scenarios, all in CI against merod
  `0.11.0-rc.19`:

  | Scenario | Nodes | Proves |
  |---|---|---|
  | `e2e.yml` | 2 | C1 across the wire — the peer's independent in-WASM decode is bit-identical (`frame_checksum` equality) |
  | `e2e-tombstones.yml` | 2 | C3 across the wire — after 40 frames force pruning, both nodes agree on the exact bounded window, and a *post-prune* frame is not shadowed by prune tombstones |
  | `e2e-fanout.yml` | 3 | gossip fan-out at K=2 — one sender, **both** peers decode to the same checksum |
| `e2e-live-chunks.yml` | 2 | **approach 2** — opaque codec bytes cross byte-identically, and `prune_chunks(everything)` still leaves the peer a decodable keyframe |
- **Browser leg — ✅ AUTOMATED.** `make e2e-call` runs the whole two-node 480p
  call unattended: `cargo mero build` → both nodes → app install → namespace,
  context and open invitation → vite → two Chrome contexts → sender encodes,
  receiver decodes → teardown. It asserts what the merobox scenarios structurally
  cannot: that the receiver's canvas holds real 640×480 pixels *and that they
  change*, with the state read from the receiver's own node. Needs real Google
  Chrome — Playwright's bundled Chromium has no proprietary codecs, so no H.264.
  See DEV-TESTING.md.
- **Two people getting into a call — ✅ IN THE UI, AND CLICKED IN A TEST.**
  `/streams` lists **namespaces** (a "stream"), `/streams/:namespaceId` lists that
  stream's **rooms** — a room being a subgroup plus the context that is the call.
  Invite mints a code at either scope; Join accepts either. `make e2e-ui` drives
  exactly that by clicking — create stream → create room → mint code → paste on
  **node2** → both peers see each other at 640×480 — which is the one path
  `e2e-call` (types `/live` directly) and `e2e-suite` (curl) both structurally miss.
- **P3 — Load curve — 🚧 TOOLING READY, RUN PENDING.** `scripts/load-curve.py`
  ramps fps × geometry and emits the CSV (achieved fps, encode RTT p50/p95,
  errors, live/pruned fragments, peer-side counters, RocksDB growth). The
  30–60 min sustained run and the results write-up are what remains — *that
  write-up is the actual deliverable.*

### Where the §4 numbers come from

| Metric | Measured by | Status |
|--------|-------------|--------|
| End-to-end fragment latency | frontend (`lib/metrics.ts`) | ✅ two-clock caveat documented |
| Ingest rate (fps, KiB/s) | frontend + load generator | ✅ |
| Encode round-trip (upper bound on WASM CPU) | frontend + load generator | ✅ |
| Seq gaps / drop proxy | frontend | ✅ |
| Tombstone growth | `get_stats().prunedFrames` + RocksDB `du` | ✅ (load generator) |
| Server-side cost per mutation (mean) | core `/metrics`, `execution_duration_seconds_{sum,count}` by method | ✅ measured: **9.93 ms** mean for `encode_frame` at 64×48 |
| Server-side cost **percentiles** | same histogram's buckets | ⚠️ buckets are 1 s…512 s, so every observation lands in the first one — mean is exact, tail shape is not available |
| **Sealed delta size** | core logs `artifact_len` at `debug` | ⚠️ log-grep only, no histogram |
| **Gossip publish drops / backpressure** | — | ❌ `libp2p_gossipsub_messages_total` (received count) is the *only* gossipsub series core exposes |

`/metrics` is served unauthenticated on the RPC port (`crates/server/src/metrics.rs`),
so a run can scrape it directly:

```bash
curl -s http://localhost:2660/metrics \
  | grep -E 'execution_duration_seconds_(sum|count).*encode_frame'
# mean server-side ms = sum/count*1000
```

Worth knowing what that 9.93 ms means: client-observed encode RTT at the same
geometry was 19.69 ms p50, so **roughly half the cost is JSON serialization,
transport and RPC rather than the node**. At 4×4 the node figure was 1.81 ms, so
the server side scales with geometry while the client overhead is close to fixed.

## Build & test

```bash
make logic-test     # contract unit tests (native TestHost) — C1..C3
make logic-build    # cargo mero build → logic/res/mero_stream.wasm (ABI embedded)
make logic-bundle   # cargo mero bundle → logic/dist/com.calimero.merostream.mpk
make app-build      # frontend bundle (tsc + vite)
make app-test       # frontend unit tests (incl. the §4 metric arithmetic)
make dev            # vite dev server (the /stream dev route)
make dev-nodes      # two local nodes + install + a stream context (solo testing)
make e2e-call       # FULLY AUTOMATED two-node 480p call in real Chrome
make e2e-ui         # the same call, but reached by CLICKING: stream → room → invite → join
make workflows      # ALL four e2e scenarios over merobox (Docker + merobox>=0.6.49)
make load-curve     # P3 load generator usage
```

### The rc.19 toolchain

Both build scripts go through **`cargo mero`** (core `tools/cargo-mero`), pinned by
`scripts/ensure-cargo-mero.sh` to the same release as the four `calimero-*` git
tags in `logic/Cargo.toml`. The pin is not cosmetic: the ABI emitter is versioned
with core, so a tool and an SDK from different releases can embed a schema the node
doesn't share.

`cargo mero build` emits the ABI from `src/*.rs` (no `build.rs` anywhere — core
#3319 deleted all 60 of them), compiles to wasm32, size-optimizes with a
**built-in** `wasm-opt` (reproducible; the old script silently skipped optimization
when `wasm-opt` wasn't on `PATH`, so identical source produced different bytes per
machine), and embeds the ABI as the `calimero_abi_v1` custom section.

`cargo mero bundle` derives `manifest.json` from `[package.metadata.calimero]` in
`Cargo.toml` and the node's own canonical `BundleManifest` type. That replaces a
hand-written heredoc which shipped `"hash": null` — **a bundle the node rejects as
malformed before it even checks the signature** — plus unwritable `license` /
`tags` / `links` slots the registry renders. `build-bundle.sh` re-verifies both
properties on the packaged `.mpk` rather than trusting the tool.

Bundle metadata now lives in `Cargo.toml`, not in the script.

CI gates: `cargo fmt --check`, `cargo clippy -D warnings`, contract tests, WASM
build · eslint, prettier, `tsc --noEmit`, vitest, vite build · ruff +
byte-compile on `scripts/` · the three e2e scenarios as parallel matrix legs.
The e2e files use distinct port bases (2760/2780/2800) so they can also run
concurrently on one host.

Toolchain: Rust `1.89.0` (pinned in `logic/rust-toolchain.toml`), pnpm for the
frontend. The contract pins `calimero-*` to the core release **tag**
`0.11.0-rc.19`, which must match the merod image in `workflows/e2e.yml` — bump
them together. (Not `branch = "master"`: that rides unreleased protocol work
against a released node. Not `tag = "latest"` either: core has no such tag, so it
resolves only from a warm cargo cache and fails on CI.)
