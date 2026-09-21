// An idle, synced workspace refetches once per interval sync: core reports each
// run as `syncing` then `idle`, and only the completion may trigger a refetch.

import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures/two-user';

const IDLE_MS = 60_000; // about six of core's 10 s interval syncs
const MAX_REQUESTS_PER_SYNC = 37; // measured 31 per sync with the fix, 42 when both phases refetch
const MIN_SYNCS = 3; // the window must see real sync runs, or the ratio proves nothing

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

/** Counts node requests from `page` (leaving out the `/sse` stream) and the
 *  workspace's `get_folders` reads, which happen once per sync it refetches on. */
function countNodeRequests(page: Page) {
  const origins = new Set(
    [process.env.E2E_NODE_URL, process.env.E2E_NODE_URL_2].map(
      (u) => new URL(u!).origin,
    ),
  );
  const counts = { requests: 0, syncs: 0 };
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!origins.has(url.origin) || url.pathname.endsWith('/sse')) return;
    counts.requests += 1;
    if (rpcMethod(req) === 'get_folders') counts.syncs += 1;
  });
  return counts;
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
  const counts = countNodeRequests(alice.page);
  await alice.page.waitForTimeout(IDLE_MS);

  expect(counts.syncs).toBeGreaterThanOrEqual(MIN_SYNCS);
  expect(counts.requests / counts.syncs).toBeLessThanOrEqual(
    MAX_REQUESTS_PER_SYNC,
  );
});
