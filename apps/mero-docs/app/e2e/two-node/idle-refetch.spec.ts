// An idle, synced workspace refetches once per interval sync: core reports each
// run as `syncing` then a terminal phase, and only the terminal one may refetch.

import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures/two-user';

const IDLE_MS = 60_000; // about six of core's 10 s interval syncs
const MAX_REQUESTS_PER_SYNC = 36; // midway between 31 per sync (one refetch per run) and 42 (one per sync phase)
const MIN_SYNCS = 3; // the window must hold whole sync runs, or the ratio proves nothing

/** The app method of a JSON-RPC `execute` call, or null for any other request. */
function rpcMethod(req: Request): string | null {
  try {
    const body = JSON.parse(req.postData() ?? '') as {
      params?: { method?: unknown };
    };
    return typeof body.params?.method === 'string' ? body.params.method : null;
  } catch {
    return null;
  }
}

/** Records, in issue order, whether each node request from `page` (the `/sse`
 *  stream aside) is the workspace's `get_folders` read, one per sync it refetches on. */
function recordNodeRequests(page: Page): boolean[] {
  const origins = new Set(
    [process.env.E2E_NODE_URL, process.env.E2E_NODE_URL_2].map(
      (u) => new URL(u!).origin,
    ),
  );
  const log: boolean[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!origins.has(url.origin) || url.pathname.endsWith('/sse')) return;
    log.push(rpcMethod(req) === 'get_folders');
  });
  return log;
}

/** Requests per sync run, over the whole runs between the first and last
 *  `get_folders`, so a window edge never splits a run from its requests. */
function requestsPerSync(log: boolean[]): { syncs: number; perSync: number } {
  const first = log.indexOf(true);
  const last = log.lastIndexOf(true);
  const syncs = log.filter(Boolean).length - 1;
  return { syncs, perSync: syncs > 0 ? (last - first) / syncs : Infinity };
}

test('idle workspace refetches once per sync', async ({ alice, bob }) => {
  test.setTimeout(IDLE_MS + 120_000);
  await alice.goToWorkspace();
  await alice.createNamespace('Idle WS');
  await alice.createFolder({ name: 'Specs', visibility: 'Open' });
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await bob.joinNamespace(inviteUrl);
  await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });

  // Settings stays open: its member rows are the hooks that refetch per event.
  const log = recordNodeRequests(alice.page);
  await alice.page.waitForTimeout(IDLE_MS);

  const { syncs, perSync } = requestsPerSync(log);
  expect(syncs).toBeGreaterThanOrEqual(MIN_SYNCS);
  expect(perSync).toBeLessThanOrEqual(MAX_REQUESTS_PER_SYNC);
});
