import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { ResolvedTarget } from './rpc.ts';
import {
  createIssueShape,
  listIssuesShape,
  getIssueShape,
  addCommentShape,
  assignIssueShape,
  setStatusShape,
  setPriorityShape,
  getFixPromptShape,
  listReposShape,
  addRepoShape,
  createIssue,
  listIssues,
  getIssue,
  addComment,
  assignIssue,
  setStatus,
  setPriority,
  getFixPrompt,
  listRepos,
  addRepo,
  createServer,
} from './index.ts';

const cfg: Config = { nodeUrl: 'http://localhost:2428', contextRaw: 'ctx', serviceName: 'issue-tracker' };
const target: ResolvedTarget = { contextId: 'ctx-1', executorPublicKey: 'exec-1' };

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonrpcOk(output: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output } }), { status: 200 })) as typeof fetch;
}

// ---- Schema validation ----

test('create_issue schema rejects a missing required section', () => {
  const schema = z.object(createIssueShape);
  const result = schema.safeParse({ title: 'Bug', summary: 'x', impact: 'x', repro: 'x' });
  assert.equal(result.success, false);
});

test('create_issue schema rejects an empty required field', () => {
  const schema = z.object(createIssueShape);
  const result = schema.safeParse({
    title: '',
    summary: 'x',
    impact: 'x',
    repro: 'x',
    resolution_criteria: 'x',
  });
  assert.equal(result.success, false);
});

test('create_issue schema fills in priority=medium and labels=[] when omitted', () => {
  const schema = z.object(createIssueShape);
  const result = schema.parse({
    title: 'Bug',
    summary: 'S',
    impact: 'I',
    repro: 'R',
    resolution_criteria: 'C',
  });
  assert.equal(result.priority, 'medium');
  assert.deepEqual(result.labels, []);
});

test('create_issue schema rejects an out-of-enum priority', () => {
  const schema = z.object(createIssueShape);
  const result = schema.safeParse({
    title: 'Bug',
    summary: 'S',
    impact: 'I',
    repro: 'R',
    resolution_criteria: 'C',
    priority: 'critical',
  });
  assert.equal(result.success, false);
});

test('list_issues schema allows an empty object (all filters optional)', () => {
  const schema = z.object(listIssuesShape);
  const result = schema.safeParse({});
  assert.equal(result.success, true);
});

test('get_issue schema requires a non-empty id', () => {
  const schema = z.object(getIssueShape);
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ id: '' }).success, false);
  assert.equal(schema.safeParse({ id: 'issue-1' }).success, true);
});

test('add_comment schema requires issue_id and body', () => {
  const schema = z.object(addCommentShape);
  assert.equal(schema.safeParse({ issue_id: 'i1' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'i1', body: 'hi' }).success, true);
});

test('assign_issue schema requires issue_id and assignee', () => {
  const schema = z.object(assignIssueShape);
  assert.equal(schema.safeParse({ issue_id: 'i1' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'i1', assignee: 'bob' }).success, true);
});

test('set_status schema requires issue_id and an in-enum status', () => {
  const schema = z.object(setStatusShape);
  assert.equal(schema.safeParse({ issue_id: 'i1' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'i1', status: 'Nope' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'i1', status: 'In progress' }).success, true);
});

test('set_priority schema requires issue_id and an in-enum priority', () => {
  const schema = z.object(setPriorityShape);
  assert.equal(schema.safeParse({ issue_id: 'i1' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'i1', priority: 'critical' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'i1', priority: 'urgent' }).success, true);
});

test('get_fix_prompt schema requires a non-empty id', () => {
  const schema = z.object(getFixPromptShape);
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ id: 'issue-1' }).success, true);
});

// ---- Request shaping ----

test('createIssue calls create_issue with all seven fields', async () => {
  let captured: unknown;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)).params.argsJson;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: 'issue-1' } }), { status: 200 });
    }) as typeof fetch,
    () =>
      createIssue(cfg, target, {
        title: 'Bug',
        summary: 'S',
        impact: 'I',
        repro: 'R',
        resolution_criteria: 'C',
        priority: 'high',
        labels: ['ui'],
      }),
  );
  assert.deepEqual(captured, {
    title: 'Bug',
    summary: 'S',
    impact: 'I',
    repro: 'R',
    resolution_criteria: 'C',
    priority: 'high',
    labels: ['ui'],
  });
});

test('listIssues sends null for omitted filters (matches the nullable rpc signature)', async () => {
  let captured: unknown;
  let method: unknown;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      const params = JSON.parse(String(init?.body)).params;
      method = params.method;
      captured = params.argsJson;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: [] } }), { status: 200 });
    }) as typeof fetch,
    () => listIssues(cfg, target, { status: 'open' }),
  );
  assert.equal(method, 'list_issues');
  assert.deepEqual(captured, { status: 'open', assignee: null, label: null });
});

