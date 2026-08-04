#!/usr/bin/env node
/**
 * app/e2e/browser-call.mjs — drive the two-node /live call in real Chrome.
 *
 * WHY THIS LIVES UNDER app/ AND NOT scripts/: node resolves an ESM bare import
 * from the importing FILE's directory, not the cwd. `playwright` is a devDep of
 * the `app` package, so a copy of this file in scripts/ dies on
 * ERR_MODULE_NOT_FOUND no matter which directory you launch it from.
 *
 * This closes the one gap the merobox e2e deliberately cannot reach. Those
 * scenarios use payloads that are NOT valid H.264, because the whole approach-2
 * claim is that the app never interprets the bytes, and a scenario built on real
 * access units would hide a regression where we started parsing them. So CI
 * proves everything BETWEEN capture and render byte-identically on two real
 * nodes, and the codec ends — the actual browser encode and decode — were never
 * exercised. This script exercises them.
 *
 * What it asserts, in order of what would actually be broken:
 *
 *   1. Both pages authenticate off the URL hash and join the context.
 *   2. WebCodecs H.264 is really available (not the "use Chrome" fallback).
 *   3. The SENDER encodes: chunks posted climbs, no post errors.
 *   4. State CROSSES NODES: the receiver's own node reports live chunks. This is
 *      the Calimero claim — node2 reads it from node2, not from node1's API.
 *   5. The RECEIVER decodes real video: its canvas has non-uniform pixels AND
 *      those pixels CHANGE between samples. A still frame or a blank canvas both
 *      fail. This is the assertion that a byte-level e2e can't make.
 *   6. The reaper stays keyframe-clamped: oldest live chunk never runs past last
 *      keyframe seq, so the window can't strand an undecodable delta.
 *
 * WHY REAL CHROME, NOT PLAYWRIGHT'S CHROMIUM: Playwright ships open-source
 * Chromium, which has no proprietary codecs — H.264 encode/decode is simply
 * absent and the page would take its "no VideoEncoder" branch. `channel: "chrome"`
 * uses the installed Google Chrome, which has them. This is not a preference; the
 * test cannot pass on bundled Chromium.
 *
 * A NOTE ON SECURE CONTEXTS, because the failure is very misleading: WebCodecs
 * (`VideoEncoder` / `VideoDecoder`) and `navigator.mediaDevices` are undefined
 * outside a secure context. Probing them on `about:blank` reports "this browser
 * has no WebCodecs" even in a Chrome that fully supports them. `http://localhost`
 * IS treated as trustworthy, so everything works once the page has navigated —
 * but never assert codec support before `goto`.
 *
 * Usage (from app/, so `playwright` resolves):
 *   node e2e/browser-call.mjs                 # headed (default)
 *   HEADLESS=1 node e2e/browser-call.mjs
 *   CALL_SECONDS=30 node e2e/browser-call.mjs
 *   node e2e/browser-call.mjs --urls /tmp/mero-stream-dev-urls.txt
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const URLS_FILE = argOf("--urls") ?? "/tmp/mero-stream-dev-urls.txt";
const ARTIFACTS = resolve(REPO, "data/browser-call");
const HEADLESS = process.env.HEADLESS === "1";
const CALL_SECONDS = Number(process.env.CALL_SECONDS ?? 20);
const FPS = Number(process.env.CALL_FPS ?? 15);

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const c = {
  step: (m) => console.log(`\n\x1b[1;36m▶  ${m}\x1b[0m`),
  ok: (m) => console.log(`\x1b[32m  ✓  ${m}\x1b[0m`),
  warn: (m) => console.log(`\x1b[33m  !  ${m}\x1b[0m`),
  bad: (m) => console.error(`\x1b[31m  ✗  ${m}\x1b[0m`),
  info: (m) => console.log(`     ${m}`),
};

const failures = [];
function check(condition, message) {
  if (condition) c.ok(message);
  else {
    failures.push(message);
    c.bad(message);
  }
  return condition;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a Metric's raw numeric value via its data-value attribute. */
