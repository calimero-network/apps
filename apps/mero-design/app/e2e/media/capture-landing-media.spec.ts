import { test, type CDPSession, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { openBoard, TEST_MEMBER } from "../fixtures/board";

/**
 * Records the landing page's demo clip from the real editor, against the
 * mocked-node fixture, on the bundled Web design starter project.
 *
 *   pnpm landing:media        → public/landing/demo.webm + demo-poster.jpg
 *
 * The clip is one short story in five chapters. Each chapter is padded to a
 * fixed length, so the chapter times the landing page shows
 * (`showcase.video.chapters` in scripts/landing/apps.config.mjs) stay right
 * every time this is re-run. Change a duration here, change it there.
 */
const CHAPTERS = [
  { id: "open", seconds: 3 },
  { id: "note", seconds: 6 },
  { id: "point", seconds: 4.5 },
  { id: "change", seconds: 5.5 },
  { id: "present", seconds: 5 },
] as const;

const OUT = process.env.MEDIA_OUT ?? "public/landing";
const FFMPEG = process.env.FFMPEG ?? "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux";
const FPS = 25;
const VIEWPORT = { width: 1280, height: 800 };

const web = JSON.parse(
  readFileSync(new URL("../../src/starter/starter-project.json", import.meta.url), "utf8"),
);
const TEAMMATE = { id: "teammate-ada", username: "Ada", avatar: null, joinedAt: 2000 };

/**
 * Chrome's screencast at 2x, not Playwright's `recordVideo`: that one encodes
 * at a fixed low bitrate at 1x, which is what made the first clip soft. Frames
 * arrive only when something repaints, so each is kept with its timestamp and
 * held until the next one when the clip is laid out at a constant rate.
 */
class Recorder {
  private frames: { t: number; jpeg: Buffer }[] = [];
  private constructor(private cdp: CDPSession) {}

  static async start(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const rec = new Recorder(cdp);
    cdp.on("Page.screencastFrame", (f) => {
      rec.frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, jpeg: Buffer.from(f.data, "base64") });
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
    return rec;
  }

  /** Seconds since the first frame — where the chapter clock is read from. */
  now() {
    return this.frames.length ? Date.now() / 1000 - this.frames[0].t : 0;
  }

  async stop() {
    await this.cdp.send("Page.stopScreencast");
  }

  /** Lays the frames out at FPS from `from` seconds and encodes VP8. */
  async encode(path: string, from: number, seconds: number) {
    const t0 = this.frames[0].t + from;
    const ff = spawn(FFMPEG, [
      "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", "scale=1600:-2", "-an",
      "-c:v", "libvpx", "-b:v", "2400k", "-crf", "6", "-qmin", "2", "-qmax", "30",
      "-deadline", "good", "-cpu-used", "1", "-auto-alt-ref", "0", "-g", String(FPS * 4),
      path,
    ]);
    let err = "";
    ff.stderr.on("data", (d) => { err += d; });
    const done = new Promise<void>((ok, fail) =>
      ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(err.slice(-2000))))),
    );
    let i = 0;
    for (let n = 0; n < Math.round(seconds * FPS); n++) {
      const t = t0 + n / FPS;
      while (i + 1 < this.frames.length && this.frames[i + 1].t <= t) i++;
      if (!ff.stdin.write(this.frames[i].jpeg)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
  }
}

