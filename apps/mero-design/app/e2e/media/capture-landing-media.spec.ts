import { test, type CDPSession, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Element } from "../../src/types";
import { newSticky } from "../../src/utils/boxText";
import { openBoard, TEST_MEMBER, type Board } from "../fixtures/board";

/**
 * Records the landing page's two clips from the real editor, against the
 * mocked-node fixture, on the bundled Web design starter project:
 *
 *   pnpm landing:media   → public/landing/demo.webm + demo-poster.jpg (the story)
 *                          public/landing/hero.webm + hero-poster.jpg (the hero loop)
 *
 * The teammate, Ada, is not painted on. Her cursor moves and her edits land
 * through the app's own event stream: the same StateMutation events a node
 * pushes over SSE, which the app answers by re-reading the element — exactly
 * the path a real collaborator's change takes.
 *
 * The clip is one short story in five chapters. Each chapter is padded to a
 * fixed length, so the chapter times the landing page shows
 * (`showcase.video.chapters` in scripts/landing/apps.config.mjs) stay right
 * every time this is re-run. Change a duration here, change it there.
 */
const CHAPTERS = [
  { id: "open", seconds: 3 },
  { id: "note", seconds: 6 },
  { id: "point", seconds: 5 },
  { id: "live", seconds: 5 },
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
/** The starter's primary "Sign in" button on the 01 Sign in screen. */
const SIGN_IN_BUTTON = "starter-020";
const CONTEXT = "ctx-1";

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
  async encode(path: string, from: number, seconds: number, width = 1600) {
    const t0 = this.frames[0].t + from;
    const ff = spawn(FFMPEG, [
      "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", `scale=${width}:-2`, "-an",
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


/**
 * Stands in for the node's SSE stream: `/sse` answers with a stream the test
 * writes into, and `/sse/subscription` with an OK. Installed before the app
 * loads, so mero-js's SseClient connects to it like it would to a node.
 */
async function installEventStream(page: Page) {
  await page.addInitScript(() => {
    const enc = new TextEncoder();
    // Every open stream, not just the latest: React's dev double-mount opens
    // two, and which one survives depends on timing.
    const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
    const realFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/sse\/subscription$/.test(url)) {
        return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (/\/sse$/.test(url)) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            streams.add(c);
            c.enqueue(enc.encode('data: {"type":"connect","session_id":"media"}\n\n'));
          },
          cancel() {
            for (const c of streams) if (c.desiredSize === null) streams.delete(c);
          },
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
      }
      return realFetch(input, init);
    };
    (window as unknown as { __sse: (m: unknown) => void }).__sse = (m) => {
      const bytes = enc.encode(`data: ${JSON.stringify(m)}\n\n`);
      for (const c of streams) {
        try {
          c.enqueue(bytes);
        } catch {
          streams.delete(c);
        }
      }
    };
  });
}

/** Ada: a member whose cursor and edits reach the page as node events. */
class Teammate {
  pos = { x: -100, y: -100 };
  /** Set once the board is open — her edits are written into its state. */
  board!: Board;
  constructor(private page: Page) {}

  cursors = () => [{ identity: TEAMMATE.id, ...this.pos, updatedAt: Date.now() }];

  private async emit(kind: string, value: unknown) {
    const data = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    await this.page.evaluate(
      (m) => (window as unknown as { __sse: (m: unknown) => void }).__sse(m),
      { result: { contextId: CONTEXT, data: { events: [{ kind, data }] } } },
    );
  }

  /** Moves her cursor in canvas pixels, as a stream of CursorMoved events. */
  async moveTo(x: number, y: number, ms: number) {
    const from = { ...this.pos };
    const steps = Math.max(1, Math.round(ms / 60));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.pos = { x: Math.round(from.x + (x - from.x) * e), y: Math.round(from.y + (y - from.y) * e) };
      await this.emit("CursorMoved", TEAMMATE.id);
      await this.page.waitForTimeout(60);
    }
  }

  /** Writes an element into the node's state as her edit, and announces it. */
  async add(el: Element) {
    const b = this.board;
    b.setElements([...b.elementsNow(), el]);
    await this.emit("ElementAdded", el.id);
  }

  async update(id: string, patch: Partial<Element>) {
    const b = this.board;
    b.setElements(b.elementsNow().map((e) => (e.id === id ? ({ ...e, ...patch } as Element) : e)));
    await this.emit("ElementUpdated", id);
  }
}

/** Zooms out `steps` times and pans the view by (dx, dy), leaving the select tool on. */
async function frame(page: Page, steps: number, dx: number, dy: number) {
  const minus = page.getByRole("button", { name: "−", exact: true });
  for (let i = 0; i < steps; i++) await minus.click();
  const canvas = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  await page.keyboard.press("h");
  await page.mouse.move(canvas.x + 400, canvas.y + 400);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 400 + dx, canvas.y + 400 + dy, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("v");
  return canvas;
}

