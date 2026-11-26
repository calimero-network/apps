// Renders public/og.png (1200×630), the link preview, in the landing page's
// style: near-black band, coral glow, the mark, the headline and a few
// transcript lines with speaker colours.
// Run: node scripts/gen-og.mjs  (needs Playwright's Chromium: `pnpm exec playwright install chromium`)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mark = readFileSync(join(ROOT, "public", "favicon.svg"), "utf8");
const inter = readFileSync(
  join(ROOT, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"),
).toString("base64");

const lines = [
  ["Eve", "#f2a20c", "0:42", "Can we ship the launch plan by Friday?"],
  ["John", "#3d7dff", "0:47", "Yes, if design signs off on the pricing page today."],
  ["Sam", "#14a86b", "0:53", "I'll take that. Sending it over after this call."],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, sans-serif; color: #f4f3f0;
  background: radial-gradient(70% 70% at 85% 10%, rgba(255,91,53,.22), transparent 60%), #0f0f11;
  display: grid; grid-template-columns: 1fr 470px; gap: 56px; padding: 72px 72px 64px; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
.brand svg { width: 48px; height: 48px; }
.copy { display: flex; flex-direction: column; justify-content: space-between; }
h1 { font-size: 64px; line-height: 1.02; letter-spacing: -.045em; font-weight: 750; margin-top: 56px; }
h1 em { font-style: normal; color: #ff5b35; }
p { font-size: 24px; line-height: 1.45; color: #a3a3ab; max-width: 30ch; }
.panel { align-self: center; background: #18181c; border: 1px solid #2a2a30; border-radius: 22px; padding: 24px;
  box-shadow: 0 40px 80px -30px rgba(0,0,0,.7); }
.head { display: flex; justify-content: space-between; align-items: center; font-weight: 650; font-size: 18px;
  padding-bottom: 18px; border-bottom: 1px solid #2a2a30; margin-bottom: 8px; }
.live { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: #f4f3f0; background: #2a2a30;
  border-radius: 999px; padding: 6px 12px; }
.live i { width: 8px; height: 8px; border-radius: 50%; background: #e5484d; }
.line { padding: 14px 0; }
.line + .line { border-top: 1px solid #222227; }
.who { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 650; margin-bottom: 6px; }
.who b { width: 10px; height: 10px; border-radius: 50%; }
.who span { color: #6e6e76; font-weight: 500; font-variant-numeric: tabular-nums; }
.text { font-size: 18px; line-height: 1.45; color: #d6d5d1; }
</style></head><body>
<div class="copy">
  <div>
    <div class="brand">${mark}<span>Sylence</span></div>
    <h1>Meeting notes that write themselves, <em>privately.</em></h1>
  </div>
  <p>Meet, Zoom and Teams. Speech becomes text on your laptop.</p>
</div>
<div class="panel">
  <div class="head"><span>Launch plan</span><span class="live"><i></i>Recording</span></div>
  ${lines
    .map(
      ([n, c, t, s]) =>
        `<div class="line"><div class="who"><b style="background:${c}"></b>${n}<span>${t}</span></div><div class="text">${s}</div></div>`,
    )
    .join("")}
</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, "public", "og.png") });
await browser.close();
console.log("wrote public/og.png");
