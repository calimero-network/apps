#!/usr/bin/env node
/**
 * app/e2e/shots.mjs — real screenshots of the call UI, with no node and no camera.
 *
 * Builds the harness in e2e/shots/ (which aliases the two hooks that need a node
 * and a webcam, and uses the production CallPage, DataDialog, CSS modules,
 * lib/slots and lib/capacity), serves it over http, and photographs each
 * scenario. The output is what goes in the PR and in SIMPLE/stream-plan.md, so
 * the layout can be reviewed without starting a stack.
 *
 * WHY http AND NOT file://: the page is an ES-module bundle, and a module script
 * loaded from a file:// document is blocked by the module loader's CORS rules —
 * you get a blank page and a console error that names neither the cause nor the
 * fix. It also keeps the harness in a secure context, so `captureStream` behaves
 * the way it does in the real app.
 *
 * Bundled Chromium is FINE here, unlike browser-call.mjs: nothing is encoded or
 * decoded, so the missing proprietary H.264 codec does not matter. The tiles are
 * canvas test patterns, deliberately synthetic — a stand-in photo of a person
 * would document nothing about the app and misrepresent what it renders.
 *
 * Usage:  node e2e/shots.mjs [--out DIR]
 */
// From @playwright/test, not the raw `playwright` package. Two copies at
// different versions makes the test runner fail with "Playwright Test did not
// expect test.describe() to be called here" — the catalog pins @playwright/test
// and this file pinned playwright itself, so a catalog bump desynced them.
// @playwright/test re-exports chromium, so one dependency covers both uses.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const BUILD = resolve(APP, "../data/shots-build");

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const OUT = resolve(argOf("--out") ?? resolve(APP, "../data/shots"));

// Kept in step with e2e/shots/fixtures.ts by hand. Duplicated rather than
// imported because that file is TypeScript and this driver is plain node —
// importing it would need a loader hook for four string literals.
const SCENARIOS = [
  ["streams", "Your streams", '[data-testid="stream-row"]'],
  ["streams-empty", "No streams yet", '[data-testid="open-join"]'],
  ["rooms", "Rooms inside one stream", '[data-testid="room-row"]'],
  ["invite", "An invitation", '[data-testid="invite-box"]'],
  ["idle", "Joined, nobody broadcasting yet"],
  ["solo", "One broadcaster (you)"],
  ["two", "Two broadcasters"],
  ["slots-full", "Every slot in use, you hold one"],
  ["spectator", "Slots full — you are a spectator"],
  ["yielded", "You lost the race for the last slot"],
  ["people", "Your nickname, and who is here", '[data-testid="people-dialog"]'],
  ["dialog", "See more data", '[data-testid="data-dialog"]'],
  ["light", "Light theme"],
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".json": "application/json",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      // A path-BOUNDARY check, not a string prefix. `startsWith(root)` also
      // accepts a sibling directory whose name merely begins with the same
      // characters (`shots-build` vs `shots-build-secret`), which is a known
      // anti-pattern worth not copying elsewhere even where — as here — the
      // server is ephemeral, bound to 127.0.0.1, and serving a build directory.
      const target = normalize(
        join(root, url.pathname === "/" ? "/index.html" : url.pathname),
      );
      const rel = relative(root, target);
      if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
        res.writeHead(403).end("nope");
        return;
      }
      const body = await readFile(target);
      res.writeHead(200, {
        "content-type": MIME[extname(target)] ?? "text/plain",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () =>
      ok({ server, port: server.address().port }),
    ),
  );
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
    for (const [id, title, waitFor] of SCENARIOS) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2, // retina, so the text in the screenshots is legible
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/index.html?s=${id}`, {
        waitUntil: "load",
      });

      // Wait for the thing this scenario is ABOUT, not a fixed sleep: a blank
      // screenshot taken on a timer is the classic way this kind of harness lies
      // about what shipped. Each scenario names its own landmark; the call
      // screens fall back to the stage.
      await page
        .locator(waitFor ?? '[data-testid="stage"]')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      // Two rAFs' worth: the canvas patterns are painted on rAF, and the first
      // frame lands after mount.
      await page.waitForTimeout(600);

      const shot = join(OUT, `${id}.png`);
      await page.screenshot({ path: shot });

      // A page that threw is a page whose screenshot documents a broken build.
      if (errors.length) {
        failures.push(`${id}: ${errors[0]}`);
        console.log(`  ✗ ${id.padEnd(11)} ${errors[0]}`);
      } else {
        console.log(`  ✓ ${id.padEnd(11)} ${title}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} scenario(s) threw:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${SCENARIOS.length} screenshots in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
