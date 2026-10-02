/**
 * The runner: opens the app once per identity, drives the matrix's phases in
 * order across them, and fails on any row whose outcome is not the one its
 * mode expects. Writes every row to the JSON report either way.
 *
 * Identities and origins (one origin per identity, CHAT-ACCOUNT-RUN.md; each is
 * also its own browser context, so no storage is shared):
 *   node     http://127.0.0.1:5190   the owner node, with an app token
 *   account  http://localhost:5190   account A, minted offline, no relay yet
 *   second   http://localhost:5190   account B, in its own context
 *
 * Credentials are seeded the way the real flows leave them, so the page boots
 * already connected: a node login's token bundle in localStorage, an account's
 * delegated connection in sessionStorage. The Cloud tab's wallet round trip is
 * not under test here.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Mode, Row } from '../src/conformance/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const RIG_DIR = resolve(HERE, '../../rig');
const RUN_DIR = resolve(RIG_DIR, '.state/run');
const RIG_JSON = process.env['CONFORMANCE_RIG'] ?? resolve(RUN_DIR, 'rig.json');
const REPORT = process.env['CONFORMANCE_REPORT'] ?? resolve(HERE, '../test-results/conformance-report.json');
const APP = process.env['CONFORMANCE_APP_PORT'] ?? '5190';

interface Credential {
  account: string;
  credential: string;
  deviceSecret: string;
}
interface Rig {
  ownerUrl: string;
  ingressUrl: string;
  cloudUrl: string;
  applicationId: string;
  namespaceId: string;
  /** The 0.0.1 bundle the node upgrades to (same package, same application id). */
  mpkV2: string;
  relayAccount: string;
  ownerToken: { access_token: string; refresh_token: string };
  accounts: { a: Credential; b: Credential };
  invitations: { a: unknown; b: unknown };
}

const rig = JSON.parse(readFileSync(RIG_JSON, 'utf8')) as Rig;
const allRows: Row[] = [];
const rigRows: Row[] = [];

async function openNode(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ ownerUrl, token }) => {
      if (sessionStorage.getItem('conformance.seeded')) return;
      sessionStorage.setItem('conformance.seeded', '1');
      localStorage.setItem('mero-tokens', JSON.stringify({ ...token, expires_at: Date.now() + 3_600_000 }));
      localStorage.setItem('mero:node_url', ownerUrl);
      localStorage.setItem('mero:token_node_url', ownerUrl);
    },
    { ownerUrl: rig.ownerUrl, token: { access_token: rig.ownerToken.access_token, refresh_token: rig.ownerToken.refresh_token } },
  );
  const page = await context.newPage();
  wire(page, 'node');
  await page.goto(`http://127.0.0.1:${APP}/?session=primary&run=node`);
  await waitReady(page, 'node');
  return page;
}

async function openAccount(browser: Browser, who: 'a' | 'b', session: 'primary' | 'second', run: Mode): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ cred }) => {
      if (sessionStorage.getItem('conformance.seeded')) return;
      sessionStorage.setItem('conformance.seeded', '1');
      // What enrolment leaves: an account and a certified device, and no relay
      // yet. The join is how an account gets one.
      sessionStorage.setItem('calimero.delegated.connection', JSON.stringify({ ...cred, relayUrl: null }));
    },
    { cred: rig.accounts[who] },
  );
  const page = await context.newPage();
  wire(page, `account-${who}`);
  const q = new URLSearchParams({ session, run, cloud: rig.cloudUrl });
  await page.goto(`http://localhost:${APP}/?${q}`);
  await waitReady(page, 'account');
  return page;
}

/** Page console errors into the test log, so a failing row's cause is visible. */
function wire(page: Page, label: string) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${label}] ${m.type()}: ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', (e) => console.log(`[${label}] pageerror: ${e.message}`));
}

async function waitReady(page: Page, mode: Mode) {
  await page.waitForFunction((m) => window.__conformance?.ready === true && window.__conformance.mode === m, mode, { timeout: 60_000 });
}

async function phase<T>(page: Page, name: string, input?: unknown): Promise<T> {
  return (await page.evaluate(([n, i]) => window.__conformance!.run(n as string, i), [name, input] as const)) as T;
}

async function rowsOf(page: Page): Promise<Row[]> {
  return page.evaluate(() => [...(window.__conformance?.rows ?? [])]);
}

/**
 * A rig step between phases, recorded as a row so the report says it happened.
 * Resolves with what the step printed, or null when it failed.
 */
