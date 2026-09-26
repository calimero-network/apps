// Records the landing page's showcase clip from the REAL mero-chat UI:
//
//   pnpm landing:media   → public/landing/demo.webm + demo-poster.jpg
//
// Everything on screen is production code — the pages, the composer, the
// thread panel, the reactions — built by vite.config.ts in this folder, which
// aliases ONLY `@calimero-network/mero-react` so the app's own api/ layer runs
// against the invented node in fakeMero.ts. No merod, no Docker.
//
// Each chapter is padded to a fixed length, so the chapter times in
// scripts/landing/apps.config.mjs ('mero-chat' → overview.showcase) stay right on
// every re-run. Change CHAPTERS and those times together.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { attachNode, startServer } from "./serve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MEDIA_OUT ?? join(HERE, "..", "..", "public", "landing");
// Playwright's own ffmpeg carries libvpx (VP8); a Homebrew build often has no
// VP8/VP9 encoder at all. $FFMPEG wins, then Playwright's, then PATH.
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  for (const root of [join(homedir(), "Library", "Caches", "ms-playwright"), join(homedir(), ".cache", "ms-playwright"), "/opt/pw-browsers"]) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((n) => n.startsWith("ffmpeg-")).sort().reverse()) {
      for (const bin of ["ffmpeg-mac", "ffmpeg-linux"]) if (existsSync(join(root, d, bin))) return join(root, d, bin);
    }
  }
  return "ffmpeg";
}
const FFMPEG = findFfmpeg();
const FPS = 25;
const W = 1280;
const H = 800;

export const CHAPTERS = [
  { id: "open", seconds: 3 },
  { id: "send", seconds: 5 },
  { id: "thread", seconds: 6 },
  { id: "react", seconds: 4 },
  { id: "dm", seconds: 4 },
];

// The one known, recoverable React error in this app (mero-ui's editor
// registering a tiptap plugin twice, error #520). Anything else fails the run.
const KNOWN = /#520|concurrent rendering/;

class Recorder {
  frames = [];
  static async start(page) {
    const cdp = await page.context().newCDPSession(page);
    const rec = new Recorder();
    rec.cdp = cdp;
    cdp.on("Page.screencastFrame", (f) => {
      rec.frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, jpeg: Buffer.from(f.data, "base64") });
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    return rec;
  }
  now() {
    return this.frames.length ? Date.now() / 1000 - this.frames[0].t : 0;
  }
  async stop() {
    await this.cdp.send("Page.stopScreencast");
  }
  async encode(path, from, seconds) {
    const t0 = this.frames[0].t + from;
    const ff = spawn(FFMPEG, [
      "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", `scale=${W}:-2`, "-an", "-c:v", "libvpx", "-b:v", "1100k", "-crf", "10", "-qmin", "4",
      "-qmax", "40", "-deadline", "good", "-cpu-used", "1", "-auto-alt-ref", "0", "-g", String(FPS * 4), path,
    ]);
    let err = "";
    ff.stderr.on("data", (d) => (err += d));
    const done = new Promise((ok, fail) => ff.on("close", (c) => (c === 0 ? ok() : fail(new Error(err.slice(-1500))))));
    let i = 0;
    for (let n = 0; n < Math.round(seconds * FPS); n++) {
      const t = t0 + n / FPS;
      while (i + 1 < this.frames.length && this.frames[i + 1].t <= t) i++;
      if (!ff.stdin.write(this.frames[i].jpeg)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
  }
  // The viewport is exactly W×H at deviceScaleFactor 1, so a screencast frame
  // already IS a poster-sized JPEG.
  poster(path, at) {
    const t = this.frames[0].t + at;
    const f = this.frames.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best));
    writeFileSync(path, f.jpeg);
  }
}

