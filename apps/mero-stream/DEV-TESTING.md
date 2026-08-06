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

## Fully automated: one command, no hands

```bash
make e2e-call              # headed Chrome (default)
make e2e-call-headless
make e2e-call-keep         # leave the stack up afterwards to poke at
make e2e-suite             # + the 4-scenario admin-API suite, streams on the room it builds
make e2e-ui                # the SAME two people, but every step CLICKED (see below)
```

That chains the whole thing: `cargo mero build` → node1 (install app, namespace,
context) → node2 (install app) → open invitation + namespace/context join → vite
→ two Chrome contexts → sender encodes 480p H.264, receiver decodes → teardown.
Nodes and vite are torn down on every exit path including failure, so a failed run
never leaves ports 2660/2662/5173 held.

**Real Google Chrome is required, not Playwright's bundled Chromium.** Chromium
ships without proprietary codecs, so H.264 encode/decode is simply absent and the
page takes its "no VideoEncoder" branch. The script checks for Chrome and fails
fast with that explanation rather than reporting a confusing decode failure.

No webcam needed: Chrome runs with `--use-fake-device-for-media-stream`, which
supplies a *moving* synthetic pattern — that motion is what makes "the picture
changed between samples" a real assertion.

What it actually proves, beyond what the merobox e2e can:

1. both peers authenticate off the URL hash and join the context;
2. H.264 annex-B 640×480 encode is genuinely supported (asked of `VideoEncoder`
   directly, not just inferred from the page);
3. the sender posts chunks with zero post errors;
4. **state crosses nodes** — the receiver's *own* node reports the live chunks,
   read from node2's API, not node1's;
5. **the receiver decodes real pixels** — the canvas is 640×480, has non-uniform
   content (not a flat fill), and *changes* between two samples. Blank and frozen
   both fail, which matters because a stream that replicates happily and shows
   nothing is the exact failure the keyframe clamp exists to prevent and it looks
   healthy from every other angle;
6. the reaper stayed keyframe-clamped (`oldest live chunk` ≤ `last keyframe seq`).

Artifacts land in `data/browser-call/`: screenshots of both peers, per-page
console logs, and `result.json` with every metric. On failure it also writes
`*-failure.png`.

The merobox scenarios stay the byte-level authority — they use deliberately
**invalid** H.264, because the approach-2 claim is that the app never interprets
the bytes, and a scenario built on real access units would hide a regression where
it started. This script covers the codec ends; those cover everything between.

## `make e2e-ui` — the second person's whole path, clicked

`e2e-call` and `e2e-suite` between them leave one gap, and it is the gap that
matters most to a real user: **neither exercises the UI that gets two people into
the same room.** `e2e-suite` does that setup over raw HTTP with curl-shaped
`fetch`, and `e2e-call` navigates straight to `/live` with a pre-built context in
the URL hash — a test that types `/live` cannot catch a picker that never gets you
there, which is exactly the bug that once left the product on 64×48 while the
suite passed at 480p.

`make e2e-ui` (`app/e2e/ui-invite-call.mjs`) drives the real thing:

1. node1 lands on the picker with **no context in the hash**, types a name, clicks
   **Create stream** — and must land on that stream's **room list**, not in a call.
   Namespace and room are different things and the route has to say so.
2. node1 types a room name, clicks **Create room** — must land on `/live`, joined.
3. node1 goes back, clicks **Invite** on the room, and the code must be **one
   pasteable base58 token**: no JSON, no whitespace, none of base64's `+/=`. The
   UI must also state what the code opens, and **Copy** must confirm.
4. node2 — a *different node*, its own tokens — pastes that code and clicks
   **Join**. One paste must carry it through the namespace join, the room, and the
   context, landing in the call.
5. Both start capture. Each must show **exactly one** remote tile, 640×480, with
   non-uniform pixels that *advance*, **labelled with the other person's name**.

It also asserts the **loading states are real**, which is otherwise untestable by
eye: a `MutationObserver` is installed *before* each click (these states are
transient and sampling after the fact is a race) and the run fails unless the
clicked button reported `aria-busy` and a *named* step status appeared —
"Creating the room…", "Opening the room to namespace members…", "Joining the
namespace …". A single "Working…" would not pass.

Artifacts in `data/ui-invite-call/`: both call screenshots, the room list with the
invite box open, the empty picker, console logs, `result.json`. On a thrown timeout
the driver dumps each page's visible status line and URL — "waiting for
capture-toggle" on its own says nothing about why a join stalled.

## One-shot two-node stack (manual)

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