const X = (k: string, d: number) => Number(process.env[k] ?? d);

test("demo video", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await showPointer(page);
  await installEventStream(page);
  const ada = new Teammate(page);
  ada.pos = { x: 870, y: 190 };
  ada.board = await openBoard(page, {
    elements: web.elements,
    comments: [],
    tauri: false,
    members: [TEST_MEMBER, TEAMMATE],
    cursors: ada.cursors,
  });

  // Frame the sign-in form at a size where its text can actually be read, with
  // empty canvas under it — a sticky is only placed on a click on empty canvas.
  const canvas = await frame(page, 2, -175, -220);
  await page.mouse.move(canvas.x + 640, canvas.y + 700);
  await page.waitForTimeout(800);

  const at = (x: number, y: number) => ({ x: canvas.x + x, y: canvas.y + y });
  const glide = (p: { x: number; y: number }, steps = 14) => page.mouse.move(p.x, p.y, { steps });

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

  // 1. Open a board — the design, and Ada already in it.
  await chapter(0, async () => {
    await Promise.all([glide(at(760, 620), 20), ada.moveTo(840, 215, 1400)]);
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
    await page.getByTestId("tool-select").click();
    await page.keyboard.press("Escape");
  });

  // 4. Ada picks it up, live: her cursor comes over and the button changes on
  //    your screen, through the same event a node would send.
  await chapter(3, async () => {
    await glide(at(900, 640), 10);
    await ada.moveTo(X("ADA_BTN_X", 585), X("ADA_BTN_Y", 290), 1500);
    await page.waitForTimeout(400);
    await ada.update(SIGN_IN_BUTTON, { fill: "#2F9E44" });
    await page.waitForTimeout(700);
    await ada.moveTo(X("ADA_BTN_X", 585) + 60, X("ADA_BTN_Y", 290) + 40, 700);
    // The finished board doubles as the poster, so the section says the same
    // thing before it plays.
    await page.screenshot({ path: `${OUT}/demo-poster.jpg`, type: "jpeg", quality: 82 });
  });

  // 5. Present it — Ada's change is already in the slide.
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

/**
 * The hero loop: two people on one board at the same moment. No captions — the
 * hero's stage is small, so it is framed tight and cut short. Sized to the
 * hero stage's box (495 x 341), which is what `animation.tsx` plays it in.
 */
test("hero video", async ({ browser }) => {
  test.setTimeout(120_000);
  const size = { width: 1160, height: 800 };
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await showPointer(page);
  await installEventStream(page);
  const ada = new Teammate(page);
  ada.pos = { x: 860, y: 120 };
  ada.board = await openBoard(page, {
    elements: web.elements,
    comments: [],
    tauri: false,
    members: [TEST_MEMBER, TEAMMATE],
    cursors: ada.cursors,
  });
  const canvas = await frame(page, X("HERO_ZOOM", 3), X("HERO_DX", -168), X("HERO_DY", -60));
  const at = (x: number, y: number) => ({ x: canvas.x + x, y: canvas.y + y });
  await page.mouse.move(at(430, 640).x, at(430, 640).y);
  await page.waitForTimeout(800);
  if (process.env.HERO_PROBE) {
    await page.screenshot({ path: `${OUT}/_probe.png` });
    return;
  }

  const rec = await Recorder.start(page);
  await page.waitForTimeout(300);
  const start = rec.now();
  const glide = (p: { x: number; y: number }, steps = 16) => page.mouse.move(p.x, p.y, { steps });
  const note = newSticky("ada-note", X("ADA_NOTE_SX", 500), X("ADA_NOTE_SY", 170), 10_000);

  // Ada heads for the headline while you head for the button.
  await Promise.all([
    ada.moveTo(X("ADA_A_X", 330), X("ADA_A_Y", 250), 1400),
    glide(at(X("BTN_X", 502), X("BTN_Y", 404)), 22),
  ]);
  // She leaves a note; you select the button.
  await Promise.all([
    ada.add({ ...note, data: { ...note.data, content: "Love this headline!" } }),
    page.mouse.click(at(X("BTN_X", 502), X("BTN_Y", 404)).x, at(X("BTN_X", 502), X("BTN_Y", 404)).y),
  ]);
  await page.waitForTimeout(700);
  // You recolour it while she comes over to look.
  const swatch = page.getByTestId("fill-swatch").getByRole("radio").nth(2);
  const sb = (await swatch.boundingBox())!;
  await Promise.all([
    ada.moveTo(X("ADA_B_X", 565), X("ADA_B_Y", 418), 1500),
    (async () => {
      await glide({ x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 });
      await swatch.click();
    })(),
  ]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/hero-poster.jpg`, type: "jpeg", quality: 82 });
  await page.waitForTimeout(1600);

  await rec.stop();
  await rec.encode(`${OUT}/hero.webm`, start, rec.now() - start - 0.1, 1200);
  await context.close();
});
