# Dev testing — Mero Stream

Streaming over Calimero needs **two** context members to observe a fragment
crossing the wire, which a single node can't provide. For solo testing we run
two local nodes and point two browser profiles at them — the same harness shape
as Mero Meet.

**No Tauri desktop shell is needed.** This runs entirely in a plain browser, and
that is not a workaround — it is how the app reaches the node anyway:

- node traffic is **direct** HTTP + SSE from the browser to merod. Unlike
  mero-chat, this app never routes bytes through a Tauri Rust proxy.
- merod's CORS defaults to allow-any-origin, and `dev-node*.sh` additionally force
  `allow_all_origins = true`.
- auth is an ordinary bearer token, which `dev-node*.sh` mint from the admin
  credentials. The desktop's only real job was handing that token to the webview
  in a URL hash — `dev-invite.sh` prints the same hash.
- neither route uses WebRTC, so there is no TURN/STUN or native media bridge to
  provide. (Mero Meet needed one; nothing here does.)

The single desktop-only gap is **camera permission in WKWebView**, which is why
measurement runs should use Chrome for now.

## One-shot two-node stack

```bash
make dev-nodes      # node1 + node2 + join + print the two browser URLs
make dev            # (separate terminal) vite dev server
make dev-stop       # tear both nodes down
```

`dev-node.sh` builds the WASM, boots node1, installs the app and creates a stream
context. `dev-node2.sh` boots node2 and installs the app. `dev-invite.sh` then
joins node2 to node1's namespace and prints two ready-to-paste URLs (also saved to
`/tmp/mero-stream-dev-urls.txt`) — open them in **two separate browser profiles**,
since each carries a different node and identity in its hash.

Use **Chrome or Edge**: the `/live` route needs WebCodecs, which Safari only has
from 16.4.

## Which route

| Route | Approach | What it does |
|---|---|---|
| `/live` | 2 | 640×480 hardware H.264 in the browser; the app stores opaque bytes |
| `/stream` | 3 | 64×48 greyscale, toy codec runs **inside** the WASM app |

`dev-invite.sh` prints `/live` URLs; swap the path for `/stream`.

## What to look for

Open the dev route in both profiles, hit **Start** in one, and watch:

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