test('getIssue maps tool arg "id" to rpc arg "issue_id"', async () => {
  let params: any;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      params = JSON.parse(String(init?.body)).params;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: {} } }), { status: 200 });
    }) as typeof fetch,
    () => getIssue(cfg, target, { id: 'issue-9' }),
  );
  assert.equal(params.method, 'get_issue');
  assert.deepEqual(params.argsJson, { issue_id: 'issue-9' });
});

test('addComment forwards issue_id and body to add_comment', async () => {
  let params: any;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      params = JSON.parse(String(init?.body)).params;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: 'comment-1' } }), {
        status: 200,
      });
    }) as typeof fetch,
    () => addComment(cfg, target, { issue_id: 'issue-9', body: 'looks good' }),
  );
  assert.equal(params.method, 'add_comment');
  assert.deepEqual(params.argsJson, { issue_id: 'issue-9', body: 'looks good' });
});

test('assignIssue calls set_assignee with issue_id and assignee', async () => {
  let params: any;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      params = JSON.parse(String(init?.body)).params;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
    }) as typeof fetch,
    () => assignIssue(cfg, target, { issue_id: 'issue-9', assignee: 'alice.near' }),
  );
  assert.equal(params.method, 'set_assignee');
  assert.deepEqual(params.argsJson, { issue_id: 'issue-9', assignee: 'alice.near' });
});

test('setStatus calls set_status with issue_id and status', async () => {
  let params: any;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      params = JSON.parse(String(init?.body)).params;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
    }) as typeof fetch,
    () => setStatus(cfg, target, { issue_id: 'issue-9', status: 'In progress' }),
  );
  assert.equal(params.method, 'set_status');
  assert.deepEqual(params.argsJson, { issue_id: 'issue-9', status: 'In progress' });
});

test('setPriority calls set_priority with issue_id and priority', async () => {
  let params: any;
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      params = JSON.parse(String(init?.body)).params;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
    }) as typeof fetch,
    () => setPriority(cfg, target, { issue_id: 'issue-9', priority: 'urgent' }),
  );
  assert.equal(params.method, 'set_priority');
  assert.deepEqual(params.argsJson, { issue_id: 'issue-9', priority: 'urgent' });
});

test('getFixPrompt fetches the issue then builds the filled prompt', async () => {
  const prompt = await withFetch(
    jsonrpcOk({
      issue: {
        id: 'issue-9',
        title: 'Bug',
        summary: 'S',
        impact: 'I',
        repro: 'R',
        resolution_criteria: 'C',
      },
      comments: [],
    }),
    () => getFixPrompt(cfg, target, { id: 'issue-9' }),
  );
  assert.match(prompt, /Issue issue-9: Bug/);
  assert.match(prompt, /## Summary\nS/);
  assert.match(prompt, /## Resolution criteria\nC/);
});

test('getFixPrompt includes the Repository line filled from get_repo_info', async () => {
  const prompt = await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      const { method, argsJson } = JSON.parse(String(init?.body)).params;
      if (method === 'get_issue') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              output: {
                issue: {
                  id: argsJson.issue_id,
                  title: 'Bug',
                  summary: 'S',
                  impact: 'I',
                  repro: 'R',
                  resolution_criteria: 'C',
                },
                comments: [],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: { repo_url: 'https://github.com/acme/frontend' } } }),
        { status: 200 },
      );
    }) as typeof fetch,
    () => getFixPrompt(cfg, target, { id: 'issue-9' }),
  );
  assert.match(prompt, /Issue issue-9: Bug\nRepository: https:\/\/github\.com\/acme\/frontend\n/);
});

test('get_issue schema accepts an optional repo param', () => {
  const schema = z.object(getIssueShape);
  const result = schema.safeParse({ id: 'issue-1', repo: 'frontend' });
  assert.equal(result.success, true);
});

test('list_repos schema accepts an empty object', () => {
  const schema = z.object(listReposShape);
  assert.equal(schema.safeParse({}).success, true);
});

test('add_repo schema requires name and an http(s) github_url', () => {
  const schema = z.object(addRepoShape);
  assert.equal(schema.safeParse({ name: 'frontend' }).success, false);
  assert.equal(schema.safeParse({ name: 'frontend', github_url: '' }).success, false);
  assert.equal(schema.safeParse({ name: 'frontend', github_url: 'ftp://acme/frontend' }).success, false);
  assert.equal(schema.safeParse({ name: 'frontend', github_url: 'not-a-url' }).success, false);
  assert.equal(schema.safeParse({ name: 'frontend', github_url: 'https://github.com/acme/frontend' }).success, true);
});

// ---- listRepos (list_repos tool) ----

