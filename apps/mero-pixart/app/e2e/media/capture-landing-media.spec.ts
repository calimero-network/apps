import { test, type CDPSession, type Page } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openEditor, waitForCalls, TEST_MEMBER } from "../support/mocks";

/**
 * Records the landing page's showcase clip from the REAL editor:
 *
 *   pnpm landing:media   → public/landing/demo.webm + demo-poster.jpg
 *
 * No merod and no Docker. The editor runs against the mocked node in
 * e2e/support/mocks.ts, the same one the `mocked` Playwright project uses. Every
 * pixel on screen is the app's own compositor: the project is the bundled
 * "Aurora Edition" showcase, loaded through File ▸ Open showcase exactly as a
 * user would, and every edit below is a real click or drag on the real UI.
 *
 * The one stand-in is the teammate, Ada. A second member needs a second node, so
 * she is added to the mock's `get_members` / `get_cursors` replies, and her
 * cursor is stamped fresh on every read so the overlay does not age it out.
 *
 * The chapters are padded to fixed lengths, so the chapter times in
 * scripts/landing/apps.config.mjs (`'mero-pixart'` → overview.showcase) stay
 * right on every re-run. Change one, change the other.
 */
const CHAPTERS = [
  { id: "open", seconds: 3.5 },
  { id: "adjust", seconds: 5 },
  { id: "blend", seconds: 3.5 },
  { id: "layers", seconds: 3.5 },
  { id: "paint", seconds: 5 },
] as const;

const OUT = process.env.MEDIA_OUT ?? "public/landing";
const FPS = 25;
const VIEW = { width: 1440, height: 900 };

/**
 * An ffmpeg that can write VP8. Homebrew's ffmpeg ships without libvpx, so
 * prefer the one Playwright downloads for its own video recording, which has it.
 */
function findFfmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const caches = [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
    "/opt/pw-browsers",
  ];
  for (const dir of caches) {
    if (!existsSync(dir)) continue;
    for (const sub of readdirSync(dir).filter((d) => d.startsWith("ffmpeg")).sort().reverse()) {
      for (const bin of ["ffmpeg-mac", "ffmpeg-linux", "ffmpeg"]) {
        const p = join(dir, sub, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  const which = spawnSync("sh", ["-c", "command -v ffmpeg"], { encoding: "utf8" }).stdout.trim();
  if (which) return which;
  throw new Error("no ffmpeg found; set FFMPEG to one built with libvpx");
}

const ADA = { id: "ada-teammate", username: "Ada", avatar: null, joinedAt: 1001 };

/**
 * Chrome's screencast, not Playwright's `recordVideo` (1x, low fixed bitrate).
 * Frames arrive only on repaint, so each is held until the next when the clip is
 * laid out at a constant rate.
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
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    return rec;
  }

  now() {
    return this.frames.length ? Date.now() / 1000 - this.frames[0].t : 0;
  }

  async stop() {
    await this.cdp.send("Page.stopScreencast");
  }

  async encode(path: string, from: number, seconds: number) {
    const t0 = this.frames[0].t + from;
    const ff = spawn(findFfmpeg(), [
      "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", "scale=1280:-2", "-an",
      "-c:v", "libvpx", "-b:v", "900k", "-crf", "12", "-qmin", "4", "-qmax", "40",
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
        'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;left:-40px;top:-40px;width:24px;height:24px;margin:-3px 0 0 -4px;z-index:2147483647;" +
        "pointer-events:none;transition:transform .12s ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));" +
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

/** Ada, added to the mock node's roster and presence. */
async function addAda(page: Page) {
  // Registered after mockNode's handler, so it is consulted first; everything
  // that is not about members or cursors falls through to the shared mock.
  await page.route("**/jsonrpc", async (route) => {
    const body = route.request().postDataJSON() as { params?: { method?: string } };
    const method = body?.params?.method;
    let value: unknown;
    if (method === "get_members") value = [TEST_MEMBER, ADA];
    else if (method === "get_cursors") value = [{ identity: ADA.id, x: 1010, y: 1180, updatedAt: Date.now() + 120_000 }];
    else return route.fallback();
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: bytes, logs: [] } }),
    });
  });
}

/** Drag a range input's thumb to `fraction` of its track, visibly. */
async function slide(page: Page, testId: string, fraction: number) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width / 2;
  const to = box.x + box.width * fraction;
  await page.mouse.move(from, y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(to, y, { steps: 30 });
  await page.mouse.up();
}

