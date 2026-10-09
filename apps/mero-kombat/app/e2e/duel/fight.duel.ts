/**
 * A recorded fight between two nodes — see playwright.duel.config.ts.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { defaultLogin, rig } from "@calimero-apps/e2e-node/journey";
import { acceptInvite, brawl, createArena, mintInvite, status, takeCorner } from "../arena";

const SIZE = { width: 1440, height: 900 };
const ROUND_LIMIT_MS = Number(process.env["DUEL_LIMIT_MS"]) || 6 * 60_000;

test("two nodes fight a full match, side by side", async ({ browser }, info) => {
  const state = rig();
  const [n1, n2] = state.nodes;
  if (!n1 || !n2) throw new Error("the duel needs two nodes");
  const out = path.join(info.project.outputDir, "..", "duel");
  mkdirSync(out, { recursive: true });

  // Setup — logins, the invitation, the corners — happens in browsers that are
  // NOT recorded. The fight is then filmed in fresh browsers carrying the same
  // sessions, so both recordings start together at the bell.
  const setup = () => browser.newContext({ viewport: SIZE, permissions: ["clipboard-read", "clipboard-write"] });
  const sa = await setup();
  const sb = await setup();
  const pa = await sa.newPage();
  const pb = await sb.newPage();
  const actor = (page: Page, node: typeof n1, name: "alice" | "bob") => ({ name, page, node, run: "duel" });

  // ── node 1: log in, open an arena, mint an invitation ──────────────────
  await pa.goto("/play");
  await defaultLogin(actor(pa, n1, "alice"));
  await createArena(pa);
  const link = await mintInvite(pa);

  // ── node 2: log in, redeem it ──────────────────────────────────────────
  await pb.goto("/play");
  await defaultLogin(actor(pb, n2, "bob"));
  await acceptInvite(pb, link);

  // ── corners ────────────────────────────────────────────────────────────
  await takeCorner(pa, "p1", "Alice", "kinetic");
  await takeCorner(pb, "p2", "Bob", "inferno");

  const film = async (session: Awaited<ReturnType<typeof sa.storageState>>, label: string) => {
    const context = await browser.newContext({
      viewport: SIZE,
      storageState: session,
      recordVideo: { dir: out, size: SIZE },
    });
    const page = await context.newPage();
    const born = Date.now();
    await page.goto("/play");
    await page.locator("canvas.arena-canvas").waitFor({ timeout: 90_000 });
    // Which screen is which, burned into the recording.
    await page.evaluate((text) => {
      const tag = document.createElement("div");
      tag.textContent = text;
      tag.style.cssText =
        "position:fixed;left:16px;bottom:16px;z-index:99;padding:8px 14px;border-radius:10px;" +
        "background:#131215;color:#a5ff11;font:700 18px ui-monospace,Menlo,monospace;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.35)";
      document.body.appendChild(tag);
    }, label);
    return { context, page, born };
  };
  const sessions = [await sa.storageState(), await sb.storageState()] as const;
  await sa.close();
  await sb.close();
  const a = await film(sessions[0], `NODE 1 · ALICE · ${n1.url.replace("http://", "")}`);
  const b = await film(sessions[1], `NODE 2 · BOB · ${n2.url.replace("http://", "")}`);

  // Both screens see both fighters live before the bell.
  for (const p of [a.page, b.page]) {
    await expect(status(p)).toContainText("live", { timeout: 120_000 });
    await p.locator("canvas.arena-canvas").click();
  }
  const bell = Date.now();

  // ── the fight ──────────────────────────────────────────────────────────
  let over = false;
  const watch = (async () => {
    while (!over && Date.now() - bell < ROUND_LIMIT_MS) {
      const s = await status(a.page).innerText().catch(() => "");
      if (s.includes("Match over")) over = true;
      else await new Promise((r) => setTimeout(r, 500));
    }
    over = true;
  })();
  await Promise.all([brawl(a.page, "p1", () => over), brawl(b.page, "p2", () => over), watch]);

  // Let the winner's banner and the final tallies settle on both screens.
  await expect(status(b.page)).toContainText("Match over", { timeout: 60_000 });
  await a.page.waitForTimeout(6_000);

  const tx = await a.page.getByTestId("arena-tx").innerText();
  console.log(`[duel] match over — ${tx} transactions in the arena`);

  const videoA = await a.page.video()?.path();
  const videoB = await b.page.video()?.path();
  await a.context.close();
  await b.context.close();
  if (!videoA || !videoB) throw new Error("no recordings");

  // ── stitch: from just before the bell, left = node 1, right = node 2 ──
  const target = path.join(out, "duel.mp4");
  const from = (born: number) => Math.max(0, (bell - born) / 1000 - 3).toFixed(2);
  execFileSync("ffmpeg", [
    "-y",
    "-ss", from(a.born), "-i", videoA,
    "-ss", from(b.born), "-i", videoB,
    "-filter_complex",
    "[0:v]scale=1280:800,setsar=1[l];[1:v]scale=1280:800,setsar=1[r];[l][r]hstack=inputs=2,format=yuv420p[v]",
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
    "-shortest",
    target,
  ], { stdio: "inherit" });
  console.log(`[duel] wrote ${target}`);
});
