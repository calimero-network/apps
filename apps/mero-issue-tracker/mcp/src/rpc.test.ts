import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from './config.ts';
import {
  callMethod,
  createRepoLister,
  createTargetResolver,
  listNamespaceRepos,
  pickRepo,
  resolveContextId,
  resolveExecutor,
  resolveNamespaceId,
  RpcError,
  type NamespaceRepo,
} from './rpc.ts';

const baseConfig: Config = {
  nodeUrl: 'http://localhost:2428',
  contextRaw: 'my-tracker',
};

const namespaceConfig: Config = {
  nodeUrl: 'http://localhost:2428',
  namespaceRaw: 'my-team',
};

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('callMethod posts the exact jsonrpc envelope and returns result.output', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: 'issue-123' } }),
        { status: 200 },
      );
    }) as typeof fetch,
    async () => {
      const target = { contextId: 'ctx-1', executorPublicKey: 'exec-1' };
      const out = await callMethod(baseConfig, target, 'create_issue', { title: 'Bug' });
      assert.equal(out, 'issue-123');
    },
  );

  assert.equal(capturedUrl, 'http://localhost:2428/jsonrpc');
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(body, {
    jsonrpc: '2.0',
    id: 1,
    method: 'execute',
    params: {
      contextId: 'ctx-1',
      method: 'create_issue',
      argsJson: { title: 'Bug' },
      executorPublicKey: 'exec-1',
    },
  });
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers.Authorization, undefined);
});

test('callMethod sends a bearer token when configured', async () => {
  const cfg: Config = { ...baseConfig, authToken: 'tok-abc' };
  let headers: Record<string, string> = {};
  await withFetch(
    (async (_url: string | URL, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 });
    }) as typeof fetch,
    () => callMethod(cfg, { contextId: 'c', executorPublicKey: 'e' }, 'list_issues', {}),
  );
  assert.equal(headers.Authorization, 'Bearer tok-abc');
});

test('callMethod throws RpcError on a jsonrpc-level error', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () =>
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'issue not found' } }),
            { status: 200 },
          )) as typeof fetch,
        () => callMethod(baseConfig, { contextId: 'c', executorPublicKey: 'e' }, 'get_issue', { issue_id: 'x' }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof RpcError);
      assert.match(err.message, /issue not found/);
      return true;
    },
  );
});

test('callMethod throws on non-2xx HTTP status', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () => new Response('server exploded', { status: 500 })) as typeof fetch,
        () => callMethod(baseConfig, { contextId: 'c', executorPublicKey: 'e' }, 'get_issue', { issue_id: 'x' }),
      ),
    /500/,
  );
});

test('resolveContextId uses the alias lookup value when found', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const contextId = await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ data: { value: 'ctx-resolved' } }), { status: 200 });
    }) as typeof fetch,
    () => resolveContextId(baseConfig),
  );
  assert.equal(contextId, 'ctx-resolved');
  assert.equal(capturedUrl, 'http://localhost:2428/admin-api/alias/lookup/context/my-tracker');
  assert.equal(capturedInit?.method, 'POST');
});

test('resolveContextId falls back to the raw value when the alias lookup 404s', async () => {
  const contextId = await withFetch(
    (async () => new Response('not found', { status: 404 })) as typeof fetch,
    () => resolveContextId(baseConfig),
  );
  assert.equal(contextId, 'my-tracker');
});

test('resolveContextId falls back to the raw value on a network error', async () => {
  const contextId = await withFetch(
    (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch,
    () => resolveContextId(baseConfig),
  );
  assert.equal(contextId, 'my-tracker');
});

test('resolveExecutor returns the override without calling fetch', async () => {
  const cfg: Config = { ...baseConfig, executorOverride: 'exec-override' };
  let called = false;
  const result = await withFetch(
    (async () => {
      called = true;
      throw new Error('should not be called');
    }) as typeof fetch,
    () => resolveExecutor(cfg, 'ctx-1'),
  );
  assert.equal(result, 'exec-override');
  assert.equal(called, false);
});

test('resolveExecutor fetches the first owned identity when no override is set', async () => {
  let capturedUrl = '';
  const result = await withFetch(
    (async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ data: { identities: ['id-1', 'id-2'] } }), { status: 200 });
    }) as typeof fetch,
    () => resolveExecutor(baseConfig, 'ctx-1'),
  );
  assert.equal(result, 'id-1');
  assert.equal(capturedUrl, 'http://localhost:2428/admin-api/contexts/ctx-1/identities-owned');
});

