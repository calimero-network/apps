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
| `prune_frames(before_seq)` | mutation | Explicit reaper (also inline in `encode_frame`). |
| `get_stats() -> StreamStats` | view | §4 instrumentation: live fragments, next/oldest seq, pruned count. |
| `rename_stream(name)` | mutation | Owner-only. |

Events (SSE): `Initialized`, `MemberJoined`, `FramePosted(seq)`, `FramesPruned(beforeSeq)`.

## Status (phased — see the task doc §7)

- **P0 — Contract skeleton + determinism proof — ✅ DONE.** `Fragment` state,
  `encode_frame` / `get_frame` / `prune_frames`, codec #1. 10 unit tests green,
  incl. bit-identical round-trip (C1), chunk split/reassemble (C2), and the
  no-key-reuse-across-prune regression (C3). WASM build passes.
- **P1 — Frontend dev route — 🚧 IN PROGRESS.** Capture → `encode_frame`;
  `FramePosted` → `get_frame` → render. Desktop/dev-gated, off any call path.
- **P2 — 2-node e2e + instrumentation — ⏳ DRAFT.** `workflows/e2e.yml` skeleton
  (fragment round-trip across two nodes). Not yet wired into CI.
- **P3 — Load curve.** Ramp fps/geometry, 30–60 min sustained run → CSV +
  results doc with the bottleneck named. *This is the actual deliverable.*

## Build & test

```bash
make logic-test     # contract unit tests (native TestHost) — C1..C3
make logic-build    # compile → logic/res/mero_stream.wasm
make app-build      # frontend bundle (tsc + vite)
make dev            # vite dev server (the /stream dev route)
make dev-nodes      # two local nodes + install + a stream context (solo testing)
```

Toolchain: Rust `1.89.0` (pinned in `logic/rust-toolchain.toml`), pnpm for the
frontend. The contract depends on `calimero-*` from `core` `master` (git).
