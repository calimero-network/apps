# Dev testing — Mero Stream

Streaming over Calimero needs **two** context members to observe a fragment
crossing the wire, which a single node can't provide. For solo testing we run
two local nodes and point two browser profiles at them — the same harness shape
as Mero Meet.

> ⚠️ The `scripts/dev-node*.sh` harness is adapted from Mero Meet and has not yet
> been end-to-end validated for Mero Stream (Phase P2). Expect to tune it.

## One-shot two-node stack

```bash
make dev-nodes      # node1 + node2, install mero_stream.wasm, create a "probe" context
make dev            # (separate terminal) vite dev server
make dev-stop       # tear both nodes down
```

`dev-node.sh` builds the WASM, boots node1 (ports 2428/2528), installs the app,
and creates a stream context. `dev-node2.sh` boots node2 (2429/2529), joins the
same namespace, and appends its URL/tokens so a second browser profile can open
the app against it.

## What to look for

Open the `/stream` dev route in both profiles, hit **Start** in one, and watch:

- the local **capture** canvas (downscaled luma preview),
- the remote **decoded** canvas advancing on each `FramePosted`,
- the **stats** panel: `liveFragments`, `nextSeq`, `oldestLiveSeq`,
  `prunedFrames`, and the last frame's `encodedBytes` → compression ratio.

The interesting numbers (§4 of the task doc): end-to-end fragment latency,
per-fragment WASM CPU, delta size distribution, and — over a *sustained* run —
RocksDB on-disk growth vs. tombstone accumulation (C3).

## Unit / contract tests

```bash
make logic-test     # native TestHost — determinism (C1), chunking (C2), no-key-reuse (C3)
make app-test       # frontend luma helpers (vitest)
```
