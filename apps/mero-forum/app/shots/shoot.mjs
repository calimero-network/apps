// Screenshots the real pages against the mocked data layer.
// Run: node shots/shoot.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const PORT = 5199;
mkdirSync(OUT, { recursive: true });

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--config", join(HERE, "vite.config.ts"), "--port", String(PORT), "--strictPort"],
  { cwd: join(HERE, ".."), stdio: "inherit" },
);
const stop = () => vite.kill("SIGTERM");
process.on("exit", stop);

await new Promise((r) => setTimeout(r, 3500));

const browser = await chromium.launch();
try {
  for (const [name, path, height] of [
    ["feed", "/", 900],
    ["post", "/p/p1", 900],
  ]) {
    const page = await browser.newPage({ viewport: { width: 900, height }, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log("wrote", join(OUT, `${name}.png`));
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
