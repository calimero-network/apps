#!/usr/bin/env node
/**
 * app/e2e/ui-invite-call.mjs — the whole two-person path DRIVEN THROUGH THE UI.
 *
 * The other two drivers each cover one half and leave the middle untested:
 *
 *   - `two-node-suite.mjs` proves namespace → invitation → join → room → context,
 *     but over raw HTTP. It says nothing about whether the app can do any of it.
 *   - `browser-call.mjs` proves the CALL, but navigates straight to `/live` with a
 *     pre-built context in the URL hash. A test that types `/live` cannot catch a
 *     picker that never gets you there.
 *
 * So the sequence a real second person actually performs — create a stream, make a
 * room in it, mint a code, paste that code on ANOTHER NODE, land in the call — had
 * no coverage at all. This drives exactly that, by clicking, and only then asserts
 * the two-way video.
 *
 * What it asserts, in the order things would break:
 *
 *   1. Creating a stream lands on that stream's ROOM LIST (namespace ≠ room).
 *   2. Creating a room lands in the call, joined, on the 480p route.
 *   3. Minting a room code produces ONE pasteable base58 token — no JSON, no
 *      whitespace, none of base64's `+/=`, which is the whole reason for the format.
 *   4. Pending state is VISIBLE while a multi-step flow runs: the button that was
 *      clicked reports `aria-busy`, and a named status line appears. Recorded with a
 *      MutationObserver installed BEFORE the click, because these are transient.
 *   5. Pasting that code on node2 joins the namespace AND the room AND the context,
 *      from one paste, and lands in the call.
 *   6. BOTH peers then see the other's real 640x480 picture, advancing. Each side is
 *      checked, because a single-decoder implementation looks perfect with one
 *      sender.
 *
 * Usage (from app/, so `playwright` resolves):
 *   node e2e/ui-invite-call.mjs
 *   HEADLESS=1 node e2e/ui-invite-call.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_FILE = resolve(REPO, "app/.env.dev-call");
const ARTIFACTS = resolve(REPO, "data/ui-invite-call");
const VITE_URL = process.env.VITE_URL ?? "http://127.0.0.1:5199";
const HEADLESS = process.env.HEADLESS === "1";
const CALL_SECONDS = Number(process.env.CALL_SECONDS ?? 12);
const STAMP =
  process.env.RUN_STAMP ?? String(process.hrtime.bigint() % 100000n);

const c = {
  step: (m) => console.log(`\n\x1b[1;36m▶  ${m}\x1b[0m`),
  ok: (m) => console.log(`\x1b[32m  ✓  ${m}\x1b[0m`),
  warn: (m) => console.log(`\x1b[33m  !  ${m}\x1b[0m`),
  bad: (m) => console.error(`\x1b[31m  ✗  ${m}\x1b[0m`),
  info: (m) => console.log(`     ${m}`),
};

const failures = [];
function check(cond, message) {
  if (cond) c.ok(message);
  else {
    failures.push(message);
    c.bad(message);
  }
  return cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── env ───────────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
for (const k of [
  "DEV_NODE_URL",
  "DEV_ACCESS_TOKEN",
  "DEV_NODE_URL_2",
  "DEV_ACCESS_TOKEN_2",
  "DEV_APP_ID",
]) {
  if (!env[k]) {
    c.bad(`${k} missing from ${ENV_FILE} — run scripts/dev-node*.sh first`);
    process.exit(1);
  }
}

/**
 * A session hash with NO `context_id`, deliberately: that is what makes the app
 * boot into the picker instead of straight into a call, which is the entire path
 * under test here.
 */
function sessionHash(nodeUrl, token, refresh, appId) {
  return (
    `#node_url=${nodeUrl}&access_token=${token}&refresh_token=${refresh}` +
    `&app-id=${appId}&dev_mode=1`
  );
}

/**
 * Record status/pending transitions from BEFORE a click until after it settles.
 * These flows are several round-trips long but can also finish quickly, so
 * sampling after the fact is a race — the observer catches every intermediate
 * state instead.
 */
