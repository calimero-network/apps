# Cross-repo plan — making streaming-over-Calimero actually run

Mero Stream's **app side is self-contained and done** (P0 contract + tests, P1
frontend dev route, P2 2-node e2e, P3 tooling). This document is the PLAN for the
changes needed in *other* repos to (a) run the app end-to-end and (b) capture the
measurements that are the real deliverable.

**Status 2026-08-03:** §2 (core) has been audited against `master` @ rc.19 and
mostly already exists — see the rewritten section below. §3 (merobox/e2e) is
**done**. §1 (tauri) and §4 (registry) remain untouched and remain optional for
the deliverable.

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

**AUDITED against core `master` @ rc.19 (2026-08-03).** The "audit first, add only
the gaps" instruction below has now been carried out, and most of this section was
already built. **The log-markers-vs-metrics-endpoint decision is moot: core has a
Prometheus registry and unconditionally mounts `/metrics`** (`crates/server/src/metrics.rs:142`).

Already available — no core change needed:

- **2a. Per-mutation execution time — EXISTS.**
  `context_runtime_execution_duration_seconds{context_id,method,status}`, observed
  at `crates/context/src/handlers/execute/mod.rs:912`. Labelled by method, so
  `encode_frame` is isolatable. Two caveats: it wraps all of `internal_execute`
  (wasm + storage commit + seal), so it is mutation wall time rather than pure
  WASM CPU; and see the gap below.
- **2b. Sealed delta size — EXISTS as a log marker.** `artifact_len` is logged
  with the method at `execute/mod.rs:971` and `:1987`. Run the node at `debug`
  and grep. No histogram, but sufficient for a probe.
- **2d. Delta-apply latency drift — EXISTS.** `crates/node/src/delta_store.rs:509`
  and `:640` log per-apply `wasm_ms` / `total_ms`; metrics `delta_outcomes_total`,
  `delta_cascade_size`, `dag_heads_count`, `delta_missing_parents_total` cover
  apply health.

Actual remaining gaps. **Verified by scraping a live rc.19 node, not by reading
code** — an earlier revision of this section overstated the first one:

- **2a′. Percentiles, not the mean.** The histogram's buckets are
  `exponential_buckets(1.0, 2.0, 10)` (`crates/governance-store/src/metrics.rs:154`)
  → 1 s … 512 s, so every observation lands in the first bucket and the bucket
  series is useless. **But `_sum` and `_count` are exported**, so
  `sum/count` gives the exact mean per method today — measured at 9.93 ms for
  `encode_frame` over 60 calls at 64×48. What is missing is tail shape (p95/p99),
  not the number itself. Downgrades "the one core PR worth filing" to a
  nice-to-have.
- **2c. Gossip publish drops / backpressure — MISSING, and confirmed on a live
  node.** The only gossipsub series core exposes is
  `libp2p_gossipsub_messages_total` (a *received* count) — that is the whole of
  `libp2p-metrics`' gossipsub module, one counter. Core *does* feed libp2p's
  recorder (`crates/network/src/handlers/stream/swarm/gossipsub.rs:10`), so the
  gap is not a missing `record()` call. The rich suite —
  `publish_messages_dropped_per_topic`, `forward_messages_dropped_per_topic`,
  `timedout_messages_dropped_per_topic`, `priority_queue_size` /
  `non_priority_queue_size` (backpressure, directly), `topic_msg_sent_bytes`,
  `mesh_peer_counts` — lives in `libp2p-gossipsub`'s own metrics behind
  `Behaviour::with_metrics(registry, config)`. Core builds the behaviour with
  plain `gossipsub::Behaviour::new(` (`crates/network/src/behaviour.rs:258`).
  Note the `libp2p` meta-crate's `gossipsub` feature enables
  `libp2p-metrics?/gossipsub` but **nothing enables `libp2p-gossipsub/metrics`**,
  so this needs a feature/dep change too, not just a builder call.
- **2d′. RocksDB on-disk size — MISSING as a metric.** Core's only process gauges
  are `#[cfg(target_os = "linux")]` RSS/threads/FDs. **Worked around in this
  repo**: `scripts/load-curve.py` samples it with `docker exec … du -sb`, so the
  C3 tombstone slope is measurable today without touching core.

Acceptance: a 30–60 min sustained run emits enough signal to produce the
load-curve CSV and name the first bottleneck. **Reachable now, with no core
change.** The two gaps above sharpen attribution (which part of the 10 ms, and
whether a missing frame was dropped by gossip or never sent); neither blocks the
deliverable.

> **Why no core PR has been filed yet.** Both gaps are instrumentation for
> questions the run has not yet asked. More decisively: a core change only reaches
> this probe via a tagged release and a published merod image, so it cannot serve
> the run that is the actual deliverable. The sequence that makes sense is run
> first, then file a targeted core PR *if* the run points at gossip or needs the
> latency tail — instrumentation aimed at a real finding rather than a speculative
> one.

---

## 3. `merobox` + this repo's `workflows/e2e.yml` — **[measure]** (P2)

- **3a. ✅ DONE.** Image pinned to `0.11.0-rc.19`, matching `logic/Cargo.toml`.
- **3b. ✅ DONE — no merobox change needed**, but three syntax traps were found
  and worked around, worth recording:
  - The `call` step returns the **raw JSON-RPC envelope** (`{id, jsonrpc, result}`),
    so a scalar return is extracted with the dotted path `result.output`, not
    `output`. `outputs: x: output` silently warns "Export failed" and leaves the
    placeholder **unresolved**, which then reaches the contract as the literal
    string `"{{x}}"` and panics the guest on deserialization.
  - `assert`'s `contains(...)` / `regex(...)` split their arguments on **every**
    comma, so no comma-bearing literal (i.e. any pixel array) can be asserted.
    `json_assert`'s `json_subset` splits only on the first comma but does not
    recurse into dicts nested inside a list. Hence `frame_checksum`: a scalar the
    DSL can compare.
  - `is_set` guards before comparing two checksums are load-bearing — the
    operator comparison stringifies, so `null == null` passes.
- **3c. ✅ DONE.** The `e2e` job is enabled in `.github/workflows/ci.yml`, with
  node-log artifact upload on failure and a merobox floor of `>=0.6.49`.
- **3d. (P3) Load generator — ✅ BUILT** (`scripts/load-curve.py`, stdlib only).
  Ramps geometry × fps, stops on a named break condition, emits the CSV. Covers
  sender RTT, achieved fps, error rate, live/pruned fragments, peer-side counters
  and RocksDB growth — i.e. it does **not** depend on the §2 core work except for
  isolated WASM CPU. Smoke-tested against two rc.19 nodes.

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
