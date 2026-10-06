// An idle, synced workspace refetches once per interval sync: core reports each
// run as `syncing` then a terminal phase, and only the terminal one may refetch.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/two-user';
import { parseAppPath } from '../../src/lib/routes';

const SYNC_DEADLINE_MS = 120_000; // core's 10 s interval sync can skip a beat on a loaded machine
const MAX_REQUESTS_PER_SYNC = 36; // midway between 31 per sync (one refetch per run) and 42 (one per sync phase)
const MIN_SYNCS = 4; // enough whole sync runs, or the ratio proves nothing

/** Records, in issue order, whether each node request from `page` (the `/sse`
 *  stream aside) lists the workspace root's subgroups: the first read of the
 *  folder-tree walk, one per sync it refetches on. The root group is the
 *  namespace, which the workspace URL names. */
function recordNodeRequests(page: Page): boolean[] {
  const ws = parseAppPath(new URL(page.url()).pathname, '')?.ws;
  if (!ws) throw new Error('not on a workspace page');
  const rootSubgroups = `/admin-api/groups/${ws}/subgroups`;
  const origins = new Set(
    [process.env.E2E_NODE_URL, process.env.E2E_NODE_URL_2].map(
      (u) => new URL(u!).origin,
    ),
  );
  const log: boolean[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!origins.has(url.origin) || url.pathname.endsWith('/sse')) return;
    log.push(req.method() === 'GET' && url.pathname.endsWith(rootSubgroups));
  });
  return log;
}

/** Requests per sync run, over the whole runs between the first and last
 *  root subgroups listing, so a window edge never splits a run from its requests. */
function requestsPerSync(log: boolean[]): { syncs: number; perSync: number } {
  const first = log.indexOf(true);
  const last = log.lastIndexOf(true);
  const syncs = log.filter(Boolean).length - 1;
  return { syncs, perSync: syncs > 0 ? (last - first) / syncs : Infinity };
}

test('idle workspace refetches once per sync', async ({ alice, bob }) => {
  test.setTimeout(SYNC_DEADLINE_MS + 120_000);
  await alice.goToWorkspace();
  await alice.createNamespace('Idle WS');
  await alice.createFolder({ name: 'Specs', visibility: 'Open' });
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await bob.joinNamespace(inviteUrl);
  await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });

  // Settings stays open: its member rows are the hooks that refetch per event.
  const log = recordNodeRequests(alice.page);
  await expect
    .poll(() => requestsPerSync(log).syncs, { timeout: SYNC_DEADLINE_MS })
    .toBeGreaterThanOrEqual(MIN_SYNCS);

  expect(requestsPerSync(log).perSync).toBeLessThanOrEqual(
    MAX_REQUESTS_PER_SYNC,
  );
});
