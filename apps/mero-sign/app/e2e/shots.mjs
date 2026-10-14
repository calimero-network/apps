#!/usr/bin/env node
/**
 * app/e2e/shots.mjs — real screenshots of the Mero Sign UI, with no node.
 *
 * Builds the harness in e2e/shots/ (which aliases only the modules that reach a
 * node), serves it over http, and photographs each scenario. The output is what
 * goes in the PR: "does this look like mero-design" is not a proposition a unit
 * test can hold, and a suite passing on a screen that still looks like the old
 * app is exactly the mistake this exists to catch.
 *
 * WHY http AND NOT file://: the page is an ES-module bundle, and a module script
 * loaded from a file:// document is blocked by the module loader's CORS rules —
 * a blank page and a console error naming neither cause nor fix.
 *
 * Usage:  node e2e/shots.mjs [--out DIR] [--viewport 1440x900] [--theme light|dark]
 *                            [--scale 2] [--only id,id] [--no-build]
 *
 * `--theme dark` saves the dark choice under the app's theme key before the
 * page loads, exactly as a returning visitor who picked dark would have it.
 * Every run also fails a scenario whose page is wider than the viewport: a
 * horizontal scrollbar on a phone is a broken layout, not a cosmetic one.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const BUILD = resolve(APP, '../data/shots-build');

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const OUT = resolve(argOf('--out') ?? resolve(APP, '../data/shots'));
const [VW, VH] = (argOf('--viewport') ?? '1440x900').split('x').map(Number);
const THEME = argOf('--theme') ?? 'light';
const SCALE = Number(argOf('--scale') ?? 2);
const ONLY = argOf('--only')?.split(',');
const BUILD_FIRST = !process.argv.includes('--no-build');
/** src/theme.ts owns this key; kept in step by hand like the scenario list. */
const THEME_KEY = 'mero-sign:theme';

// Kept in step with e2e/shots/fixtures.ts by hand: that file is TypeScript and
// this driver is plain node, so importing it would need a loader hook for a
// list of string literals. Each entry names the landmark it waits for, so a
// blank screenshot on a timer cannot pass.
const SCENARIOS = [
  ['landing', 'The front door, signed out', 'h1'],
  ['workspaces', 'Your workspaces', '[data-testid="workspace-card"]'],
  ['workspaces-empty', 'No workspaces yet', '[data-testid="workspaces-empty"]'],
  [
    'agreements',
    'Agreements in one workspace',
    '[data-testid="agreement-card"]',
  ],
  ['agreements-empty', 'No agreements yet', '[data-testid="agreements-empty"]'],
  [
    'agreements-error',
    'The node could not be reached',
    '[data-testid="list-error"]',
  ],
  ['documents', 'Documents in one agreement', '[data-testid="document-card"]'],
  [
    'documents-empty',
    'An agreement with nothing in it',
    '[data-testid="documents-empty"]',
  ],
  ['documents-upload', 'Uploading a document', '[data-testid="upload-input"]'],
  ['people', 'The roster, as an admin', '[data-testid="person-row"]'],
  ['people-member', 'The roster, as a signer', '[data-testid="person-row"]'],
  ['invite', 'Before an invitation is minted', '[data-testid="mint-invite"]'],
  [
    'invite-minted',
    'A shareable invitation link',
    '[data-testid="invite-link"]',
  ],
  ['signatures', 'The signature library', '[data-testid="signature-card"]'],
  ['signatures-empty', 'No signatures yet', '[data-testid="signatures-empty"]'],
  [
    'signatures-delete',
    'Confirming a signature delete',
    '[data-testid="confirm-delete-signature"]',
  ],
  ['connect', 'Signed out on an app route', '[data-testid="connect-cta"]'],
  [
    'not-found',
    'An address the app does not have',
    '[data-testid="not-found"]',
  ],
  ['viewer', 'A document open in the viewer', '[data-testid="pdf-page"]'],
  [
    'viewer-sign',
    'Choosing a signature',
    '[data-testid="signature-picker"]',
  ],
  ['viewer-pad', 'Drawing a signature', '[data-testid="signature-pad"]'],
  [
    'viewer-consent',
    'Consent before the first signature',
    '[data-testid="consent-dialog"]',
  ],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // pdf.js's worker is an .mjs module; served as text/plain it is refused and
  // every document fails to open.
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      // A path-BOUNDARY check, not a string prefix: `startsWith(root)` also
      // accepts a sibling whose name merely begins with the same characters.
      const target = normalize(
        join(root, url.pathname === '/' ? '/index.html' : url.pathname),
      );
      const rel = relative(root, target);
      if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
        res.writeHead(403).end('nope');
        return;
      }
      const body = await readFile(target);
      res.writeHead(200, {
        'content-type': MIME[extname(target)] ?? 'text/plain',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ server, port: server.address().port }),
    ),
  );
}

