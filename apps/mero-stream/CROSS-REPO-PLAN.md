# Cross-repo plan — making streaming-over-Calimero actually run

Mero Stream's **app side is self-contained and done** (P0 contract + tests, P1
frontend dev route). This document is the PLAN for the changes needed in *other*
repos to (a) run the app end-to-end and (b) capture the measurements that are the
real deliverable. **Nothing here is implemented yet** — it is a scoped to-do so
the work can be approved/sequenced before anyone touches `tauri-app` or `core`.

Legend: **[run]** = needed to run the app at all · **[measure]** = needed for the
§4 numbers (the deliverable) · **[dist]** = needed only for registry distribution.

---

## 0. What already works with NO other repo changes

Local two-node testing needs nothing outside this repo:

- `make logic-build` → `res/mero_stream.wasm`
- `scripts/dev-node*.sh` install the wasm via `install-dev-application` and create
  a context (no registry, no desktop).
- The frontend runs in a plain browser via the dev-session harness
  (`import.meta.env.DEV` + a hand-built auth hash), exactly like mero-meet's solo
  harness.

So P2 (2-node fragment round-trip) can be validated **before** any tauri/core
work. Start there.

---

## 1. `tauri-app` (desktop) — **[run]**, highest priority, and genuinely new vs. Mero Meet

The important difference from Mero Meet: **Mero Stream captures with
`getUserMedia` inside the webview**, whereas Mero Meet does native WebRTC in the
Rust backend and never asked the webview for camera access. So the desktop needs
camera permission wiring that Meet did not.

- **1a. Webview camera permission.**
  - macOS: add `NSCameraUsageDescription` to the app's `Info.plist` /
    `tauri.conf.json` bundle config, and ensure the entitlement is present.
  - Tauri v1 webview (WKWebView on macOS): confirm `getUserMedia` is permitted
    for the app origin; wire the media-permission delegate to auto-grant for the
    trusted app window (WKWebView otherwise silently denies camera).
  - Acceptance: `getUserMedia({video:true})` resolves inside the Mero Stream
    WebviewWindow without a hang/deny.
- **1b. App launch + SSO hash.** Confirm the generic `openAppFrontend` path opens
  Mero Stream by its registry `metadata.links.frontend` and forwards the same
  hash Meet gets (`node_url, access_token, refresh_token, app-id, context_id,
  executor_public_key, expires_at, dev_mode`). If the launcher is fully generic,
  this is a no-op; if there's any per-app allowlist, add `com.calimero.merostream`.
  - Acceptance: opening the app from the desktop lands authenticated on `/stream`
    with a context, not the landing page.
- **1c. (optional) Dev-mode.** `dev_mode=1` in the hash already surfaces the
  diagnostics; no change unless we want a dedicated toggle.

> Scope note: no Rust media bridge is needed here (that's Meet's model). This is
> purely permission + launch plumbing.

---

## 2. `core` — **[measure]**, needed for the deliverable, NOT for running

The contract runs on current `core` unchanged (`encode_frame` is an ordinary
mutation, `get_frame` an ordinary view; fragments already fit under the 1 MiB
delta / gossip caps). Core work is only about **capturing the §4 metrics** —
without it the app "works" but produces no failure curve.

Instrumentation to expose (log markers and/or metrics endpoint), per §4:

- **2a. Per-mutation WASM execution time** — wall-time around the wasmer call for
  a mutation, tagged by method, so `encode_frame` CPU cost is isolatable. *(This
  is the Task-3-specific number nobody has.)*
- **2b. Sealed delta size per mutation** — bytes of the state delta before
  gossip; needed to chart the size knee vs. the 1 MiB cap (C2).
- **2c. Gossip drop / backpressure counters** — where fan-out saturates across K
  peers.
- **2d. RocksDB on-disk growth over time** — sampled store size, to watch the
  tombstone-accumulation slope (C3) over a sustained run, plus delta-apply
  latency at minute 1 vs minute 30.

Acceptance: a 30–60 min sustained run emits enough signal (logs or a metrics
scrape) to produce the load-curve CSV and name the first bottleneck. Prefer
reusing whatever perf counters core already has (see the core perf-audit work)
before adding new ones — audit first, add only the gaps.

> Decision needed: log-markers (cheap, greppable, good enough for a probe) vs. a
> proper metrics endpoint (reusable). Recommend log-markers first.

---

## 3. `merobox` + this repo's `workflows/e2e.yml` — **[measure]** (P2)

- **3a.** Bump the `merod` image pin in `workflows/e2e.yml` (currently
  `0.11.0-rc.9`, copied from Meet) to the current rc, matching the core the
  metrics land in.
- **3b.** Confirm the pinned merobox supports the array-valued `raw` arg and the
  `assert` statements used in the draft; adjust step syntax if not.
- **3c.** Once green locally, uncomment the `e2e` job in `.github/workflows/ci.yml`.
- **3d. (P3) Load generator** (lives here, `scripts/`): drive `encode_frame` at
  rising fps/geometry until a metric breaks; emit CSV. No merobox change, but
  depends on §2 for the numbers.

---

## 4. `app-registry` / apps.calimero.network — **[dist]**, only for distribution

Not needed for local or dev-harness testing.

- **4a.** Register the `com.calimero.merostream` package and publish the first
  signed `.mpk` (`make logic-bundle` already produces it).
- **4b. (follow-up, in THIS repo)** Add a registry auto-publish CI job +
  `MERO_SIGN_KEY` / `CALIMERO_REGISTRY_API_KEY` secrets, mirroring the mero
  apps' publish workflow. Gate it appropriately given this is an experimental,
  possibly-private probe.

---

## 5. Explicitly NOT changing

- **`mero-js` / `mero-react`** — `useExecute` / `useSubscription` cover the app
  as-is. A binary/base64 arg path for `raw` (instead of JSON `number[]`) is a
  *possible future optimization* only if we push frames far larger than 64×48
  into RPC-payload territory; out of scope for the probe.

---

## Suggested sequence

1. **P2 locally** (this repo only): validate the 2-node fragment round-trip via
   the dev harness / `merobox` — no tauri/core changes.
2. **core §2 instrumentation** — the deliverable depends on it; do it before P3.
3. **P3 load curve** → results write-up (the definition of done).
4. **tauri §1** — only when we want the probe running in the real desktop shell
   (nice-to-have for the probe; the dev harness suffices to get the numbers).
5. **registry §4** — only if/when we distribute it.
