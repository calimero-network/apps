#!/usr/bin/env node
/**
 * app/e2e/shots.mjs — real screenshots of the create-event modal, no node.
 *
 * Builds e2e/shots/ (which aliases only `hooks/useMembers` and mero-react),
 * serves it over http and photographs the modal in both themes. The dark shot is
 * the one that matters: the form's inputs and popovers used to hardcode light
 * backgrounds while the modal set `color: var(--mc-text)`, so the text you were
 * typing sat at 1.12:1 against its own field.
 *
 * WHY http AND NOT file://: the page is an ES-module bundle, and a module script
 * in a file:// document is blocked by the loader's CORS rules — blank page, and a
 * console error that names neither the cause nor the fix.
 *
 * Usage:  node e2e/shots.mjs [--out DIR] [--tag NAME]
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const BUILD = resolve(APP, "../data/shots-build");

const argOf = (f) => {
  const i = process.argv.indexOf(f);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const OUT = resolve(argOf("--out") ?? resolve(APP, "../data/shots"));
const TAG = argOf("--tag") ?? "";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serve(root) {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
      const file = rel === "/" || rel.endsWith("/") ? "/index.html" : rel;
      const abs = join(root, file);
      // Prefix-check after normalising, so `..` cannot escape the build dir.
      if (!abs.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const body = await readFile(abs);
        res.writeHead(200, {
          "Content-Type": TYPES[extname(abs)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () =>
      ok({ server, port: server.address().port }),
    );
  });
}

async function main() {
  console.log("• building the harness");
  execFileSync(
    "pnpm",
    ["exec", "vite", "build", "--config", "e2e/shots/vite.config.ts"],
    { cwd: APP, stdio: "inherit" },
  );
  if (!existsSync(join(BUILD, "index.html"))) {
    throw new Error(`harness build missing at ${BUILD}`);
  }

  mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve(BUILD);
  const browser = await chromium.launch();
  const failures = [];

  try {
    for (const theme of ["dark", "light"]) {
      const page = await browser.newPage({
        viewport: { width: 900, height: 900 },
        deviceScaleFactor: 2, // so the text in the shot is legible
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/?theme=${theme}`, {
        waitUntil: "load",
      });
      // Wait on the thing the shot is ABOUT, never a fixed sleep.
      const modal = page.locator("form").first();
      await modal.waitFor({ state: "visible", timeout: 15000 });
      // Open the date picker and the time dropdown, since those popovers were
      // the worst of it and a closed one photographs nothing.
      await page.locator('input[class*="date__input"]').first().click();
      await page.waitForTimeout(150);

      // The MODAL element, not the viewport: the shot is evidence about the
      // form, and 700px of empty page around it only makes the thing being
      // judged smaller. The date popover is positioned inside the form, so it
      // comes along.
      const name = `create-event-${theme}${TAG ? `-${TAG}` : ""}.png`;
      const card = page.locator('[class*="modal"]').first();
      const box = await card.boundingBox();
      await page.screenshot({
        path: join(OUT, name),
        // Clip rather than element-screenshot: the popover overflows the
        // modal's own box, and an element shot would cut it off.
        clip: box
          ? {
              x: Math.max(0, box.x - 8),
              y: Math.max(0, box.y - 8),
              width: box.width + 16,
              height: box.height + 16,
            }
          : undefined,
      });
      console.log(`  ${errors.length ? "✗" : "✓"} ${name}`);
      if (errors.length) failures.push(`${theme}: ${errors.join(" | ")}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // A screenshot must never silently document a broken build.
  if (failures.length) {
    console.error("\npage errors:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log(`\nwrote to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