async function metric(page, testId) {
  const el = page.locator(`[data-testid="${testId}"]`);
  if ((await el.count()) === 0) return null;
  const raw = await el.first().getAttribute("data-value");
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Poll until predicate(value) or timeout. Returns the last value seen. */
async function waitForMetric(page, testId, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await metric(page, testId);
    if (last !== null && predicate(last)) return last;
    // The page refreshes stats on a 1s interval, so polling faster than that
    // just burns CDP round-trips.
    await sleep(500);
  }
  return last;
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });

  // ── URLs ───────────────────────────────────────────────────────────────────
  let urls;
  try {
    urls = readFileSync(URLS_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
  } catch {
    c.bad(`cannot read ${URLS_FILE} — run scripts/dev-invite.sh first`);
    process.exit(1);
  }
  if (urls.length < 2) {
    c.bad(`expected 2 URLs in ${URLS_FILE}, found ${urls.length}`);
    process.exit(1);
  }
  const [senderUrl, receiverUrl] = urls;
  c.ok(
    `sender   node: ${new URL(senderUrl).hash.match(/node_url=([^&]+)/)?.[1]}`,
  );
  c.ok(
    `receiver node: ${new URL(receiverUrl).hash.match(/node_url=([^&]+)/)?.[1]}`,
  );

  // ── Browser ────────────────────────────────────────────────────────────────
  c.step(`Launching Google Chrome (${HEADLESS ? "headless" : "headed"})`);
  let browser;
  try {
    browser = await chromium.launch({
      channel: "chrome", // real Chrome: has H.264. Bundled Chromium does not.
      headless: HEADLESS,
      args: [
        // Synthetic camera: a moving pattern, so "did the picture change" is a
        // meaningful assertion without a physical webcam attached.
        "--use-fake-device-for-media-stream",
        // Auto-accept the camera prompt. grantPermissions below covers the
        // Permissions API; this covers the infobar Chrome shows regardless.
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
  } catch (e) {
    c.bad(`could not launch Chrome via channel:"chrome" — ${e.message}`);
    c.info(
      "Install Google Chrome. Playwright's bundled Chromium has no H.264,",
    );
    c.info("so it cannot run this test.");
    process.exit(1);
  }

  // Separate contexts, not just tabs: each page carries a different node URL,
  // token and identity in its hash, and shares localStorage keys with the other.
  const mk = async (name, url) => {
    const ctx = await browser.newContext({
      permissions: ["camera"],
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    const logs = [];
    page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { name, ctx, page, logs };
  };

  const sender = await mk("sender", senderUrl);
  const receiver = await mk("receiver", receiverUrl);

  try {
    // ── 0. Is this even the right app? ───────────────────────────────────────
    // Cheap, and it turns the single most confusing failure into a one-line
    // diagnosis. A stale dev server for a DIFFERENT Calimero app on the same port
    // renders a plausible-looking page, and every subsequent assertion then fails
    // on a missing selector — which reads like an app bug and is not one.
    c.step("Confirming the page is Mero Stream's /live route");
    for (const p of [sender, receiver]) {
      const title = await p.page.title();
      if (
        !check(
          title === "Mero Stream",
          `${p.name} served "Mero Stream" (got "${title}")`,
        )
      ) {
        throw new Error(
          `${p.name} is talking to a different app on this port — check VITE_PORT`,
        );
      }
      const onLive = await p.page
        .locator('[data-testid="capture-toggle"]')
        .count();
      check(onLive > 0, `${p.name} rendered the /live route`);
    }

    // ── 1. Join ──────────────────────────────────────────────────────────────
    c.step("Waiting for both peers to join the context");
    for (const p of [sender, receiver]) {
      const joined = p.page.locator('[data-testid="join-state"]');
      try {
        await joined.filter({ hasText: "joined" }).waitFor({ timeout: 45_000 });
        c.ok(`${p.name} joined`);
      } catch {
        check(false, `${p.name} never joined the context`);
      }
    }

    // ── 2. WebCodecs really present ──────────────────────────────────────────
    c.step("Checking WebCodecs H.264 support");
    for (const p of [sender, receiver]) {
      const unsupported = await p.page
        .locator('[data-testid="unsupported"]')
        .count();
      check(unsupported === 0, `${p.name} has WebCodecs VideoEncoder`);
    }
    // Ask the browser directly too — the page's own check is coarser than this.
    const encodeSupported = await sender.page.evaluate(async () => {
      if (!("VideoEncoder" in window))
        return { supported: false, reason: "no VideoEncoder" };
      const cfg = {
        codec: "avc1.42001f",
        width: 640,
        height: 480,
        bitrate: 1_500_000,
        framerate: 15,
        avc: { format: "annexb" },
      };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        return { supported: !!r.supported, reason: "" };
      } catch (e) {
        return { supported: false, reason: String(e) };
      }
    });
    check(
      encodeSupported.supported,
      `H.264 annex-B 640x480 encode config supported ${encodeSupported.reason}`,
    );

    // ── 3. Sender encodes ────────────────────────────────────────────────────
    c.step(`Starting capture on the sender at ${FPS} fps`);
    // Set fps via the range input so the run is reproducible regardless of the
    // component's default.
    const fpsSlider = sender.page.locator('input[type="range"]').first();
    if ((await fpsSlider.count()) > 0) await fpsSlider.fill(String(FPS));

    const toggle = sender.page.locator('[data-testid="capture-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: 15_000 });
    // Playwright waits for the button to be enabled (it is disabled until the
    // join lands), so no separate join gate is needed here.
    await toggle.click();
    // Then WAIT for the flag rather than reading it immediately. `data-running`
    // is driven by React state, so it updates on the next render, not
    // synchronously with the click — reading it inline is a race that passes on a
    // fast machine and fails on a loaded one.
    let running = false;
    for (let i = 0; i < 40 && !running; i++) {
      running = (await toggle.getAttribute("data-running")) === "true";
      if (!running) await sleep(250);
    }
    check(running, "capture is running on the sender");

    const posted = await waitForMetric(
      sender.page,
      "chunks-posted",
      (v) => v > 0,
      45_000,
    );
    check((posted ?? 0) > 0, `sender posted chunks (nextChunkSeq=${posted})`);

    // ── 4. State crosses nodes ───────────────────────────────────────────────
    c.step("Waiting for chunks to replicate to the receiver's own node");
    const rxLive = await waitForMetric(
      receiver.page,
      "live-chunks",
      (v) => v > 0,
      60_000,
    );
    check(
      (rxLive ?? 0) > 0,
      `receiver's node holds replicated chunks (liveChunks=${rxLive})`,
    );

    // ── 5. Receiver decodes REAL video ───────────────────────────────────────
    c.step("Verifying the receiver decodes actual pixels");
    const decodeRate = await waitForMetric(
      receiver.page,
      "decode-rate",
      (v) => v > 0,
      45_000,
    );
    check((decodeRate ?? 0) > 0, `receiver decode rate ${decodeRate}/s`);

    // Sample the canvas twice. Blank OR frozen both fail: a stream that
    // replicates happily and shows nothing is the exact failure mode the
    // keyframe clamp exists to prevent, and it looks healthy from every other
    // angle.
    const sampleCanvas = () =>
      receiver.page.evaluate(() => {
        const cv = document.querySelector('[data-testid="remote-canvas"]');
        if (!(cv instanceof HTMLCanvasElement)) return null;
        if (!cv.width || !cv.height)
          return { blank: true, w: cv.width, h: cv.height };
        const ctx = cv.getContext("2d");
        if (!ctx) return null;
        const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
        // Cheap signature + variance over a stride, enough to tell "real
        // picture" from "flat fill" without shipping the whole frame out.
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        let sig = 0;
        for (let i = 0; i < data.length; i += 4 * 97) {
          const v = data[i];
          sum += v;
          sumSq += v * v;
          sig = (sig * 31 + v) % 2147483647;
          n++;
        }
        const mean = sum / n;
        return {
          blank: false,
          w: cv.width,
          h: cv.height,
          variance: sumSq / n - mean * mean,
          sig,
        };
      });

    // POLL for the first real frame rather than sampling once. A positive decode
    // rate means chunks were pulled and pushed into the decoder, NOT that a frame
    // has been painted yet — VideoDecoder output is async and the canvas can still
    // be 0x0 for a moment. A one-shot sample here is a race.
    let first = null;
    const paintDeadline = Date.now() + 30_000;
    while (Date.now() < paintDeadline) {
      first = await sampleCanvas();
      if (first && !first.blank && first.variance > 5) break;
      await sleep(500);
    }

    check(
      first && !first.blank,
      `remote canvas has dimensions ${first?.w}x${first?.h}`,
    );
    check(
      (first?.variance ?? 0) > 5,
      `decoded frame is a real picture, not a flat fill (variance ${first?.variance?.toFixed(1)})`,
    );
    check(
      first?.w === 640 && first?.h === 480,
      `decoded at 640x480 (got ${first?.w}x${first?.h})`,
    );

    // Then confirm it MOVES. Poll for a differing signature instead of comparing a
    // single pair: at low fps two samples can legitimately land on the same
    // decoded frame, which would fail a strict one-shot comparison for no reason.
    let second = null;
    let moved = false;
    const moveDeadline = Date.now() + 15_000;
    while (Date.now() < moveDeadline && !moved) {
      await sleep(500);
      second = await sampleCanvas();
      moved = !!(first && second && first.sig !== second.sig);
    }
    check(
      moved,
      "decoded picture advances between samples (video, not a stuck frame)",
    );

    // ── 6. Sustain, then read the numbers ────────────────────────────────────
    //
    // Reset both probes first, so the reported figures describe STEADY STATE.
    // Without this they include the startup transient, and that transient is
    // wildly misleading: the receiver's first drain pulls a backlog of chunks and
    // stamps `renderedAt` on all of them within a few milliseconds, so the
    // observed span is tiny and the decode rate reads in the thousands per second
    // (7000/s was observed) while those same frames report an under-stated
    // latency. Measuring after a reset is the honest window.
    for (const p of [sender, receiver]) {
      const reset = p.page.locator('[data-testid="reset-probe"]');
      if ((await reset.count()) > 0) await reset.click();
    }
    c.step(`Sustaining the call for ${CALL_SECONDS}s (measuring steady state)`);
    await sleep(CALL_SECONDS * 1000);

    const read = async (p, ids) => {
      const out = {};
      for (const id of ids) out[id] = await metric(p.page, id);
      return out;
    };
    const txStats = await read(sender, [
      "chunks-posted",
      "live-chunks",
      "live-bytes-kib",
      "pruned-chunks",
      "last-keyframe-seq",
      "oldest-live-chunk",
      "post-rate",
      "ingest-kib-s",
      "compression-ratio",
      "post-rtt-p50",
      "post-errors",
    ]);
    const rxStats = await read(receiver, [
      "live-chunks",
      "decode-rate",
      "latency-p50",
      "latency-p95",
      "seq-gaps",
      "last-keyframe-seq",
      "oldest-live-chunk",
    ]);

    check(
      (txStats["post-errors"] ?? 0) === 0,
      `no post errors (${txStats["post-errors"]})`,
    );
    check(
      (txStats["post-rate"] ?? 0) > 0,
      `sustained post rate ${txStats["post-rate"]}/s`,
    );
    check(
      (rxStats["decode-rate"] ?? 0) > 0,
      `sustained decode rate ${rxStats["decode-rate"]}/s`,
    );

    // The keyframe clamp, observed rather than unit-tested: the oldest retained
    // chunk must never be newer than the last keyframe, or the window has
    // stranded a delta with no reference.
    for (const [name, s] of [
      ["sender", txStats],
      ["receiver", rxStats],
    ]) {
      const oldest = s["oldest-live-chunk"];
      const kf = s["last-keyframe-seq"];
      if (oldest !== null && kf !== null) {
        check(
          oldest <= kf,
          `${name} reaper stayed keyframe-clamped (oldest=${oldest} <= keyframe=${kf})`,
        );
      } else {
        c.warn(
          `${name}: no prune yet, clamp not exercised (oldest=${oldest}, kf=${kf})`,
        );
      }
    }

    // ── Report ───────────────────────────────────────────────────────────────
    c.step("Measurements");
    const table = {
      "sender: chunks posted": txStats["chunks-posted"],
      "sender: post rate /s": txStats["post-rate"],
      "sender: ingest KiB/s": txStats["ingest-kib-s"],
      "sender: compression x": txStats["compression-ratio"],
      "sender: post RTT p50 ms": txStats["post-rtt-p50"],
      "sender: live bytes KiB": txStats["live-bytes-kib"],
      "sender: pruned (tombstones)": txStats["pruned-chunks"],
      "receiver: live chunks": rxStats["live-chunks"],
      "receiver: decode rate /s": rxStats["decode-rate"],
      "receiver: latency p50 ms": rxStats["latency-p50"],
      "receiver: latency p95 ms": rxStats["latency-p95"],
      "receiver: seq gaps": rxStats["seq-gaps"],
    };
    for (const [k, v] of Object.entries(table))
      c.info(`${k.padEnd(30)} ${v ?? "—"}`);
    c.warn(
      "latency spans two clocks (sender createdAt -> receiver render); only",
    );
    c.warn("meaningful because both nodes share this host's clock.");

    await sender.page.screenshot({ path: `${ARTIFACTS}/sender.png` });
    await receiver.page.screenshot({ path: `${ARTIFACTS}/receiver.png` });
    writeFileSync(
      `${ARTIFACTS}/result.json`,
      JSON.stringify(
        {
          ok: failures.length === 0,
          failures,
          sender: txStats,
          receiver: rxStats,
        },
        null,
        2,
      ),
    );
    c.ok(`artifacts in data/browser-call/`);
  } finally {
    for (const p of [sender, receiver]) {
      if (p.logs.length) {
        writeFileSync(`${ARTIFACTS}/${p.name}-console.log`, p.logs.join("\n"));
      }
    }
    if (failures.length) {
      await sender.page
        .screenshot({ path: `${ARTIFACTS}/sender-failure.png` })
        .catch(() => {});
      await receiver.page
        .screenshot({ path: `${ARTIFACTS}/receiver-failure.png` })
        .catch(() => {});
    }
    await browser.close();
  }

  if (failures.length) {
    c.step(`FAILED — ${failures.length} check(s)`);
    for (const f of failures) c.bad(f);
    process.exit(1);
  }
  c.step("PASSED — 480p H.264 encoded in one browser, replicated through");
  c.ok("Calimero, and decoded in another, on two separate nodes.");
}

main().catch((e) => {
  c.bad(e.stack ?? String(e));
  process.exit(1);
});
