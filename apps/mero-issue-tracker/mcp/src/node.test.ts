import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '@calimero-network/mero-js';
import type { Config } from './config.ts';
import { createRepoLister, createTargetResolver, describe, pickRepo, type Client } from './node.ts';

const cfg: Config = {
  target: { kind: 'local', nodes: ['http://127.0.0.1:2501'] },
  apiKey: 'key',
  workspaceRaw: 'Platform',
  source: 'bundle-hash',
};

function client(apps: Array<{ appId: string; name: string; org: string | null }>) {
  let listed = 0;
  const filters: unknown[] = [];
  const c = {
    auth: { me: async () => ({ orgs: [{ orgId: 'org-1', name: 'Platform' }, { orgId: 'org-2', name: 'Other' }] }) },
    apps: {
      list: async (filter: unknown) => {
        listed += 1;
        filters.push(filter);
        return { apps };
      },
    },
  } as unknown as Client;
  return { c, listed: () => listed, filters };
}

test('pickRepo: by name, the only one, or an error naming what exists', () => {
  const repos = [
    { appId: 'a', name: 'web' },
    { appId: 'b', name: 'api' },
  ];
  assert.equal(pickRepo(repos, 'api').appId, 'b');
  assert.equal(pickRepo([repos[0]!]).appId, 'a');
  assert.throws(() => pickRepo(repos), /Multiple repos exist.*web, api/);
  assert.throws(() => pickRepo(repos, 'nope'), /Repo "nope" not found/);
  assert.throws(() => pickRepo([]), /No repos found/);
});

test('repos are the workspace org instances of this app, listed once', async () => {
  const { c, listed, filters } = client([
    { appId: 'a', name: 'web', org: 'org-1' },
    { appId: 'x', name: 'elsewhere', org: 'org-2' },
    { appId: 'p', name: 'private', org: null },
  ]);
  const list = createRepoLister(cfg, async () => c);
  assert.deepEqual(await list(), [{ appId: 'a', name: 'web' }]);
  await list();
  assert.equal(listed(), 1);
  assert.deepEqual(filters, [{ bundle: 'bundle-hash' }]);
  const resolve = createTargetResolver({ ...cfg, repoDefault: 'web' }, list);
  assert.deepEqual(await resolve(), { appId: 'a' });
});

test('an unknown workspace names the ones the account is in', async () => {
  const { c } = client([]);
  const list = createRepoLister({ ...cfg, workspaceRaw: 'Nope' }, async () => c);
  await assert.rejects(list(), /Workspace "Nope" not found. Available workspaces: Platform, Other/);
});

test('TRACKER_APP pins one repo and ignores `repo`', async () => {
  const resolve = createTargetResolver({ ...cfg, appRaw: 'app-9' }, async () => {
    throw new Error('not listed');
  });
  assert.deepEqual(await resolve('web'), { appId: 'app-9' });
});

test('a contract refusal reads as its code and fields', () => {
  const err = new AppError('app error', { code: 'Forbidden', fields: { message: 'only the creator may delete this issue' } });
  assert.equal(describe(err), 'Forbidden {"message":"only the creator may delete this issue"}');
});