function rigStep(run: Mode, name: string, fn: () => string | Buffer | void): string | null {
  const t0 = Date.now();
  try {
    const out = String(fn() ?? '').trim();
    rigRows.push({ name: `Rig / ${name}`, area: 'Rig', run, mode: run, session: 'primary', expected: 'ok', actual: 'ok', pass: true, ...(out ? { detail: out.slice(0, 160) } : {}), ms: Date.now() - t0 });
    return out;
  } catch (e) {
    const error = String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 600);
    rigRows.push({ name: `Rig / ${name}`, area: 'Rig', run, mode: run, session: 'primary', expected: 'ok', actual: 'error', pass: false, error, ms: Date.now() - t0 });
    return null;
  }
}

interface Start {
  namespaceId: string | null;
  namespaceIsRig: boolean;
}

async function runMatrix(primary: Page, second: Page, run: Mode) {
  const start = await phase<Start>(primary, 'p:start', {
    applicationId: rig.applicationId,
    rigNamespaceId: rig.namespaceId,
    rigInvitation: rig.invitations.a,
  });
  if (run === 'node' && start.namespaceId && !start.namespaceIsRig) {
    // What enabling HA does for a node's namespace: seat the relay in it as a
    // RelayTee, before any invitation exists. An account's namespace has its
    // relay from the founding (the relay seats itself).
    rigStep(run, 'relay fleet-joins the node\'s namespace as a RelayTee', () => {
      execFileSync('python3', [resolve(RIG_DIR, 'rig.py'), 'relay-join', RUN_DIR, start.namespaceId!], { stdio: 'pipe' });
    });
  }
  const { invitation, presence } = await phase<{ invitation: unknown; presence: string | null }>(primary, 'p:invite');
  const joinInput = { start, invitation, primaryPresence: presence };
  const joined = await phase<{ account: string | null; myAccount: string | null; eventMarker: string | null; presence: string | null }>(second, 's:join', joinInput);
  const members = await phase<{ eventMarker: string }>(primary, 'p:members', {
    secondAccount: joined.account,
    secondMyAccount: joined.myAccount,
    secondEventMarker: joined.eventMarker,
    secondPresence: joined.presence,
  });
  // A node installs the next version itself; an account has no form of either
  // the install or the upgrade, and is refused both by name (p:upgrade).
  let target = rig.applicationId;
  if (run === 'node') {
    const installed = rigStep(run, 'the node installs scaffolding-e2e 0.0.1', () =>
      execFileSync('python3', [resolve(RIG_DIR, 'rig.py'), 'install', RUN_DIR, rig.ownerUrl, rig.mpkV2], { stdio: 'pipe' }));
    if (installed) target = installed;
  }
  const { upgraded } = await phase<{ upgraded: boolean }>(primary, 'p:upgrade', { targetApplicationId: target });
  if (upgraded) await phase(second, 's:upgraded', joinInput);
  await phase(second, 's:leave', { ...joinInput, primaryEventMarker: members?.eventMarker ?? null });
  await phase(primary, 'p:teardown');
  allRows.push(...(await rowsOf(primary)), ...(await rowsOf(second)));
}

function writeReport() {
  const rows = [...rigRows, ...allRows];
  const failed = rows.filter((r) => !r.pass);
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rig: { ownerUrl: rig.ownerUrl, ingressUrl: rig.ingressUrl, applicationId: rig.applicationId, namespaceId: rig.namespaceId },
        summary: { rows: rows.length, passed: rows.length - failed.length, failed: failed.length },
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nconformance report: ${REPORT}`);
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.run.padEnd(7)} ${r.mode.padEnd(7)} ${r.name}  [expected ${r.expected}, got ${r.actual}, ${r.ms} ms]${r.pass ? '' : `  ${r.error ?? ''}`}`);
  }
  return failed;
}

test.describe.serial('conformance', () => {
  test.afterAll(() => {
    writeReport();
  });

  // The account run goes first. The node run ends by installing the 0.0.1
  // bundle, and a same-package bundle installs under the SAME application id
  // (hash of package and signer), so after it that id names 0.0.1 on the node,
  // and on the relay once it fetches it: an account run after it would found
  // its namespace on an application that is no longer the one it names.
  test('account run: account A through the relay, with account B as the second session', async ({ browser }) => {
    const primary = await openAccount(browser, 'a', 'primary', 'account');
    const second = await openAccount(browser, 'b', 'second', 'account');
    await runMatrix(primary, second, 'account');
  });

  test('node run: the owner node, with account B as the second session', async ({ browser }) => {
    const primary = await openNode(browser);
    const second = await openAccount(browser, 'b', 'second', 'node');
    await runMatrix(primary, second, 'node');
  });

  test('every row is what its mode expects', () => {
    const failed = [...rigRows, ...allRows].filter((r) => !r.pass);
    expect(
      failed.map((r) => `${r.run}/${r.mode} ${r.name}: expected ${r.expected}, got ${r.actual}: ${r.error ?? ''}`),
    ).toEqual([]);
  });
});
