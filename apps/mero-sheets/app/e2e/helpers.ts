import type { Browser, Page } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, '..', '.playwright-data', 'pw-state.json');

// App-agnostic post-auth route — read from studio.config.json so this
// infra file is identical across the foundation and every generated app
// (no per-app patching). e.g. the spreadsheet app → its APP_ROUTE.
function appRoute(): string {
  try {
    const cfgPath = path.resolve(__dirname, '..', '..', 'studio.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    return cfg?.metadata?.route || '/';
  } catch {
    return '/';
  }
}

interface NodeState {
  name: string;
  adminUrl: string;
  appId: string;
  accessToken: string;
  refreshToken: string;
}

interface SetupState {
  pids: number[];
  nodes: NodeState[];
}

function loadState(): SetupState {
  if (!existsSync(STATE_FILE)) {
    throw new Error('No setup state found. Did global-setup run?');
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

/** Get node state by index (0 = node 1, 1 = node 2). */
export function getNode(index: number): NodeState {
  const state = loadState();
  if (index >= state.nodes.length) {
    throw new Error(`Node ${index} not found. Only ${state.nodes.length} nodes available.`);
  }
  return state.nodes[index];
}

/**
 * Navigate to the app with auth tokens in the URL hash for a specific node.
 * MeroProvider's parseAuthCallback picks these up automatically.
 */
export async function loginViaHash(page: Page, nodeIndex = 0) {
  const node = getNode(nodeIndex);
  // ⚠️ Seed `mero:node_url` FIRST. mero-react (>=6) will not adopt a callback
  // bundle from a node it cannot trust, and its rule needs either a node this
  // browser context already logged into, or `allowedNodeUrls`. A fresh
  // Playwright context has neither, so without this the provider logs "OAuth
  // callback node_url is not trusted" and silently drops the tokens — the app
  // never leaves /login and waitForURL below times out. This is what an in-app
  // login's connectToNode would have done. (Matches apps/kv-store.)
  await page.addInitScript(
    ([key, url]) => window.localStorage.setItem(key, url),
    ['mero:node_url', node.adminUrl] as const,
  );
  const hash = new URLSearchParams({
    access_token: node.accessToken,
    refresh_token: node.refreshToken,
    node_url: node.adminUrl,
    application_id: node.appId,
  }).toString();

  await page.goto(`/#${hash}`);
  await page.waitForURL(`**${appRoute()}`, { timeout: 30_000 });
}

/** Clear all mero auth state. */
export async function clearAuth(page: Page) {
  try {
    const url = page.url();
    if (url === 'about:blank' || !url.startsWith('http')) return;
    await page.evaluate(() => {
      [
        // mero-js v2 stores the token as a single JSON blob under `mero-tokens`
        // — clearing it is what actually logs the test session out. The `mero:*`
        // keys hold node_url / application_id / context (still used).
        'mero-tokens',
        'mero:access_token', 'mero:refresh_token', 'mero:expires_at',
        'mero:node_url', 'mero:application_id', 'mero:context_id',
        'mero:context_identity',
        'pending-invitation',
      ].forEach((k) => localStorage.removeItem(k));
    });
  } catch { /* page may be closed */ }
}

// ── Seeding: workbooks, cells and members, through the real UI ──────────────

/** The grid cell at a row and column (both from 0). */
export const cell = (page: Page, row: number, col: number) =>
  page.locator(`[data-testid="item-cell"][data-row="${row}"][data-col="${col}"]`);

/** Answers the "what should we call you" prompt a new member gets, if shown. */
export async function chooseNickname(page: Page, name: string) {
  const nick = page.getByTestId('field-nickname');
  if (await nick.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    await nick.fill(name);
    await nick.press('Enter');
  }
}

/** Logs in to a node, creates a workbook there and waits for its grid. */
export async function openNewWorkbook(
  page: Page,
  { node = 0, name = 'Test workbook', nickname = 'Owner' }: { node?: number; name?: string; nickname?: string } = {},
) {
  await loginViaHash(page, node);
  await page.getByTestId('field-name').fill(name);
  await page.getByTestId('action-init_project').click();
  await chooseNickname(page, nickname);
  await cell(page, 0, 0).waitFor({ timeout: 60_000 });
}

/** Selects a cell and types a value or formula into it, as a person would. */
export async function enterCell(page: Page, row: number, col: number, value: string) {
  await cell(page, row, col).click();
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

/**
 * Invites `guest` (logged in to `node`) into the workbook open in `owner`:
 * the owner copies an invitation link, the guest joins with it and names
 * themselves, and the call returns once the guest sees the grid.
 */
export async function shareWorkbook(
  owner: Page,
  guest: Page,
  { node = 1, nickname = 'Guest' }: { node?: number; nickname?: string } = {},
) {
  await owner.getByLabel('Invite collaborators').click();
  const link = (await owner.getByTestId('invite-link').innerText({ timeout: 60_000 })).trim();
  await owner.keyboard.press('Escape');

  await loginViaHash(guest, node);
  await guest.getByText('Join with invitation').click();
  await guest.getByTestId('field-invitation').fill(link);
  await guest.getByTestId('action-join-workspace').click();
  await chooseNickname(guest, nickname);
  await cell(guest, 0, 0).waitFor({ timeout: 90_000 });
}

/**
 * Two members in one workbook, each on their own node: `a` creates it on node
 * 0 and invites `b`, who joins from node 1. Closes both browsers afterwards.
 */
export async function withTwoMembers(
  browser: Browser,
  run: (a: Page, b: Page) => Promise<void>,
  [nameA, nameB]: [string, string] = ['Alice', 'Bob'],
) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await openNewWorkbook(a, { nickname: nameA });
    await shareWorkbook(a, b, { nickname: nameB });
    await run(a, b);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}