test('resolveExecutor throws when the node owns no identity for the context', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () => new Response(JSON.stringify({ data: { identities: [] } }), { status: 200 })) as typeof fetch,
        () => resolveExecutor(baseConfig, 'ctx-1'),
      ),
    /No owned identity/,
  );
});

test('createTargetResolver does not cache a rejected resolution - a later call retries and can succeed', async () => {
  let identitiesAttempt = 0;
  const resolver = createTargetResolver(baseConfig);

  await withFetch(
    (async (url: string | URL) => {
      if (String(url).includes('alias/lookup')) return new Response('not found', { status: 404 });
      identitiesAttempt += 1;
      return new Response('node not up yet', { status: 500 });
    }) as typeof fetch,
    () => assert.rejects(() => resolver(), /500/),
  );

  const target = await withFetch(
    (async (url: string | URL) => {
      if (String(url).includes('alias/lookup')) return new Response('not found', { status: 404 });
      identitiesAttempt += 1;
      return new Response(JSON.stringify({ data: { identities: ['id-1'] } }), { status: 200 });
    }) as typeof fetch,
    () => resolver(),
  );

  assert.equal(target.executorPublicKey, 'id-1');
  assert.equal(identitiesAttempt, 2);
});

// ---- resolveNamespaceId ----

function namespacesFetch(namespaces: Array<{ namespaceId: string; name?: string }>): typeof fetch {
  return (async (url: string | URL) => {
    if (String(url).endsWith('/admin-api/namespaces')) {
      return new Response(JSON.stringify({ data: namespaces }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

test('resolveNamespaceId throws when TRACKER_NAMESPACE is not set', async () => {
  await assert.rejects(() => resolveNamespaceId(baseConfig), /TRACKER_NAMESPACE/);
});

test('resolveNamespaceId matches by namespace id', async () => {
  const nsId = await withFetch(
    namespacesFetch([{ namespaceId: 'my-team', name: 'Team A' }]),
    () => resolveNamespaceId({ ...namespaceConfig, namespaceRaw: 'my-team' }),
  );
  assert.equal(nsId, 'my-team');
});

test('resolveNamespaceId matches by name', async () => {
  const nsId = await withFetch(
    namespacesFetch([{ namespaceId: 'ns-1', name: 'my-team' }, { namespaceId: 'ns-2', name: 'other' }]),
    () => resolveNamespaceId(namespaceConfig),
  );
  assert.equal(nsId, 'ns-1');
});

test('resolveNamespaceId throws a helpful error listing available namespaces when not found', async () => {
  await assert.rejects(
    () =>
      withFetch(
        namespacesFetch([{ namespaceId: 'ns-1', name: 'alpha' }, { namespaceId: 'ns-2', name: 'beta' }]),
        () => resolveNamespaceId(namespaceConfig),
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /"my-team" not found/);
      assert.match(err.message, /alpha/);
      assert.match(err.message, /beta/);
      return true;
    },
  );
});

// ---- listNamespaceRepos ----

function reposFetch(
  contexts: Array<{ contextId: string; name?: string }>,
  aliases: Array<{ name: string; value: string }>,
): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/contexts')) return new Response(JSON.stringify({ data: contexts }), { status: 200 });
    if (u.includes('/alias/list/context')) {
      return new Response(JSON.stringify({ data: { aliases } }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

test('listNamespaceRepos joins contexts with their alias and drops unaliased contexts', async () => {
  const repos = await withFetch(
    reposFetch(
      [{ contextId: 'ctx-1' }, { contextId: 'ctx-2' }, { contextId: 'ctx-3' }],
      [{ name: 'frontend', value: 'ctx-1' }, { name: 'backend', value: 'ctx-2' }],
    ),
    () => listNamespaceRepos(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(repos, [
    { contextId: 'ctx-1', name: 'frontend' },
    { contextId: 'ctx-2', name: 'backend' },
  ]);
});

test('listNamespaceRepos parses the real node flat-map alias shape', async () => {
  const repos = await withFetch(
    (async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/contexts')) {
        return new Response(JSON.stringify({ data: [{ contextId: 'ctx-1' }] }), { status: 200 });
      }
      if (u.includes('/alias/list/context')) {
        return new Response(JSON.stringify({ data: { frontend: 'ctx-1' } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch,
    () => listNamespaceRepos(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(repos, [{ contextId: 'ctx-1', name: 'frontend' }]);
});

test('listNamespaceRepos prefers the group-entry name over the alias when both are present', async () => {
  const repos = await withFetch(
    reposFetch(
      [{ contextId: 'ctx-1', name: 'core' }],
      [{ name: 'stale-alias', value: 'ctx-1' }],
    ),
    () => listNamespaceRepos(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(repos, [{ contextId: 'ctx-1', name: 'core' }]);
});

test('listNamespaceRepos ignores the legacy issue-tracker bootstrap alias', async () => {
  const repos = await withFetch(
    reposFetch(
      [{ contextId: 'ctx-1' }],
      [{ name: 'issue-tracker', value: 'ctx-1' }],
    ),
    () => listNamespaceRepos(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(repos, []);
});

test('listNamespaceRepos dedupes when two aliases point at the same context', async () => {
  const repos = await withFetch(
    reposFetch(
      [{ contextId: 'ctx-1' }],
      [{ name: 'first', value: 'ctx-1' }, { name: 'second', value: 'ctx-1' }],
    ),
    () => listNamespaceRepos(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(repos, [{ contextId: 'ctx-1', name: 'first' }]);
});

test('listNamespaceRepos throws when the contexts fetch fails', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async (url: string | URL) =>
          String(url).includes('/contexts')
            ? new Response('nope', { status: 500 })
            : new Response(JSON.stringify({ data: { aliases: [] } }), { status: 200 })) as typeof fetch,
        () => listNamespaceRepos(namespaceConfig, 'ns-1'),
      ),
    /500/,
  );
});

// ---- pickRepo ----

const repos: NamespaceRepo[] = [
  { contextId: 'ctx-1', name: 'frontend' },
  { contextId: 'ctx-2', name: 'backend' },
];

test('pickRepo returns the named match when wanted is set', () => {
  assert.deepEqual(pickRepo(repos, 'backend'), { contextId: 'ctx-2', name: 'backend' });
});

test('pickRepo throws a helpful error listing available repos when the wanted name is not found', () => {
  assert.throws(() => pickRepo(repos, 'missing'), /"missing" not found.*frontend.*backend/s);
});

test('pickRepo returns the only repo when none is wanted', () => {
  assert.deepEqual(pickRepo([repos[0]]), repos[0]);
});

test('pickRepo throws when multiple repos exist and none is wanted', () => {
  assert.throws(() => pickRepo(repos), /Multiple repos exist.*frontend.*backend/s);
});

test('pickRepo throws when no repos exist', () => {
  assert.throws(() => pickRepo([]), /No repos found/);
});

// ---- createRepoLister ----

test('createRepoLister caches across calls and does not re-fetch', async () => {
  let namespaceFetches = 0;
  let reposFetches = 0;
  const listRepos = createRepoLister(namespaceConfig);

  const impl = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/admin-api/namespaces')) {
      namespaceFetches += 1;
      return new Response(JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team' }] }), { status: 200 });
    }
    if (u.includes('/contexts')) {
      reposFetches += 1;
      return new Response(JSON.stringify({ data: [{ contextId: 'ctx-1' }] }), { status: 200 });
    }
    if (u.includes('/alias/list/context')) {
      return new Response(JSON.stringify({ data: { aliases: [{ name: 'frontend', value: 'ctx-1' }] } }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const first = await withFetch(impl, () => listRepos());
  const second = await withFetch(impl, () => listRepos());

  assert.deepEqual(first, [{ contextId: 'ctx-1', name: 'frontend' }]);
  assert.deepEqual(second, first);
  assert.equal(namespaceFetches, 1);
  assert.equal(reposFetches, 1);
});

test('createRepoLister does not cache a rejected resolution', async () => {
  let attempt = 0;
  const listRepos = createRepoLister(namespaceConfig);

  await withFetch(
    (async () => {
      attempt += 1;
      return new Response('nope', { status: 500 });
    }) as typeof fetch,
    () => assert.rejects(() => listRepos(), /500/),
  );

  const repos2 = await withFetch(
    (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/admin-api/namespaces')) {
        return new Response(JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team' }] }), { status: 200 });
      }
      if (u.includes('/contexts')) {
        return new Response(JSON.stringify({ data: [{ contextId: 'ctx-1' }] }), { status: 200 });
      }
      if (u.includes('/alias/list/context')) {
        return new Response(JSON.stringify({ data: { aliases: [{ name: 'frontend', value: 'ctx-1' }] } }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch,
    () => listRepos(),
  );
  assert.deepEqual(repos2, [{ contextId: 'ctx-1', name: 'frontend' }]);
  assert.equal(attempt, 1);
});

// ---- createTargetResolver (namespace mode) ----

function fullNamespaceFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/identities-owned')) {
      const identity = u.includes('ctx-1') ? 'exec-frontend' : 'exec-backend';
      return new Response(JSON.stringify({ data: { identities: [identity] } }), { status: 200 });
    }
    if (u.endsWith('/admin-api/namespaces')) {
      return new Response(JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team' }] }), { status: 200 });
    }
    if (u.includes('/contexts')) {
      return new Response(
        JSON.stringify({ data: [{ contextId: 'ctx-1' }, { contextId: 'ctx-2' }] }),
        { status: 200 },
      );
    }
    if (u.includes('/alias/list/context')) {
      return new Response(
        JSON.stringify({
          data: { aliases: [{ name: 'frontend', value: 'ctx-1' }, { name: 'backend', value: 'ctx-2' }] },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

test('createTargetResolver resolves the explicit repo param over TRACKER_REPO', async () => {
  const cfg: Config = { ...namespaceConfig, repoDefault: 'backend' };
  const target = createTargetResolver(cfg);
  const resolved = await withFetch(fullNamespaceFetch(), () => target('frontend'));
  assert.deepEqual(resolved, { contextId: 'ctx-1', executorPublicKey: 'exec-frontend' });
});

test('createTargetResolver falls back to TRACKER_REPO when no repo param is given', async () => {
  const cfg: Config = { ...namespaceConfig, repoDefault: 'backend' };
  const target = createTargetResolver(cfg);
  const resolved = await withFetch(fullNamespaceFetch(), () => target());
  assert.deepEqual(resolved, { contextId: 'ctx-2', executorPublicKey: 'exec-backend' });
});

test('createTargetResolver infers the single repo when neither repo param nor TRACKER_REPO is set', async () => {
  const target = createTargetResolver(namespaceConfig);
  const impl = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/identities-owned')) {
      return new Response(JSON.stringify({ data: { identities: ['exec-1'] } }), { status: 200 });
    }
    if (u.endsWith('/admin-api/namespaces')) {
      return new Response(JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team' }] }), { status: 200 });
    }
    if (u.includes('/contexts')) {
      return new Response(JSON.stringify({ data: [{ contextId: 'ctx-1' }] }), { status: 200 });
    }
    if (u.includes('/alias/list/context')) {
      return new Response(JSON.stringify({ data: { aliases: [{ name: 'frontend', value: 'ctx-1' }] } }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  const resolved = await withFetch(impl, () => target());
  assert.deepEqual(resolved, { contextId: 'ctx-1', executorPublicKey: 'exec-1' });
});

test('createTargetResolver rejects with a helpful error when the repo param does not match', async () => {
  const target = createTargetResolver(namespaceConfig);
  await assert.rejects(
    () => withFetch(fullNamespaceFetch(), () => target('nope')),
    /"nope" not found.*frontend.*backend/s,
  );
});

test('createTargetResolver resolves a repo param against the real node flat-map alias shape', async () => {
  const target = createTargetResolver(namespaceConfig);
  const impl = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/identities-owned')) {
      return new Response(JSON.stringify({ data: { identities: ['exec-1'] } }), { status: 200 });
    }
    if (u.endsWith('/admin-api/namespaces')) {
      return new Response(JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team' }] }), { status: 200 });
    }
    if (u.includes('/contexts')) {
      return new Response(
        JSON.stringify({ data: [{ contextId: 'ctx-1' }, { contextId: 'ctx-2' }] }),
        { status: 200 },
      );
    }
    if (u.includes('/alias/list/context')) {
      return new Response(JSON.stringify({ data: { frontend: 'ctx-1', backend: 'ctx-2' } }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  const resolved = await withFetch(impl, () => target('backend'));
  assert.deepEqual(resolved, { contextId: 'ctx-2', executorPublicKey: 'exec-1' });
});

test('createTargetResolver ignores the repo param when TRACKER_CONTEXT pins a context directly', async () => {
  const target = createTargetResolver(baseConfig);
  const resolved = await withFetch(
    (async (url: string | URL) => {
      if (String(url).includes('alias/lookup')) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ data: { identities: ['exec-1'] } }), { status: 200 });
    }) as typeof fetch,
    () => target('frontend'),
  );
  assert.deepEqual(resolved, { contextId: 'my-tracker', executorPublicKey: 'exec-1' });
});