/** A screencast has no OS pointer, so draw one that follows the mouse. */
async function showPointer(page) {
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2.5l6.5 18 2.4-7.4 7.6-2.6z" ' +
        'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-3px 0 0 -4px;z-index:2147483647;" +
        "pointer-events:none;transition:transform .12s ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));" +
        `background:no-repeat center/contain url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      document.body.appendChild(dot);
      addEventListener("mousemove", (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
      addEventListener("mousedown", () => (dot.style.transform = "scale(.82)"), true);
      addEventListener("mouseup", () => (dot.style.transform = ""), true);
    });
  });
}

async function glide(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for glide target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}

async function typeSlowly(page, text) {
  for (const ch of text) await page.keyboard.type(ch, { delay: 45 });
}

function messageRow(page, text) {
  return page.locator(".msg-content").filter({ hasText: text }).first().locator("xpath=../../..");
}

const STORY = {
  async open(page) {
    await page.getByText("RC1 is building now").waitFor();
  },
  async send(page) {
    const editor = page.locator(".ProseMirror").first();
    await glide(page, editor);
    await editor.click();
    await typeSlowly(page, "Tuesday it is. I'll update the release notes tonight 🚀");
    await page.keyboard.press("Enter");
    await page.locator(".msg-content").filter({ hasText: "update the release notes" }).first().waitFor();
  },
  async thread(page) {
    const link = page.getByText("5 replies").first();
    await glide(page, link);
    await link.click();
    const threadEditor = page.locator(".ProseMirror").nth(1);
    await threadEditor.waitFor();
    await glide(page, threadEditor);
    await threadEditor.click();
    await typeSlowly(page, "Copy pass is done, over to you Sam");
    await page.keyboard.press("Enter");
    await page.locator(".msg-content").filter({ hasText: "Copy pass is done" }).first().waitFor();
  },
  async react(page) {
    // Close the thread first so the channel is back in full view.
    await page.keyboard.press("Escape");
    const row = messageRow(page, "Support is staffed for Tuesday");
    await glide(page, row);
    await row.hover();
    const bar = row.locator('[id^="actions-container-"]').first();
    const thumbs = bar.getByText("👍").first();
    await glide(page, thumbs);
    await thumbs.click({ force: true });
    await row.getByText("👍1").waitFor();
  },
  async dm(page) {
    const theo = page.getByText("Theo Brandt", { exact: true }).first();
    await glide(page, theo);
    await theo.click();
    await page.getByText("is typing").first().waitFor();
  },
};

mkdirSync(OUT, { recursive: true });
if (FFMPEG !== "ffmpeg" && !existsSync(FFMPEG)) throw new Error(`no ffmpeg at ${FFMPEG}`);
console.log("ffmpeg:", FFMPEG);

const { url, close } = await startServer();
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => { if (!KNOWN.test(e.message)) errors.push(e.message); });
  await attachNode(page);
  await page.addInitScript(() => {
    window.__SHOT_SCENE__ = { open: "launch", typingIn: "dm-theo", typingName: "Theo Brandt" };
  });
  await showPointer(page);
  await page.goto(url + "/");
  await page.getByText("RC1 is building now").waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);

  const rec = await Recorder.start(page);
  await page.waitForTimeout(300);
  const starts = {};
  let clock = rec.now();
  for (const ch of CHAPTERS) {
    starts[ch.id] = clock;
    await STORY[ch.id](page);
    const spent = rec.now() - clock;
    if (spent > ch.seconds) throw new Error(`chapter ${ch.id} took ${spent.toFixed(1)}s, over its ${ch.seconds}s`);
    await page.waitForTimeout((ch.seconds - spent) * 1000);
    clock += ch.seconds;
  }
  await rec.stop();

  if (errors.length) throw new Error("page errors during the recording:\n" + errors.join("\n"));
  const total = CHAPTERS.reduce((s, c) => s + c.seconds, 0);
  await rec.encode(join(OUT, "demo.webm"), starts.open, total);
  rec.poster(join(OUT, "demo-poster.jpg"), starts.react + 3.5);
  console.log("chapters (s):", JSON.stringify(Object.fromEntries(Object.entries(starts).map(([k, v]) => [k, +(v - starts.open).toFixed(2)]))));
  console.log("wrote", join(OUT, "demo.webm"), "and demo-poster.jpg");
} finally {
  await browser.close();
  close();
}
