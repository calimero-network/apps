// call-e2e.mjs — a REAL two-peer video call on one machine, asserted.
//
// Drives peer A (node1) and peer B (node2) in two isolated Playwright browser
// contexts with fake cameras, and asserts actual video frames flow — then
// exercises the full lifecycle that has historically broken: leave → rejoin in
// BOTH directions, and everyone-leaves → the call must die.
//
// This is the automated twin of `make dev-call` (which opens the same two
// peers in visible Chrome windows for eyeballing). Run it via:
//
//   make dev-nodes    # two local nodes + room (once)
//   make dev          # vite (separate terminal)  — or any port via DEV_VITE_PORT
//   make dev-e2e      # ← this script
//
// URL_A / URL_B (the desktop-style SSO URLs) are injected by scripts/dev-e2e.sh.
// Artifacts (screenshots, per-peer console + in-call diagnostics) land in
// OUT_DIR on failure.
import { chromium } from "playwright";
import fs from "node:fs";

const URL_A = process.env.URL_A;
const URL_B = process.env.URL_B;
const OUT = process.env.OUT_DIR || "/tmp/meet-dev-e2e";
if (!URL_A || !URL_B) {
  console.error("URL_A / URL_B missing — run via `make dev-e2e` (scripts/dev-e2e.sh)");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

/** Count <video> elements that are actually PLAYING frames (not just mounted). */
async function liveVideoCount(page) {
  return page.evaluate(async () => {
    const vids = [...document.querySelectorAll("video")];
    const t0 = vids.map((v) => v.currentTime);
    await new Promise((r) => setTimeout(r, 700));
    return vids.filter(
      (v, i) => v.videoWidth > 0 && v.readyState >= 2 && v.currentTime > t0[i],
    ).length;
  });
}

async function waitForLiveVideos(page, want, timeoutMs, label) {
  const t0 = Date.now();
  let n = -1;
  while (Date.now() - t0 < timeoutMs) {
    n = await liveVideoCount(page);
    if (n >= want) {
      log(`  ${label}: ${n} live video(s) after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`${label}: wanted ${want} live videos, saw ${n} after ${timeoutMs / 1000}s`);
}

/** Open the in-call diagnostics (⚙) and dump the page text + a screenshot. */
async function dumpDiagnostics(page, label) {
  try {
    const gear = page.locator('button[title="Call diagnostics"]');
    if (await gear.count()) {
      await gear.first().click();
      await page.waitForTimeout(300);
    }
    fs.writeFileSync(`${OUT}/diag-${label}.txt`, await page.evaluate(() => document.body.innerText));
    await page.screenshot({ path: `${OUT}/shot-${label}.png` });
  } catch (e) {
    log(`  (diag dump ${label} failed: ${e.message})`);
  }
}

async function enterRoomAndCall(page, name, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[placeholder="Your name (required)"]', { timeout: 30000 });
  await page.fill('input[placeholder="Your name (required)"]', name);
  // The header button reads "Start call" or "Join call" depending on state.
  await page.click("header button:has-text('call')");
  await page.waitForURL("**/call", { timeout: 15000 });
}

async function leaveCall(page) {
  await page.click('button[aria-label="Leave call"]');
  await page.waitForSelector('header button:has-text("call")', { timeout: 15000 });
}

async function rejoin(page) {
  await page.click("header button:has-text('call')");
  await page.waitForURL("**/call", { timeout: 15000 });
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const mkPeer = async (label) => {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  const consoleLog = fs.createWriteStream(`${OUT}/console-${label}.txt`);
  page.on("console", (m) => consoleLog.write(`[${m.type()}] ${m.text()}\n`));
  page.on("pageerror", (e) => consoleLog.write(`[pageerror] ${e.message}\n`));
  return page;
};
const a = await mkPeer("A");
const b = await mkPeer("B");

try {
  log("PHASE 1 — both join, media must flow both ways");
  await enterRoomAndCall(a, "Ana", URL_A);
  await enterRoomAndCall(b, "Bob", URL_B);
  await waitForLiveVideos(a, 2, 90000, "Ana (local+remote)");
  await waitForLiveVideos(b, 2, 90000, "Bob (local+remote)");
  log("PHASE 1 OK ✅");

  log("PHASE 2 — Bob leaves; Ana's remote tile must go away");
  await leaveCall(b);
  const t0 = Date.now();
  while ((await liveVideoCount(a)) > 1) {
    if (Date.now() - t0 > 60000) throw new Error("Ana still shows Bob 60s after he left");
    await a.waitForTimeout(2000);
  }
  log(`  Ana back to 1 tile after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log("PHASE 2 OK ✅");

  log("PHASE 3 — Bob REJOINS (the historically broken path)");
  await rejoin(b);
  await waitForLiveVideos(b, 2, 90000, "Bob after rejoin");
  await waitForLiveVideos(a, 2, 90000, "Ana after Bob rejoined");
  log("PHASE 3 OK ✅");

  log("PHASE 4 — Ana leaves and rejoins (other direction)");
  await leaveCall(a);
  const t1 = Date.now();
  while ((await liveVideoCount(b)) > 1) {
    if (Date.now() - t1 > 60000) throw new Error("Bob still shows Ana 60s after she left");
    await b.waitForTimeout(2000);
  }
  log(`  Bob back to 1 tile after ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  await rejoin(a);
  await waitForLiveVideos(a, 2, 90000, "Ana after rejoin");
  await waitForLiveVideos(b, 2, 90000, "Bob after Ana rejoined");
  log("PHASE 4 OK ✅");

  log("PHASE 5 — both leave; room must fall back to 'Start call' (dead call killed)");
  await leaveCall(a);
  await leaveCall(b);
  await a.waitForTimeout(4000);
  const btnA = (await a.textContent("header button:has-text('call')"))?.trim();
  const btnB = (await b.textContent("header button:has-text('call')"))?.trim();
  if (!/start call/i.test(btnA || "") || !/start call/i.test(btnB || "")) {
    throw new Error(`expected 'Start call' on both after everyone left, got A='${btnA}' B='${btnB}'`);
  }
  log("PHASE 5 OK ✅");

  log("ALL PHASES PASSED 🎉");
} catch (e) {
  log(`FAILED: ${e.message}`);
  await dumpDiagnostics(a, "A-fail");
  await dumpDiagnostics(b, "B-fail");
  log(`artifacts (screenshots, consoles, in-call logs): ${OUT}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