/** Recordings do not include the OS pointer, so draw one that follows the mouse. */
async function showPointer(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 2.5l6.5 18 2.4-7.4 7.6-2.6z" ' +
        'fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;left:-40px;top:-40px;width:24px;height:24px;margin:-3px 0 0 -4px;z-index:2147483647;" +
        "pointer-events:none;transition:transform .12s ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25));" +
        `background:no-repeat center/contain url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      document.body.appendChild(dot);
      window.addEventListener("mousemove", (e) => {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      }, true);
      window.addEventListener("mousedown", () => { dot.style.transform = "scale(.82)"; }, true);
      window.addEventListener("mouseup", () => { dot.style.transform = ""; }, true);
    });
  });
}

test("demo video", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await showPointer(page);
  await openBoard(page, {
    elements: web.elements,
    comments: [],
    tauri: false,
    members: [TEST_MEMBER, TEAMMATE],
    // Ada is looking at the sign-in form while you work.
    cursors: () => [{ identity: TEAMMATE.id, x: 870, y: 190, updatedAt: Date.now() }],
  });

  // Frame the sign-in form at a size where its text can actually be read, with
  // empty canvas under it — a sticky is only placed on a click on empty canvas.
  const minus = page.getByRole("button", { name: "−", exact: true });
  for (let i = 0; i < 2; i++) await minus.click();
  const canvas = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.keyboard.press("h");
  await page.mouse.move(canvas.x + 500, canvas.y + 400);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 500 - 175, canvas.y + 400 - 220, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.mouse.move(canvas.x + 640, canvas.y + 700);
  await page.waitForTimeout(800);

  const at = (x: number, y: number) => ({ x: canvas.x + x, y: canvas.y + y });
  const glide = (p: { x: number; y: number }, steps = 14) => page.mouse.move(p.x, p.y, { steps });
  const X = (k: string, d: number) => Number(process.env[k] ?? d);

  const rec = await Recorder.start(page);
  await page.waitForTimeout(300);
  const clipStart = rec.now();
  let chapterEnd = clipStart;
  /** Runs one chapter, then holds until its fixed length is up. */
  const chapter = async (i: number, body: () => Promise<void>) => {
    chapterEnd += CHAPTERS[i].seconds;
    await body();
    const left = chapterEnd - rec.now();
    if (left < 0) throw new Error(`chapter ${CHAPTERS[i].id} overran by ${(-left).toFixed(2)}s`);
    await page.waitForTimeout(left * 1000);
  };

  // 1. Open a board — the design, and a teammate already in it.
  await chapter(0, async () => {
    await glide(at(760, 620), 20);
  });

  // 2. Leave a note on the design.
  await chapter(1, async () => {
    await page.getByTestId("tool-sticky").click();
    const note = at(X("NOTE_X", 760), X("NOTE_Y", 600));
    await glide(note);
    await page.mouse.click(note.x, note.y);
    await page.keyboard.type("Make the CTA pop", { delay: 75 });
    await page.keyboard.press("Escape");
  });

  // 3. Point at what it is about: an arrow that docks onto the button.
  await chapter(2, async () => {
    await page.getByTestId("tool-arrow").click();
    const from = at(X("ARROW_X1", 745), X("ARROW_Y1", 526));
    const to = at(X("ARROW_X2", 626), X("ARROW_Y2", 284));
    await glide(from);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 18 });
    await page.mouse.up();
  });

  // 4. Change it: select the button, give it a new colour.
  await chapter(3, async () => {
    await page.getByTestId("tool-select").click();
    const btn = at(X("BTN_X", 560), X("BTN_Y", 281));
    await glide(btn);
    await page.mouse.click(btn.x, btn.y);
    await page.waitForTimeout(500);
    const swatch = page.getByTestId("fill-swatch").getByRole("radio").nth(2);
    const sb = (await swatch.boundingBox())!;
    await glide({ x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 });
    await swatch.click();
    await page.waitForTimeout(300);
    // The finished board doubles as the poster, so the section says the same
    // thing before it plays.
    await page.screenshot({ path: `${OUT}/demo-poster.jpg`, type: "jpeg", quality: 82 });
  });

  // 5. Present it — the change is already in the slide.
  await chapter(4, async () => {
    const present = page.getByRole("button", { name: /Present/ }).first();
    const pb = (await present.boundingBox())!;
    await glide({ x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 });
    await present.click();
    await page.mouse.move(VIEWPORT.width - 40, VIEWPORT.height - 40, { steps: 20 });
  });

  await rec.stop();
  if (!existsSync(FFMPEG)) throw new Error(`no ffmpeg at ${FFMPEG}; set FFMPEG`);
  await rec.encode(`${OUT}/demo.webm`, clipStart, CHAPTERS.reduce((s, c) => s + c.seconds, 0));
  await context.close();
});
