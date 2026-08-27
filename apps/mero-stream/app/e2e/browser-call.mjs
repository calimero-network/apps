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
 *   3. BOTH peers publish: post rate climbs, no publish errors.
 *   4. EACH peer decodes the OTHER's real video: exactly one remote tile, 640x480,
 *      non-uniform pixels that CHANGE between samples. Blank and frozen both fail.
 *      Running this for BOTH sides is what catches a single-shared-decoder
 *      implementation, which looks perfectly correct with one sender.
 *   5. THE DAG STAYS EMPTY while all of that is true. This replaced an assertion
 *      that replicated chunks CROSSED NODES, and the swap is the point: media now
 *      rides ephemeral presence, so `liveChunks` climbing would mean the call had
 *      fallen back to writing every access unit into replicated state. Asserting
 *      zero here is strictly stronger than asserting non-zero was — a broken
 *      transport cannot satisfy "pictures move AND nothing was written".
 *   6. Broadcaster slots read 2/4 with two people live, and neither peer yielded.
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
// From @playwright/test, not the raw `playwright` package. Two copies at
// different versions makes the test runner fail with "Playwright Test did not
// expect test.describe() to be called here" — the catalog pins @playwright/test
// and this file pinned playwright itself, so a catalog bump desynced them.
// @playwright/test re-exports chromium, so one dependency covers both uses.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const URLS_FILE = argOf("--urls") ?? "/tmp/mero-stream-dev-urls.txt";
const ARTIFACTS = resolve(REPO, "data/browser-call");
const HEADLESS = process.env.HEADLESS === "1";
const CALL_SECONDS = Number(process.env.CALL_SECONDS ?? 20);

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

  // Both are senders AND receivers — this is a two-way call. The variable names are
  // kept for continuity; the labels say peerA/peerB so output is not misleading.
  const sender = await mk("peerA", senderUrl);
  const receiver = await mk("peerB", receiverUrl);

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
      // Gate on the ATTRIBUTE, not the rendered text. The text is a participant
      // count now ("2 here"), and matching prose is how an e2e breaks on a
      // copy edit.
      const joined = p.page.locator(
        '[data-testid="join-state"][data-joined="true"]',
      );
      try {
        await joined.waitFor({ timeout: 45_000 });
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

    // ── 3. BOTH peers encode ─────────────────────────────────────────────────
    // Two-way is the point. A one-sender test cannot catch the defect this suite
    // missed for weeks: the receive loop kept ONE decoder for ALL senders and
    // filtered only on `track`, never on `from`. Two senders are two independent
    // H.264 bitstreams, so interleaving them into a single decoder produces an
    // error or a smear — invisible until somebody actually starts both sides.
    c.step("Starting capture on BOTH peers at the shipped defaults");
    const startCapture = async (p) => {
      // No fps override any more. The slider moved into the data dialog, and the
      // shipped default (25 fps / 1.5 Mbps) is exactly the configuration whose
      // numbers we want — overriding it would measure something nobody runs.
      const toggle = p.page.locator('[data-testid="capture-toggle"]');
      await toggle.waitFor({ state: "visible", timeout: 15_000 });
      // Playwright waits for the button to be enabled (disabled until join lands).
      await toggle.click();
      // WAIT for the flag rather than reading it inline: `data-running` is React
      // state, so it lands on the next render, not synchronously with the click.
      for (let i = 0; i < 40; i++) {
        if ((await toggle.getAttribute("data-running")) === "true") return true;
        await sleep(250);
      }
      return false;
    };

    for (const p of [sender, receiver]) {
      check(await startCapture(p), `capture is running on ${p.name}`);
    }

    // Every measurement below lives in the "See more data" dialog, so open it
    // once here and leave it open. It is modal, which is why this happens AFTER
    // capture is running — the control bar behind it is inert.
    for (const p of [sender, receiver]) {
      await p.page.locator('[data-testid="details-toggle"]').click();
      await p.page
        .locator('[data-testid="data-dialog"]')
        .waitFor({ state: "visible", timeout: 10_000 });
    }

    const posted = await waitForMetric(
      sender.page,
      "post-rate",
      (v) => v > 0,
      45_000,
    );
    check((posted ?? 0) > 0, `sender is publishing frames (${posted}/s)`);

    // ── 4. EACH peer decodes the OTHER's real video ──────────────────────────
    c.step("Verifying BOTH peers decode actual pixels from each other");
    for (const p of [sender, receiver]) {
      const rate = await waitForMetric(
        p.page,
        "decode-rate",
        (v) => v > 0,
        45_000,
      );
      check((rate ?? 0) > 0, `${p.name} decode rate ${rate}/s`);

      // Exactly one remote tile each: two participants means one OTHER person.
      // A self-tile here would mean the receive loop is decoding our own stream,
      // which wastes a decoder and is a real regression (`from === me` is skipped).
      const tiles = await p.page.locator('[data-testid="peer-tile"]').count();
      check(
        tiles === 1,
        `${p.name} shows exactly 1 remote tile (got ${tiles})`,
      );
    }

    // Sample the canvas twice. Blank OR frozen both fail: a stream that
    // replicates happily and shows nothing is the exact failure mode the
    // keyframe clamp exists to prevent, and it looks healthy from every other
    // angle.
    const sampleCanvas = (p) =>
      p.page.evaluate(() => {
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
    //
    // Run it for BOTH peers: each must be decoding the other. Checking one side
    // only is what let a single-decoder implementation look correct.
    for (const p of [sender, receiver]) {
      let first = null;
      const paintDeadline = Date.now() + 30_000;
      while (Date.now() < paintDeadline) {
        first = await sampleCanvas(p);
        if (first && !first.blank && first.variance > 5) break;
        await sleep(500);
      }

      check(
        first && !first.blank,
        `${p.name}: remote canvas has dimensions ${first?.w}x${first?.h}`,
      );
      check(
        (first?.variance ?? 0) > 5,
        `${p.name}: real picture, not a flat fill (variance ${first?.variance?.toFixed(1)})`,
      );
      check(
        first?.w === 640 && first?.h === 480,
        `${p.name}: decoded at 640x480 (got ${first?.w}x${first?.h})`,
      );

      // Then confirm it MOVES. Poll for a differing signature rather than compare a
      // single pair: two samples can legitimately land on the same decoded frame.
      let moved = false;
      const moveDeadline = Date.now() + 15_000;
      while (Date.now() < moveDeadline && !moved) {
        await sleep(500);
        const second = await sampleCanvas(p);
        moved = !!(first && second && first.sig !== second.sig);
      }
      check(moved, `${p.name}: picture advances (video, not a stuck frame)`);
    }

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
      "live-chunks",
      "live-bytes-kib",
      "pruned-chunks",
      "post-rate",
      "ingest-kib-s",
      "compression-ratio",
      "publish-rtt",
      "duty-cycle",
      "slices-per-sec",
      "upstream-estimate",
      "post-errors",
    ]);
    const rxStats = await read(receiver, [
      "live-chunks",
      "decode-rate",
      "latency-p50",
      "latency-p95",
      "seq-gaps",
    ]);

    check(
      (txStats["post-errors"] ?? 0) === 0,
      `no publish errors (${txStats["post-errors"]})`,
    );
    check(
      (txStats["post-rate"] ?? 0) > 0,
      `sustained post rate ${txStats["post-rate"]}/s`,
    );
    check(
      (rxStats["decode-rate"] ?? 0) > 0,
      `sustained decode rate ${rxStats["decode-rate"]}/s`,
    );

    // ── 5. The DAG stayed empty ──────────────────────────────────────────────
    //
    // The load-bearing assertion of the whole transport, and it is only
    // meaningful BECAUSE the two checks above passed: pictures moved on both
    // sides while nothing was written to replicated state. Either half alone
    // proves nothing — zero chunks with a frozen tile is just a dead call.
    for (const [name, st] of [
      ["sender", txStats],
      ["receiver", rxStats],
    ]) {
      check(
        (st["live-chunks"] ?? 0) === 0,
        `${name}: nothing entered the DAG (liveChunks=${st["live-chunks"]})`,
      );
    }
    check(
      (txStats["pruned-chunks"] ?? 0) === 0,
      `no tombstones, because there was nothing to reap (pruned=${txStats["pruned-chunks"]})`,
    );

    // ── 6. Broadcaster slots ─────────────────────────────────────────────────
    for (const p of [sender, receiver]) {
      const pill = p.page.locator('[data-testid="slots-readout"]');
      const occupied = Number(await pill.getAttribute("data-occupied"));
      check(
        occupied === 2,
        `${p.name} sees 2 broadcasters in the 4 slots (got ${occupied})`,
      );
      const yielded = await p.page
        .locator('[data-testid="yielded-notice"]')
        .count();
      check(
        yielded === 0,
        `${p.name} did not yield its slot with only 2 of 4 taken`,
      );
    }

    // ── Report ───────────────────────────────────────────────────────────────
    c.step("Measurements");
    const table = {
      "sender: post rate /s": txStats["post-rate"],
      "sender: ingest KiB/s": txStats["ingest-kib-s"],
      "sender: compression x": txStats["compression-ratio"],
      "sender: publish RTT p50 ms": txStats["publish-rtt"],
      "sender: publishes needed /s": txStats["slices-per-sec"],
      "sender: send loop used %": txStats["duty-cycle"],
      "sender: est. upstream Mbps": txStats["upstream-estimate"],
      "sender: DAG live chunks": txStats["live-chunks"],
      "sender: DAG live bytes KiB": txStats["live-bytes-kib"],
      "sender: tombstones": txStats["pruned-chunks"],
      "receiver: decode rate /s": rxStats["decode-rate"],
      "receiver: latency p50 ms": rxStats["latency-p50"],
      "receiver: latency p95 ms": rxStats["latency-p95"],
      "receiver: seq gaps": rxStats["seq-gaps"],
      "receiver: DAG live chunks": rxStats["live-chunks"],
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
