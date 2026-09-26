#!/usr/bin/env node
/**
 * app/e2e/shots.mjs — real screenshots of the forum UI, with no node.
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
 *         SHOTS_CHROMIUM=/path/to/chromium node e2e/shots.mjs
 */
// From @playwright/test, not the raw `playwright` package. Two copies at
// different versions makes the test runner fail with "Playwright Test did not
// expect test.describe() to be called here" — the catalog pins @playwright/test
// and this file pinned playwright itself, so a catalog bump desynced them.
// @playwright/test re-exports chromium, so one dependency covers both uses.
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

// Kept in step with e2e/shots/fixtures.ts by hand. Duplicated rather than
// imported because that file is TypeScript and this driver is plain node —
// importing it would need a loader hook for four string literals.
// Kept in step with e2e/shots/fixtures.ts by hand. Duplicated rather than
// imported because that file is TypeScript and this driver is plain node.
//
// `click` drives the harness into a state that only exists after an
// interaction — a dropdown, a dialog, an expanded secret, a confirmation. A
// screenshot set that only shows the resting state of each page is exactly how
// a redesign ships with an unstyled modal in it.
const SCENARIOS = [
  ['teams', 'Teams — the front screen', '[data-testid="team-card"]'],
  [
    'teams-no-personal',
    'Before you have a private vault',
    '[data-testid="personal-create"]',
  ],
  ['teams-empty', 'No teams yet', '[data-testid="teams-empty"]'],
  ['teams-error', 'The node refused the list', '[data-testid="error"]'],
  [
    'teams-not-installed',
    'App not installed on this node',
    '[data-testid="not-installed"]',
  ],
  [
    'teams-menu',
    'Teams — the ⋯ menu open',
    '[data-testid="team-dropdown"]',
    { scenario: 'teams', click: '[data-testid="team-menu"]' },
  ],
  [
    'teams-invite',
    'Teams — an invitation minted',
    '[data-testid="invite-modal"]',
    {
      scenario: 'teams',
      click: '[data-testid="team-menu"]',
      then: 'text=Invite someone',
    },
  ],
  [
    'team-vaults',
    "One team's vaults, as an Admin",
    '[data-testid="vault-card"]',
  ],
  ['team-empty', 'A team with no vaults', '[data-testid="vaults-empty"]'],
  [
    'team-member',
    'The same team, as a Member',
    '[data-testid="member-notice"]',
  ],
  ['team-people', 'People and roles', '[data-testid="member-row"]'],
  [
    'team-people-member',
    'People, read-only',
    '[data-testid="read-only-roles"]',
  ],
  [
    'team-people-mismatch',
    'A role whose capabilities have not landed',
    '[data-testid="role-mismatch"]',
  ],
  [
    'team-people-confirm',
    'Confirming a demotion',
    '[data-testid="role-warning"]',
    { scenario: 'team-people', click: '[data-testid="role-change"]' },
  ],
  ['vault', "A vault's secrets", '[data-testid="secret-row"]'],
  [
    'vault-open',
    'A secret expanded, values concealed',
    '[data-testid="field-hidden"]',
    {
      scenario: 'vault',
      click: '[data-testid="secret-row"]:has-text("GitHub")',
    },
  ],
  [
    'vault-revealed',
    'One field revealed on request',
    '[data-testid="field-shown"]',
    {
      scenario: 'vault',
      click: '[data-testid="secret-row"]:has-text("GitHub")',
      then: '[data-testid="reveal"]',
    },
  ],
  [
    'vault-trash',
    'Trash, recoverable until an Admin purges it',
    '[data-testid="trash-list"]',
    { scenario: 'vault', click: '[data-testid="tab-trash"]' },
  ],
  [
    'vault-form',
    'Adding a secret',
    '[data-testid="secret-form"]',
    { scenario: 'vault', click: '[data-testid="secret-add"]' },
  ],
  ['vault-personal', 'Your private vault', '[data-testid="vault-scope"]'],
  ['vault-empty', 'A vault with no secrets', '[data-testid="secrets-empty"]'],
  [
    'vault-activity',
    'What has happened in this vault',
    '[data-testid="activity-list"]',
    { scenario: 'vault', click: '[data-testid="tab-activity"]' },
  ],
  [
    'vault-no-identity',
    'In the team, not yet in the vault',
    '[data-testid="no-identity"]',
  ],
  [
    'vault-people',
    'Who holds the key, and their devices',
    '[data-testid="vault-device"]',
    { scenario: 'vault', click: '[data-testid="tab-people"]' },
  ],
  [
    'vault-approval',
    'A new browser asking to be let in',
    '[data-testid="device-request"]',
  ],
  [
    'vault-waiting',
    'This browser, waiting for approval',
    '[data-testid="waiting-for-approval"]',
  ],
  [
    'vault-single-holder',
    'Only one browser holds the key',
    '[data-testid="single-holder"]',
  ],
  [
    'security',
    'Lock, recovery key and devices',
    '[data-testid="create-recovery"]',
  ],
  ['teams-light', 'Teams, light theme', '[data-testid="team-card"]'],
  [
    'vault-light',
    'A vault, light theme',
    '[data-testid="item-detail"]',
    {
      scenario: 'vault-light',
      click: '[data-testid="secret-row"]:has-text("GitHub")',
    },
  ],
  [
    'vault-mobile',
    'A vault on a phone: the list',
    '[data-testid="secret-row"]',
    { scenario: 'vault', viewport: { width: 390, height: 844 } },
  ],
  [
    'vault-mobile-detail',
    'A vault on a phone: one item',
    '[data-testid="item-detail"]',
    {
      scenario: 'vault',
      viewport: { width: 390, height: 844 },
      click: '[data-testid="secret-row"]:has-text("GitHub")',
    },
  ],
  ['landing', 'The front door', '[data-testid="landing"]'],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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
      // A path-BOUNDARY check, not a string prefix. `startsWith(root)` also
      // accepts a sibling directory whose name merely begins with the same
      // characters (`shots-build` vs `shots-build-secret`), which is a known
      // anti-pattern worth not copying elsewhere even where — as here — the
      // server is ephemeral, bound to 127.0.0.1, and serving a build directory.
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
  console.log('• building the harness');
  execFileSync(
    'pnpm',
    ['exec', 'vite', 'build', '--config', 'e2e/shots/vite.config.ts'],
    { cwd: APP, stdio: 'inherit' },
  );
  if (!existsSync(join(BUILD, 'index.html'))) {
    throw new Error(`harness build missing at ${BUILD}`);
  }

  mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve(BUILD);
  // `SHOTS_CHROMIUM` points at a browser that is already installed, for a
  // machine whose Chromium is not the one this Playwright version pins.
  const browser = await chromium.launch(
    process.env.SHOTS_CHROMIUM
      ? { executablePath: process.env.SHOTS_CHROMIUM }
      : {},
  );
  const failures = [];

  try {
    for (const [id, title, waitFor, drive] of SCENARIOS) {
      const page = await browser.newPage({
        viewport: drive?.viewport ?? { width: 1440, height: 900 },
        deviceScaleFactor: 2, // retina, so the text in the screenshots is legible
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(
        `http://127.0.0.1:${port}/index.html?s=${drive?.scenario ?? id}`,
        { waitUntil: 'load' },
      );

      // Drive into a post-interaction state before waiting on its landmark.
      for (const sel of [drive?.click, drive?.then].filter(Boolean)) {
        await page.locator(sel).first().click({ timeout: 15_000 });
        await page.waitForTimeout(250);
      }

      // Wait for the thing this scenario is ABOUT, not a fixed sleep: a blank
      // screenshot taken on a timer is the classic way this kind of harness lies
      // about what shipped. Each scenario names its own landmark; the call
      // screens fall back to the stage.
      await page
        .locator(waitFor)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
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