async function main() {
  if (BUILD_FIRST) {
    console.log('• building the harness');
    execFileSync(
      'pnpm',
      ['exec', 'vite', 'build', '--config', 'e2e/shots/vite.config.ts'],
      {
        cwd: APP,
        stdio: 'inherit',
      },
    );
  }
  if (!existsSync(join(BUILD, 'index.html'))) {
    throw new Error(`harness build missing at ${BUILD}`);
  }

  mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve(BUILD);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const failures = [];
  const scenarios = SCENARIOS.filter(([id]) => !ONLY || ONLY.includes(id));

  try {
    for (const [id, title, waitFor] of scenarios) {
      const page = await browser.newPage({
        viewport: { width: VW, height: VH },
        deviceScaleFactor: SCALE, // 2 by default: retina, so the type is legible
        isMobile: VW < 600,
        hasTouch: VW < 600,
      });
      await page.addInitScript(
        ([key, theme]) => {
          try {
            localStorage.setItem(key, theme);
          } catch {
            /* the scenario then shows the default, light */
          }
        },
        [THEME_KEY, THEME],
      );
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/index.html?s=${id}`, {
        waitUntil: 'load',
      });

      // Wait for the thing this scenario is ABOUT, never a fixed sleep: a blank
      // screenshot taken on a timer is the classic way a harness lies about
      // what shipped.
      try {
        await page
          .locator(waitFor)
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 });
      } catch (e) {
        failures.push(`${id}: never rendered ${waitFor}`);
        console.log(`  ✗ ${id.padEnd(18)} never rendered ${waitFor}`);
        await page.screenshot({ path: join(OUT, `${id}.png`), fullPage: true });
        await page.close();
        continue;
      }
      await page.waitForTimeout(250);

      // The hero has photographed as a blank sheet of paper TWICE: the
      // signature is a dash-offset animation, and both times the cycle happened
      // to be part-way through hiding it at the moment the shutter opened. Code
      // review cannot catch that — the component reads correctly either way —
      // and neither can "did the page render", because the paper renders fine.
      // So measure the one value that decides it, at the instant of capture.
      if (id === 'landing') {
        const offsets = await page.$$eval('.cal-lp-a-ink', (els) =>
          els.map((el) => getComputedStyle(el).strokeDashoffset),
        );
        const blank = offsets.filter((o) => parseFloat(o) !== 0);
        // Reported through `errors`, which the scenario already checks, so a
        // hidden signature reads as one ✗ line rather than a ✗ and a ✓.
        if (offsets.length === 0) {
          errors.push('no .cal-lp-a-ink in the hero — the signature is gone');
        } else if (blank.length) {
          errors.push(
            `${blank.length}/${offsets.length} signature stroke(s) hidden at capture ` +
              `(stroke-dashoffset ${blank.join(', ')}) — the hero photographs as a blank page`,
          );
        }
      }

      await page.screenshot({
        path: join(OUT, `${id}.png`),
        fullPage: id === 'landing',
      });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (overflow > 0) {
        errors.push(`the page is ${overflow}px wider than the viewport`);
      }

      if (errors.length) {
        failures.push(`${id}: ${errors[0]}`);
        console.log(`  ✗ ${id.padEnd(18)} ${errors[0]}`);
      } else {
        console.log(`  ✓ ${id.padEnd(18)} ${title}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} scenario(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${scenarios.length} screenshots in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