test('listRepos fetches repo_url per repo via get_repo_info on each repo\'s own context', async () => {
  const namespaceRepos = [
    { contextId: 'ctx-1', name: 'frontend' },
    { contextId: 'ctx-2', name: 'backend' },
  ];
  const result = await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/identities-owned')) {
        const identity = u.includes('ctx-1') ? 'exec-1' : 'exec-2';
        return new Response(JSON.stringify({ data: { identities: [identity] } }), { status: 200 });
      }
      const { contextId } = JSON.parse(String(init?.body)).params;
      const repoUrl = contextId === 'ctx-1' ? 'https://github.com/acme/frontend' : 'https://github.com/acme/backend';
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: { repo_url: repoUrl } } }), {
        status: 200,
      });
    }) as typeof fetch,
    () => listRepos(cfg, namespaceRepos),
  );
  assert.deepEqual(result, [
    { name: 'frontend', repo_url: 'https://github.com/acme/frontend' },
    { name: 'backend', repo_url: 'https://github.com/acme/backend' },
  ]);
});

// ---- addRepo (add_repo tool) ----

const nsCfg: Config = { nodeUrl: 'http://localhost:2428', namespaceRaw: 'my-team', serviceName: 'issue-tracker' };

/** A mock fetch covering add_repo's full call graph; `existingContexts` seeds the duplicate check. */
function addRepoFetch(
  existingContexts: Array<{ contextId: string; name?: string }> = [],
  opts: { aliasFails?: boolean } = {},
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.endsWith('/admin-api/namespaces')) {
      return new Response(
        JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team', targetApplicationId: 'app-1' }] }),
        { status: 200 },
      );
    }
    if (u.includes('/contexts') && u.includes('/admin-api/groups/')) {
      return new Response(JSON.stringify({ data: existingContexts }), { status: 200 });
    }
    if (u.includes('/alias/list/context')) {
      return new Response(JSON.stringify({ data: { aliases: [] } }), { status: 200 });
    }
    if (u.endsWith('/admin-api/contexts') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({ data: { contextId: 'ctx-new', memberPublicKey: 'member-key' } }),
        { status: 200 },
      );
    }
    if (u.endsWith('/jsonrpc')) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
    }
    if (u.endsWith('/admin-api/alias/create/context')) {
      return opts.aliasFails
        ? new Response('boom', { status: 500 })
        : new Response(JSON.stringify({ data: {} }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { impl, calls };
}

test('addRepo creates the context, sets repo_url as the returned memberPublicKey, aliases it, and returns the new repo', async () => {
  const { impl, calls } = addRepoFetch();
  let setRepoUrlParams: any;
  const wrapped = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/jsonrpc')) setRepoUrlParams = JSON.parse(String(init?.body)).params;
    return impl(url, init);
  }) as typeof fetch;

  const result = await withFetch(wrapped, () =>
    addRepo(nsCfg, { name: 'frontend', github_url: 'https://github.com/acme/frontend' }),
  );

  assert.deepEqual(result, { contextId: 'ctx-new', name: 'frontend', url: 'https://github.com/acme/frontend' });
  assert.equal(setRepoUrlParams.method, 'set_repo_url');
  assert.deepEqual(setRepoUrlParams.argsJson, { url: 'https://github.com/acme/frontend' });
  assert.equal(setRepoUrlParams.contextId, 'ctx-new');
  assert.equal(setRepoUrlParams.executorPublicKey, 'member-key');
  assert.ok(calls.some((c) => c === 'POST http://localhost:2428/admin-api/contexts'));
  assert.ok(calls.some((c) => c.endsWith('/admin-api/alias/create/context')));
});

test('addRepo rejects a duplicate repo name without calling createContext', async () => {
  const { impl, calls } = addRepoFetch([{ contextId: 'ctx-1', name: 'frontend' }]);
  await assert.rejects(
    () => withFetch(impl, () => addRepo(nsCfg, { name: 'frontend', github_url: 'https://github.com/acme/frontend' })),
    /"frontend" already exists/,
  );
  assert.ok(!calls.some((c) => c.endsWith('/admin-api/contexts') && c.startsWith('POST')));
});

test('addRepo rejects when TRACKER_NAMESPACE is unset (context-pin mode)', async () => {
  const pinCfg: Config = { nodeUrl: 'http://localhost:2428', contextRaw: 'ctx', serviceName: 'issue-tracker' };
  let fetchCalled = false;
  await assert.rejects(
    () =>
      withFetch(
        (async () => {
          fetchCalled = true;
          throw new Error('should not be called');
        }) as typeof fetch,
        () => addRepo(pinCfg, { name: 'frontend', github_url: 'https://github.com/acme/frontend' }),
      ),
    /TRACKER_NAMESPACE/,
  );
  assert.equal(fetchCalled, false);
});

test('addRepo succeeds even when alias creation fails (best-effort)', async () => {
  const { impl } = addRepoFetch([], { aliasFails: true });
  const result = await withFetch(impl, () =>
    addRepo(nsCfg, { name: 'frontend', github_url: 'https://github.com/acme/frontend' }),
  );
  assert.deepEqual(result, { contextId: 'ctx-new', name: 'frontend', url: 'https://github.com/acme/frontend' });
});

// ---- Server construction ----

test('createServer builds without resolving context/executor (no network call)', () => {
  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('should not be called at construction time');
  }) as typeof fetch;
  try {
    const server = createServer(cfg);
    assert.ok(server);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = original;
  }
});