async function watchStatuses(page) {
  await page.evaluate(() => {
    window.__seen = { statuses: [], busy: [] };
    const scan = () => {
      for (const el of document.querySelectorAll("[data-tone]")) {
        const entry = `${el.getAttribute("data-tone")}: ${el.textContent.trim()}`;
        if (!window.__seen.statuses.includes(entry))
          window.__seen.statuses.push(entry);
      }
      for (const el of document.querySelectorAll('[aria-busy="true"]')) {
        const id = el.getAttribute("data-testid") ?? el.textContent.trim();
        if (!window.__seen.busy.includes(id)) window.__seen.busy.push(id);
      }
    };
    scan();
    window.__seenObserver?.disconnect();
    window.__seenObserver = new MutationObserver(scan);
    window.__seenObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}
const readStatuses = (page) =>
  page.evaluate(() => window.__seen ?? { statuses: [], busy: [] });

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });

  c.step(`Launching Google Chrome (${HEADLESS ? "headless" : "headed"})`);
  const browser = await chromium.launch({
    // Real Chrome: bundled Chromium has no H.264 at all, so the page would take
    // its "no WebCodecs" branch and this could never pass.
    channel: "chrome",
    headless: HEADLESS,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  // Separate CONTEXTS, not tabs: each peer carries a different node URL and token
  // in its hash and both use the same localStorage keys.
  const mk = async (name, url) => {
    const ctx = await browser.newContext({
      // clipboard-write because the invite flow's Copy button is part of what is
      // under test. Without it `navigator.clipboard.writeText` rejects and the app
      // shows its "select the code and copy it" fallback — correct behaviour, but
      // not the path being asserted here.
      permissions: ["camera", "clipboard-write"],
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    const logs = [];
    page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { name, ctx, page, logs };
  };

  const streamName = `ui-stream-${STAMP}`;
  const roomName = `ui-room-${STAMP}`;
  let peerA;
  let peerB;
  let inviteCode = "";

  try {
    // ── 1. node1: create a STREAM, land on its ROOM LIST ─────────────────────
    c.step("node1: create a stream (namespace) through the picker");
    peerA = await mk(
      "peerA",
      `${VITE_URL}/streams${sessionHash(
        env.DEV_NODE_URL,
        env.DEV_ACCESS_TOKEN,
        env.DEV_REFRESH_TOKEN,
        env.DEV_APP_ID,
      )}`,
    );
    const title = await peerA.page.title();
    if (
      !check(
        title === "Mero Stream",
        `peerA served "Mero Stream" (got "${title}")`,
      )
    ) {
      throw new Error("a different app is on this port — check VITE_URL");
    }

    const nameInput = peerA.page.locator('[data-testid="stream-name-input"]');
    await nameInput.waitFor({ state: "visible", timeout: 30_000 });
    c.ok("peerA landed on the stream picker (no context in the hash)");
    await nameInput.fill(streamName);

    await watchStatuses(peerA.page);
    await peerA.page.locator('[data-testid="create-stream"]').click();

    // Creating a stream must land on THAT STREAM'S ROOM LIST. Asserting the route
    // is the point: the namespace and the room are different things now, and the
    // old picker collapsed them into one and could never show a second room.
    await peerA.page
      .locator('[data-testid="room-name-input"]')
      .waitFor({ state: "visible", timeout: 60_000 });
    const roomsUrl = new URL(peerA.page.url());
    const namespaceId = roomsUrl.pathname.split("/").filter(Boolean).pop();
    check(
      /^\/streams\/[0-9a-zA-Z]+$/.test(roomsUrl.pathname),
      `peerA landed on the room list for the new stream (${roomsUrl.pathname})`,
    );

    const createSeen = await readStatuses(peerA.page);
    check(
      createSeen.busy.includes("create-stream"),
      `the Create button reported aria-busy while creating (saw: ${createSeen.busy.join(", ") || "none"})`,
    );
    check(
      createSeen.statuses.some((s) => s.startsWith("pending")),
      `a named step status appeared while creating (saw: ${createSeen.statuses.join(" | ") || "none"})`,
    );

    // ── 2. node1: create a ROOM, land in the call ────────────────────────────
    c.step("node1: create a room inside that stream");
    await peerA.page.locator('[data-testid="room-name-input"]').fill(roomName);
    await watchStatuses(peerA.page);
    await peerA.page.locator('[data-testid="create-room"]').click();

    await peerA.page
      .locator('[data-testid="capture-toggle"]')
      .waitFor({ state: "visible", timeout: 90_000 });
    check(
      new URL(peerA.page.url()).pathname === "/live",
      `creating a room lands on /live, the 480p route (${new URL(peerA.page.url()).pathname})`,
    );
    await peerA.page
      .locator('[data-testid="join-state"]')
      .filter({ hasText: "joined" })
      .waitFor({ timeout: 60_000 });
    c.ok("peerA is joined to the room's context");

    const roomSeen = await readStatuses(peerA.page);
    check(
      roomSeen.busy.includes("create-room"),
      `the Create room button reported aria-busy (saw: ${roomSeen.busy.join(", ") || "none"})`,
    );
    check(
      roomSeen.statuses.some((s) => /pending: .*room/i.test(s)),
      `room creation named its steps (saw: ${roomSeen.statuses.join(" | ") || "none"})`,
    );

    // ── 3. node1: mint a ROOM invite code ────────────────────────────────────
    c.step("node1: mint an invite code for that room");
    await peerA.page.goBack({ waitUntil: "domcontentloaded" });
    const roomRow = peerA.page.locator('[data-testid="room-row"]');
    await roomRow.first().waitFor({ state: "visible", timeout: 60_000 });
    check(
      (await roomRow.count()) >= 1,
      `the room is listed under its stream (${await roomRow.count()} room(s))`,
    );

    await watchStatuses(peerA.page);
    await peerA.page.locator('[data-testid="invite-room"]').first().click();
    const codeInput = peerA.page.locator('[data-testid="invite-code"]');
    await codeInput.waitFor({ state: "visible", timeout: 60_000 });
    inviteCode = await codeInput.inputValue();

    check(inviteCode.length > 0, `minted a code (${inviteCode.length} chars)`);
    // The format IS the feature: one line of base58, so it survives a chat window,
    // a URL and shell quoting. base64's `+/=` are exactly what gets mangled there.
    check(
      !/[+/=\s"'{}]/.test(inviteCode),
      "the code is one pasteable token — no JSON, no whitespace, no +/=",
    );
    // The scope must be stated, because a namespace code and a room code look
    // identical — both are one base58 blob — and they do different things.
    const scope = await peerA.page
      .locator('[data-testid="invite-scope"]')
      .textContent();
    check(
      (scope ?? "").includes(roomName),
      `the UI states which room the code opens (“${scope?.trim()}”)`,
    );

    const inviteSeen = await readStatuses(peerA.page);
    check(
      inviteSeen.statuses.some((s) => s.startsWith("ok")),
      `an outcome status confirmed the code (saw: ${inviteSeen.statuses.join(" | ") || "none"})`,
    );

    // Capture the room list WITH the invite box open: the pages before the call are
    // the part a screenshot is actually useful for reviewing, and the call itself is
    // already captured at the end.
    await peerA.page.screenshot({ path: `${ARTIFACTS}/rooms-with-invite.png` });

    // Copy: the confirmation is the only signal the click did anything. WAIT for
    // it rather than reading straight after the click — `setCopied` is React state
    // set after an awaited clipboard write, so it lands a render later and an
    // immediate read always sees the old label.
    const copyBtn = peerA.page.locator('[data-testid="invite-copy"]');
    await copyBtn.click();
    let copyLabel = "";
    for (let i = 0; i < 20; i++) {
      copyLabel = (await copyBtn.textContent()) ?? "";
      if (/copied/i.test(copyLabel)) break;
      await sleep(150);
    }
    check(
      /copied/i.test(copyLabel),
      `the Copy button confirms it copied (“${copyLabel.trim()}”)`,
    );

    // ── 4. node2: paste the code, land in the call ───────────────────────────
    c.step("node2: paste that code — namespace + room + context in one join");
    peerB = await mk(
      "peerB",
      `${VITE_URL}/streams${sessionHash(
        env.DEV_NODE_URL_2,
        env.DEV_ACCESS_TOKEN_2,
        env.DEV_REFRESH_TOKEN_2,
        env.DEV_APP_ID_2 || env.DEV_APP_ID,
      )}`,
    );
    const joinInput = peerB.page.locator('[data-testid="join-code-input"]');
    await joinInput.waitFor({ state: "visible", timeout: 30_000 });
    await peerB.page.screenshot({ path: `${ARTIFACTS}/picker-empty.png` });
    await joinInput.fill(inviteCode);

    await watchStatuses(peerB.page);
    await peerB.page.locator('[data-testid="join-submit"]').click();

    // The join walks the chain (namespace, then the room), then waits for the
    // context identity — with a fallback to an explicit joinContext, because
    // auto-follow is neither instant nor guaranteed. Generous timeout on purpose.
    await peerB.page
      .locator('[data-testid="capture-toggle"]')
      .waitFor({ state: "visible", timeout: 180_000 });
    check(
      new URL(peerB.page.url()).pathname === "/live",
      "pasting a room code took node2 straight into the call",
    );
    await peerB.page
      .locator('[data-testid="join-state"]')
      .filter({ hasText: "joined" })
      .waitFor({ timeout: 60_000 });
    c.ok("peerB is joined to the room's context on its OWN node");

    const joinSeen = await readStatuses(peerB.page);
    check(
      joinSeen.busy.includes("join-submit"),
      `the Join button reported aria-busy (saw: ${joinSeen.busy.join(", ") || "none"})`,
    );
    // Each join step names itself. This is what turns a 20-second wait from
    // "hung" into "joining the namespace, then the room".
    check(
      joinSeen.statuses.some((s) => /pending: joining/i.test(s)),
      `the join named its steps (saw: ${joinSeen.statuses.join(" | ") || "none"})`,
    );

    // ── 5. Both start capture; each must see the OTHER ───────────────────────
    //
    // peerA is on the room LIST at this point (it went back there to mint the
    // code), so send it into the room the same way a person would: click the row.
    // It is already a member, so this also checks that re-entering a joined room
    // does not go through the join path again.
    c.step("node1: re-enter the room from the room list");
    await peerA.page.locator('[data-testid="room-row"]').first().click();
    await peerA.page
      .locator('[data-testid="capture-toggle"]')
      .waitFor({ state: "visible", timeout: 60_000 });
    check(
      new URL(peerA.page.url()).pathname === "/live",
      "clicking a joined room row opens the call",
    );
    await peerA.page
      .locator('[data-testid="join-state"]')
      .filter({ hasText: "joined" })
      .waitFor({ timeout: 60_000 });

    // Distinct display names, so the tile labels can be checked. A tile captioned
    // with a truncated public key identifies nobody, which is most of the reason
    // "who am I looking at" needed solving at all.
    c.step("Naming both peers");
    const nameOf = { peerA: `alice-${STAMP}`, peerB: `bob-${STAMP}` };
    for (const p of [peerA, peerB]) {
      await p.page
        .locator('[data-testid="username-input"]')
        .fill(nameOf[p.name]);
      await p.page.locator('[data-testid="username-submit"]').click();
      await p.page
        .locator('[data-testid="join-state"]')
        .filter({ hasText: "joined" })
        .waitFor({ timeout: 30_000 });
      c.ok(`${p.name} joined as ${nameOf[p.name]}`);
    }

    c.step("Both peers start capture");
    const startCapture = async (p) => {
      const toggle = p.page.locator('[data-testid="capture-toggle"]');
      await toggle.waitFor({ state: "visible", timeout: 15_000 });
      await toggle.click();
      for (let i = 0; i < 40; i++) {
        if ((await toggle.getAttribute("data-running")) === "true") return true;
        await sleep(250);
      }
      return false;
    };
    for (const p of [peerA, peerB]) {
      check(await startCapture(p), `capture is running on ${p.name}`);
    }

    c.step("Verifying each peer decodes the OTHER's real picture");
    const sampleCanvas = (p) =>
      p.page.evaluate(() => {
        const cv = document.querySelector('[data-testid="remote-canvas"]');
        if (!(cv instanceof HTMLCanvasElement)) return null;
        if (!cv.width || !cv.height)
          return { blank: true, w: cv.width, h: cv.height };
        const ctx = cv.getContext("2d");
        if (!ctx) return null;
        const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
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

    for (const p of [peerA, peerB]) {
      // Exactly one remote tile: two participants means one OTHER person. A second
      // tile would mean we are decoding our own stream too.
      let tiles = 0;
      const tileDeadline = Date.now() + 60_000;
      while (Date.now() < tileDeadline) {
        tiles = await p.page.locator('[data-testid="peer-tile"]').count();
        if (tiles === 1) break;
        await sleep(500);
      }
      check(
        tiles === 1,
        `${p.name} shows exactly 1 remote tile (got ${tiles})`,
      );

      // Poll for the first painted frame: a positive decode rate only means chunks
      // were pushed into the decoder, not that output has landed on the canvas.
      let first = null;
      const paintDeadline = Date.now() + 60_000;
      while (Date.now() < paintDeadline) {
        first = await sampleCanvas(p);
        if (first && !first.blank && first.variance > 5) break;
        await sleep(500);
      }
      check(
        first?.w === 640 && first?.h === 480,
        `${p.name}: decoded the other peer at 640x480 (got ${first?.w}x${first?.h})`,
      );
      check(
        (first?.variance ?? 0) > 5,
        `${p.name}: a real picture, not a flat fill (variance ${first?.variance?.toFixed(1)})`,
      );

      // And confirm it MOVES — blank and frozen are different failures and both
      // look healthy from every other angle.
      let moved = false;
      const moveDeadline = Date.now() + 20_000;
      while (Date.now() < moveDeadline && !moved) {
        await sleep(500);
        const second = await sampleCanvas(p);
        moved = !!(first && second && first.sig !== second.sig);
      }
      check(
        moved,
        `${p.name}: the picture advances (video, not a stuck frame)`,
      );

      // The tile must name the OTHER person, not us and not a public key.
      const other = p.name === "peerA" ? "peerB" : "peerA";
      const caption = await p.page
        .locator('[data-testid="peer-tile"] figcaption')
        .first()
        .textContent();
      check(
        (caption ?? "").includes(nameOf[other]),
        `${p.name}'s tile is labelled with ${nameOf[other]} (“${caption?.trim()}”)`,
      );
    }

    c.step(`Holding the two-way call for ${CALL_SECONDS}s`);
    await sleep(CALL_SECONDS * 1000);
    for (const p of [peerA, peerB]) {
      const rate = await p.page
        .locator('[data-testid="decode-rate"]')
        .getAttribute("data-value");
      check(
        Number(rate) > 0,
        `${p.name} still decoding after the hold (${rate}/s)`,
      );
    }

    for (const p of [peerA, peerB]) {
      await p.page.screenshot({ path: `${ARTIFACTS}/${p.name}.png` });
    }
    writeFileSync(
      `${ARTIFACTS}/result.json`,
      JSON.stringify(
        {
          ok: failures.length === 0,
          failures,
          streamName,
          roomName,
          namespaceId,
          inviteCodeLength: inviteCode.length,
        },
        null,
        2,
      ),
    );
    c.ok(`artifacts in data/ui-invite-call/`);
  } catch (e) {
    // A thrown timeout is the LEAST informative failure this driver can produce —
    // "waiting for capture-toggle" says nothing about why the join stalled. The
    // page already renders the reason in its status line, so dump it here rather
    // than leaving the next reader to re-run with a debugger.
    c.bad(e.message?.split("\n")[0] ?? String(e));
    for (const p of [peerA, peerB]) {
      if (!p?.page) continue;
      const shown = await p.page
        .evaluate(() =>
          [...document.querySelectorAll("[data-tone]")].map(
            (el) => `${el.getAttribute("data-tone")}: ${el.textContent.trim()}`,
          ),
        )
        .catch(() => []);
      const seen = await readStatuses(p.page).catch(() => null);
      c.info(`${p.name} at ${p.page.url()}`);
      c.info(`${p.name} showing: ${shown.join(" | ") || "(nothing)"}`);
      if (seen?.statuses?.length) {
        c.info(`${p.name} steps seen: ${seen.statuses.join(" | ")}`);
      }
    }
    failures.push(e.message?.split("\n")[0] ?? String(e));
  } finally {
    for (const p of [peerA, peerB]) {
      if (p?.logs?.length) {
        writeFileSync(`${ARTIFACTS}/${p.name}-console.log`, p.logs.join("\n"));
      }
      if (failures.length && p?.page) {
        await p.page
          .screenshot({ path: `${ARTIFACTS}/${p.name}-failure.png` })
          .catch(() => {});
      }
    }
    await browser.close();
  }

  if (failures.length) {
    c.step(`FAILED — ${failures.length} check(s)`);
    for (const f of failures) c.bad(f);
    process.exit(1);
  }
  c.step("PASSED — stream, room, invite code, join on a second node,");
  c.ok("and a two-way 480p call, all driven through the UI.");
}

main().catch((e) => {
  c.bad(e.stack ?? String(e));
  process.exit(1);
});