const row = (page: Page, name: string) =>
  page.locator("[data-testid^='layer-row-']").filter({ hasText: name }).first();

test("record the showcase clip", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.setViewportSize(VIEW);
  await showPointer(page);
  const log = await openEditor(page, { doc: { name: "Aurora launch poster" } });
  await addAda(page);

  // Load the showcase BEFORE the clip starts: the story opens on a finished
  // project, not on 23 layers arriving one by one.
  await page.getByRole("button", { name: "File" }).click();
  await page.getByTestId("menu-open-showcase").click();
  await page.getByTestId("showcase-open-aurora").click();
  await waitForCalls(log, "move_layers", 1, 30_000);
  await page.getByTestId("collapse-all-groups").click();
  for (let i = 0; i < 2; i++) await page.getByTitle("Zoom out").first().click();
  // Room for Adjustments AND Layers in one column.
  await page.getByRole("button", { name: "Collapse Navigator" }).click();
  // Ada's cursor comes from `get_cursors` at load; reload the members/cursors
  // the way the app does on entry.
  await page.waitForTimeout(1500);

  const rec = await Recorder.start(page);
  await page.waitForTimeout(300);
  const clipStart = rec.now();
  let chapterEnd = clipStart;
  const chapter = async (i: number, body: () => Promise<void>) => {
    chapterEnd += CHAPTERS[i].seconds;
    await body();
    const left = chapterEnd - rec.now();
    if (left < 0) throw new Error(`chapter ${CHAPTERS[i].id} overran by ${(-left).toFixed(2)}s`);
    await page.waitForTimeout(left * 1000);
  };

  // 0 — the project, open, with Ada in it.
  await chapter(0, async () => {
    // The poster: the finished project with Ada in it, the frame the clip opens on.
    await page.screenshot({ path: `${OUT}/demo-poster.jpg`, type: "jpeg", quality: 78 });
    await page.mouse.move(700, 450, { steps: 10 });
  });

  // 1 — a non-destructive adjustment on the backdrop: the whole night sky
  //     shifts hue, live, and the pixels underneath are never rewritten.
  await chapter(1, async () => {
    await page.getByRole("button", { name: "Expand folder Background" }).click();
    await row(page, "Night").click();
    await slide(page, "adjust-hue", 0.8);
    await slide(page, "adjust-saturation", 0.85);
  });

  // 2 — another layer's blend mode, from the layer panel.
  const blend = () => page.locator("select").filter({ has: page.locator("option[value='difference']") }).first();
  await chapter(2, async () => {
    await page.getByRole("button", { name: "Expand folder Aurora" }).click();
    await row(page, "Ribbon · core").click();
    // Multiply over a night sky darkens the brightest ribbon to nothing.
    await blend().selectOption("multiply");
    await page.waitForTimeout(1200);
    await blend().selectOption("screen");
  });

  // 3 — a whole folder hidden and shown again, pixels untouched.
  await chapter(3, async () => {
    const product = row(page, "Product");
    await product.getByRole("button", { name: "Hide layer" }).click();
    await page.waitForTimeout(1100);
    await product.getByRole("button", { name: /Show layer/ }).click();
  });

  // 4 — a new raster layer, and a brush stroke on it.
  await chapter(4, async () => {
    await page.getByRole("button", { name: "New raster layer" }).click();
    await page.getByTestId("tool-brush").click();
    const c = (await page.getByTestId("main-canvas").boundingBox())!;
    // Inside the poster, which sits in the left of a zoomed-out canvas.
    const x0 = c.x + c.width * 0.12;
    const y0 = c.y + c.height * 0.72;
    await page.mouse.move(x0, y0, { steps: 6 });
    await page.mouse.down();
    for (let k = 1; k <= 40; k++) {
      const x = x0 + (c.width * 0.3 * k) / 40;
      const y = y0 - Math.sin((k / 40) * Math.PI) * c.height * 0.12;
      await page.mouse.move(x, y, { steps: 2 });
    }
    await page.mouse.up();
  });

  await rec.stop();
  const total = CHAPTERS.reduce((s, c) => s + c.seconds, 0);
  await rec.encode(`${OUT}/demo.webm`, clipStart, total);


  if (errors.length) throw new Error(`page errors during recording:\n${errors.join("\n")}`);
});
