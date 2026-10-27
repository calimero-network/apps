#!/usr/bin/env node
// Browser smoke for the frontends on Calimero Cloud (release-v2).
//
// Starts a `merod-v2 local` cluster, then for each app: serves it with Vite
// against that cluster, opens it in Chromium with a virtual passkey
// authenticator, and checks the parts every app shares through
// @calimero-apps/cloud:
//
//   1. the landing page's "Sign in" (or the app's ConnectButton) opens the passkey dialog, and creating an
//      account there signs the page in (the provider keeps only a refresh
//      token in sessionStorage — never the session token in localStorage);
//   2. a reload restores the session from that refresh token;
//   3. the admin API the app speaks (v1 names) works on the cluster: a
//      workspace (organization), a group (team), its members, an invitation;
//   4. no uncaught error on the page.
//
// Usage: node scripts/cloud-frontend-smoke.mjs [app ...]
//   MEROD_V2_BINARY  the merod-v2 to run (default: merod-v2 on PATH)

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const require = createRequire(join(ROOT, 'apps/kv-store/app-cloud/package.json'));
const { chromium } = require('@playwright/test');

const BASE_PORT = 2640;
const CLUSTER = `http://127.0.0.1:${BASE_PORT + 1}`;
const APP_PORT = 5199;
const ORIGIN = `http://localhost:${APP_PORT}`;

/** Apps that sign in through the shared passkey dialog (landing page or ConnectButton). */
const ALL = [
  'battleships', 'hyperfeed', 'kv-store', 'mero-calendar', 'mero-chat', 'mero-chess', 'mero-crm',
  'mero-design', 'mero-docs', 'mero-forms', 'mero-forum', 'mero-issue-tracker', 'mero-kombat',
  'mero-models', 'mero-pass', 'mero-pixart', 'mero-sheets', 'mero-standup', 'mero-stream',
  'mero-updates', 'mero-vote', 'mero-sign',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, ok = (r) => r.ok, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (await ok(r)) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`${url} did not come up`);
    await sleep(250);
  }
}

function start(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: process.env.SMOKE_LOGS ? 'inherit' : 'ignore', detached: true, ...opts });
  return () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // gone already
    }
  };
}

async function smoke(browser, app) {
  const dir = join(ROOT, 'apps', app, 'app');
  const stopVite = start('npx', ['vite', '--port', String(APP_PORT), '--strictPort', '--host', 'localhost'], {
    cwd: dir,
    env: { ...process.env, VITE_CALIMERO_URL: CLUSTER, VITE_CALIMERO_ALLOW_MOCK: 'true' },
  });
  const errors = [];
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    await waitFor(ORIGIN, (r) => r.status < 500, 90_000);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });

    // 1. Sign up through the landing page's dialog.
    await page.goto('/');
    // The landing page's "Sign in", or an app shell's ConnectButton ("Connect").
    await page.getByRole('button', { name: /^(Sign in|Connect|Open your feed)$/ }).first().click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: /Sign in to Calimero|Create your account/ });
    await dialog.getByLabel('Cluster URL').fill(CLUSTER);
    await dialog.getByRole('button', { name: 'Create an account' }).click();
    await dialog.getByLabel('Your name').fill(`smoke-${app}`);
    await dialog.getByRole('button', { name: 'Create account with a passkey' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
    const refresh1 = await page.evaluate(() => sessionStorage.getItem('calimero-cloud:refresh'));
    if (!refresh1) throw new Error('signed up, but the tab holds no refresh token');
    const leaked = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    if (/sessionToken|refreshToken/.test(leaked)) throw new Error('a session token reached localStorage');

    // 2. A reload restores the session: the provider trades the refresh token.
    await page.reload();
    await page.waitForFunction((prev) => {
      const now = sessionStorage.getItem('calimero-cloud:refresh');
      return now && now !== prev;
    }, refresh1, { timeout: 30_000 });

    // 3. The admin API the app speaks, on the cluster, as this account.
    const result = await page.evaluate(async (cloudSrc) => {
      const m = await import(/* @vite-ignore */ cloudSrc);
      const mero = new m.CloudMero();
      if (!(await mero.validate())) throw new Error('the restored session does not validate');
      const admin = m.createCloudAdmin(mero);
      const { namespaceId } = await admin.createNamespace({ name: 'smoke' });
      const { groupId } = await admin.createGroupInNamespace(namespaceId, { groupName: 'team', visibility: 'open' });
      const members = (await admin.listGroupMembers(groupId)).members.map((x) => x.role);
      const invite = await admin.createNamespaceInvitation(namespaceId);
      const spaces = (await admin.listNamespaces()).map((n) => n.namespaceId);
      return { listed: spaces.includes(namespaceId), members, invited: !!invite.invitation?.invitation?.cloud_token };
    }, `/@fs${join(ROOT, 'packages/cloud/src/index.ts')}`);
    if (!result.listed || result.members[0] !== 'Admin' || !result.invited) {
      throw new Error(`admin API: ${JSON.stringify(result)}`);
    }

    // 4. Nothing blew up on the page.
    if (errors.length) throw new Error(`uncaught: ${errors.join(' | ')}`);
    return null;
  } catch (e) {
    return `${e instanceof Error ? e.message : String(e)}${errors.length ? ` [page errors: ${errors.join(' | ')}]` : ''}`;
  } finally {
    await context.close();
    stopVite();
    await sleep(500);
  }
}

async function main() {
  const apps = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
  const state = mkdtempSync(join(tmpdir(), 'cloud-smoke-'));
  const stopCluster = start(process.env.MEROD_V2_BINARY ?? 'merod-v2', [
    'local', '--base-port', String(BASE_PORT), '--dir', join(state, 'cluster'), '--fresh', '--origins', ORIGIN,
  ]);
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const failed = [];
  try {
    await waitFor(`${CLUSTER}/health`, async (r) => r.ok && (await r.json()).systemLeader);
    await sleep(1500);
    for (const app of apps) {
      const error = await smoke(browser, app);
      console.log(`${error ? 'FAIL' : 'ok  '} ${app}${error ? `: ${error}` : ''}`);
      if (error) failed.push(app);
    }
  } finally {
    await browser.close();
    stopCluster();
    rmSync(state, { recursive: true, force: true });
  }
  console.log(`${apps.length - failed.length}/${apps.length} apps passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
