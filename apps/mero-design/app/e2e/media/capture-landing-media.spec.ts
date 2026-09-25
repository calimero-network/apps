import { test, type Page } from "@playwright/test";
import { existsSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { openBoard, TEST_MEMBER } from "../fixtures/board";

const OUT = process.env.MEDIA_OUT ?? "public/landing";
const load = (f: string) =>
  JSON.parse(readFileSync(new URL(`../../src/starter/${f}`, import.meta.url), "utf8"));
const web = load("starter-project.json");
const deck = load("starter-presentation.json");

const TEAMMATE = { id: "teammate-ada", username: "Ada", avatar: null, joinedAt: 2000 };

/** A second member, with her cursor parked at a screen position. */
const withTeammate = (at: { x: number; y: number }) => ({
  members: [TEST_MEMBER, TEAMMATE],
  cursors: () => [{ identity: TEAMMATE.id, ...at, updatedAt: Date.now() }],
});

async function zoomOut(page: Page, times: number) {
  const minus = page.getByRole("button", { name: "−", exact: true });
  for (let i = 0; i < times; i++) await minus.click();
}

async function pan(page: Page, dx: number, dy: number) {
  await page.keyboard.press("h");
  const box = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("v");
}

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });

test("canvas", async ({ page }) => {
  await openBoard(page, { elements: web.elements, comments: web.comments, tauri: false, ...withTeammate({ x: 1010, y: 360 }) });
  await zoomOut(page, 4);
  await pan(page, -250, -40);
  // Select the sign-in button so the properties panel has something to show.
  await page.mouse.click(Number(process.env.SEL_X ?? 560), Number(process.env.SEL_Y ?? 520));
  await page.waitForTimeout(1200);
  await shot(page, "canvas");
});

test("screens", async ({ page }) => {
  await openBoard(page, { elements: web.elements, comments: web.comments, tauri: false });
  await zoomOut(page, 5);
  await pan(page, -300, -60);
  await page.getByRole("button", { name: "Screens", exact: true }).click();
  await page.waitForTimeout(1200);
  await shot(page, "screens");
});

test("present", async ({ page }) => {
  await openBoard(page, { elements: deck.elements, comments: deck.comments, tauri: false });
  await page.getByRole("button", { name: /Present/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, "present");
});

/**
 * The hero clip: real edits on the starter board, recorded by Playwright.
 * Recorded at 1x — a video at 2x doubles the file for detail nobody sees in motion.
 */
test("demo video", async ({ browser }) => {
  const size = { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: OUT, size } });
  const page = await context.newPage();
  // Recordings do not include the OS pointer, so draw one that follows the mouse.
  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;z-index:2147483647;" +
        "pointer-events:none;transition:transform .08s;background:no-repeat center/contain url(\"data:image/svg+xml," +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>') +
        "\")";
      document.body.appendChild(dot);
      const move = (e: MouseEvent) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; };
      window.addEventListener("mousemove", move, true);
      window.addEventListener("mousedown", () => { dot.style.transform = "scale(.8)"; }, true);
      window.addEventListener("mouseup", () => { dot.style.transform = ""; }, true);
    });
  });
  const recordingStarted = Date.now();
  await openBoard(page, { elements: web.elements, comments: web.comments, tauri: false, ...withTeammate({ x: 900, y: 330 }) });
  await zoomOut(page, 4);
  await pan(page, -200, -200);
  await page.waitForTimeout(800);

  // Everything before this point is page load and setup; the clip starts here.
  const trimSeconds = (Date.now() - recordingStarted) / 1000;
  const canvas = (await page.locator('[data-testid="fabric-canvas"]').boundingBox())!;
  const at = (x: number, y: number) => ({ x: canvas.x + x, y: canvas.y + y });
  const glide = (p: { x: number; y: number }) => page.mouse.move(p.x, p.y, { steps: 20 });
  const X = (k: string, d: number) => Number(process.env[k] ?? d);

  // A sticky note in the empty space under the sign-in screen.
  await page.getByTestId("tool-sticky").click();
  const note = at(X("NOTE_X", 250), X("NOTE_Y", 520));
  await glide(note);
  await page.mouse.click(note.x, note.y);
  await page.keyboard.type("Make the CTA pop", { delay: 70 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // An arrow from the note up to the sign-in button.
  await page.getByTestId("tool-arrow").click();
  const from = at(X("ARROW_X1", 255), X("ARROW_Y1", 470));
  const to = at(X("ARROW_X2", 450), X("ARROW_Y2", 268));
  await glide(from);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  // Select the button and recolour it from the quick swatches.
  await page.getByTestId("tool-select").click();
  const btn = at(X("BTN_X", 480), X("BTN_Y", 247));
  await glide(btn);
  await page.mouse.click(btn.x, btn.y);
  await page.waitForTimeout(700);
  const swatch = page.getByTestId("fill-swatch").getByRole("radio").nth(2);
  const sb = (await swatch.boundingBox())!;
  await glide({ x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 });
  await swatch.click();
  await page.waitForTimeout(1800);
  // The finished state doubles as the poster, so the section says the same thing before it plays.
  await page.screenshot({ path: `${OUT}/demo-poster.jpg`, type: "jpeg", quality: 80 });

  const video = page.video()!;
  await context.close();
  const raw = await video.path();
  // Cut the setup off the front with Playwright's bundled ffmpeg (VP8 only, which
  // is what the recording already is). Without it, keep the untrimmed recording.
  const ffmpeg = process.env.FFMPEG ?? "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux";
  if (existsSync(ffmpeg)) {
    const r = spawnSync(ffmpeg, [
      "-y", "-ss", trimSeconds.toFixed(2), "-i", raw,
      "-an", "-c:v", "libvpx", "-b:v", "1200k", "-crf", "8", `${OUT}/demo.webm`,
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
    rmSync(raw);
  } else {
    renameSync(raw, `${OUT}/demo.webm`);
  }
});
