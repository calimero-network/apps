import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from './config.ts';
import {
  callMethod,
  createContext,
  createContextAlias,
  createFolderLister,
  createTargetResolver,
  decodeFunctionCallErrorData,
  listNamespaceFolders,
  pickFolder,
  resolveContextId,
  resolveExecutor,
  resolveNamespaceApp,
  resolveNamespaceId,
  RpcError,
  type NamespaceFolder,
} from './rpc.ts';

// The resolvers log expected fallbacks (alias lookup misses, ignored folder params) to stderr; keep test output clean.
before(() => mock.method(console, 'error', () => {}));
after(() => mock.restoreAll());

const baseConfig: Config = {
  nodeUrl: 'http://localhost:2428',
  contextRaw: 'my-board',
  serviceName: 'board',
};

const namespaceConfig: Config = {
  nodeUrl: 'http://localhost:2428',
  namespaceRaw: 'my-team',
  serviceName: 'board',
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
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: 'card-123' } }),
        { status: 200 },
      );
    }) as typeof fetch,
    async () => {
      const target = { contextId: 'ctx-1', executorPublicKey: 'exec-1' };
      const out = await callMethod(baseConfig, target, 'create_card', { title: 'Fix it' });
      assert.equal(out, 'card-123');
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
      method: 'create_card',
      argsJson: { title: 'Fix it' },
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
    () => callMethod(cfg, { contextId: 'c', executorPublicKey: 'e' }, 'list_cards', {}),
  );
  assert.equal(headers.Authorization, 'Bearer tok-abc');
});

test('callMethod throws RpcError on a jsonrpc-level error', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () =>
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'card not found' } }),
            { status: 200 },
          )) as typeof fetch,
        () => callMethod(baseConfig, { contextId: 'c', executorPublicKey: 'e' }, 'get_card', { card_id: 'x' }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof RpcError);
      assert.match(err.message, /card not found/);
      return true;
    },
  );
});

test('callMethod decodes a FunctionCallError data byte array into the real guest message', async () => {
  // The guest serializes its error as a JSON string, so the decoded bytes are
  // themselves JSON-quoted - matches the real node's observed shape.
  const bytes = JSON.stringify([...Buffer.from('"title must be at most 64 characters"', 'utf8')]);
  await assert.rejects(
    () =>
      withFetch(
        (async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { type: 'FunctionCallError', data: `the method call returned an error: ${bytes}` },
            }),
            { status: 200 },
          )) as typeof fetch,
        () => callMethod(baseConfig, { contextId: 'c', executorPublicKey: 'e' }, 'create_card', {}),
      ),
    (err: unknown) => {
      assert.ok(err instanceof RpcError);
      assert.equal(err.message, 'title must be at most 64 characters');
      return true;
    },
  );
});

test('callMethod falls back to the error type when data is not a decodable byte array', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () =>
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { type: 'FunctionCallError', data: 'opaque' } }),
            { status: 200 },
          )) as typeof fetch,
        () => callMethod(baseConfig, { contextId: 'c', executorPublicKey: 'e' }, 'create_card', {}),
      ),
    /FunctionCallError/,
  );
});

test('decodeFunctionCallErrorData unwraps a JSON-quoted guest message embedded in a Debug-formatted string', () => {
  const bytes = [...Buffer.from('"boom"', 'utf8')];
  assert.equal(decodeFunctionCallErrorData(`the method call returned an error: ${JSON.stringify(bytes)}`), 'boom');
});

test('decodeFunctionCallErrorData falls back to the raw decoded text when it is not JSON-quoted', () => {
  const bytes = [...Buffer.from('boom', 'utf8')];
  assert.equal(decodeFunctionCallErrorData(`the method call returned an error: ${JSON.stringify(bytes)}`), 'boom');
});

test('decodeFunctionCallErrorData reads the rc.81+ text shape: a {kind, data} contract error', () => {
  assert.equal(
    decodeFunctionCallErrorData(
      'the method call returned an error: {"data":"list still holds cards; move or archive them first","kind":"Invalid"}',
    ),
    'Invalid: list still holds cards; move or archive them first',
  );
});

test('decodeFunctionCallErrorData reads the rc.81+ text shape: a quoted or bare string', () => {
  assert.equal(
    decodeFunctionCallErrorData('the method call returned an error: "not found: board-1"'),
    'not found: board-1',
  );
  assert.equal(decodeFunctionCallErrorData('the method call returned an error: title must not be empty'), 'title must not be empty');
});

test('decodeFunctionCallErrorData decodes a byte-list {kind, data} the same way as its text form', () => {
  const bytes = [...Buffer.from('{"data":"only the creator may delete this card","kind":"Forbidden"}', 'utf8')];
  assert.equal(
    decodeFunctionCallErrorData(`the method call returned an error: ${JSON.stringify(bytes)}`),
    'Forbidden: only the creator may delete this card',
  );
});

test('decodeFunctionCallErrorData returns undefined for non-string, absent, or non-array data', () => {
  assert.equal(decodeFunctionCallErrorData(undefined), undefined);
  assert.equal(decodeFunctionCallErrorData(42), undefined);
  assert.equal(decodeFunctionCallErrorData('no brackets here'), undefined);
  assert.equal(decodeFunctionCallErrorData('the method call returned an error: '), undefined);
});

test('callMethod throws on non-2xx HTTP status', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () => new Response('server exploded', { status: 500 })) as typeof fetch,
        () => callMethod(baseConfig, { contextId: 'c', executorPublicKey: 'e' }, 'get_card', { card_id: 'x' }),
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
  assert.equal(capturedUrl, 'http://localhost:2428/admin-api/alias/lookup/context/my-board');
  assert.equal(capturedInit?.method, 'POST');
});

test('resolveContextId falls back to the raw value when the alias lookup 404s', async () => {
  const contextId = await withFetch(
    (async () => new Response('not found', { status: 404 })) as typeof fetch,
    () => resolveContextId(baseConfig),
  );
  assert.equal(contextId, 'my-board');
});

test('resolveContextId falls back to the raw value on a network error', async () => {
  const contextId = await withFetch(
    (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch,
    () => resolveContextId(baseConfig),
  );
  assert.equal(contextId, 'my-board');
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

function namespacesFetch(
  namespaces: Array<{ namespaceId: string; name?: string; targetApplicationId?: string }>,
): typeof fetch {
  return (async (url: string | URL) => {
    if (String(url).endsWith('/admin-api/namespaces')) {
      return new Response(JSON.stringify({ data: namespaces }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

test('resolveNamespaceId throws when BOARD_NAMESPACE is not set', async () => {
  await assert.rejects(() => resolveNamespaceId(baseConfig), /BOARD_NAMESPACE/);
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

// ---- resolveNamespaceApp ----

test('resolveNamespaceApp resolves namespaceId and targetApplicationId together', async () => {
  const result = await withFetch(
    namespacesFetch([{ namespaceId: 'ns-1', name: 'my-team', targetApplicationId: 'app-1' }]),
    () => resolveNamespaceApp(namespaceConfig),
  );
  assert.deepEqual(result, { namespaceId: 'ns-1', applicationId: 'app-1' });
});

test('resolveNamespaceApp throws when the matched namespace has no targetApplicationId', async () => {
  await assert.rejects(
    () =>
      withFetch(
        namespacesFetch([{ namespaceId: 'ns-1', name: 'my-team' }]),
        () => resolveNamespaceApp(namespaceConfig),
      ),
    /targetApplicationId/,
  );
});

// ---- createContext / createContextAlias ----

test('createContext posts applicationId/groupId/serviceName/name/initializationParams and returns contextId+memberPublicKey', async () => {
  let capturedUrl = '';
  let capturedBody: unknown;
  const result = await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ data: { contextId: 'ctx-new', memberPublicKey: 'member-key' } }),
        { status: 200 },
      );
    }) as typeof fetch,
    () =>
      createContext(namespaceConfig, {
        applicationId: 'app-1',
        groupId: 'ns-1',
        serviceName: 'board',
        name: 'frontend',
      }),
  );
  assert.equal(capturedUrl, 'http://localhost:2428/admin-api/contexts');
  assert.deepEqual(capturedBody, {
    applicationId: 'app-1',
    groupId: 'ns-1',
    serviceName: 'board',
    name: 'frontend',
    initializationParams: [],
  });
  assert.deepEqual(result, { contextId: 'ctx-new', memberPublicKey: 'member-key' });
});

test('createContext throws when the response has no contextId/memberPublicKey', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () => new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch,
        () =>
          createContext(namespaceConfig, {
            applicationId: 'app-1',
            groupId: 'ns-1',
            serviceName: 'board',
            name: 'frontend',
          }),
      ),
    /no contextId\/memberPublicKey/,
  );
});

test('createContext throws on non-2xx HTTP status', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () => new Response('boom', { status: 500 })) as typeof fetch,
        () =>
          createContext(namespaceConfig, {
            applicationId: 'app-1',
            groupId: 'ns-1',
            serviceName: 'board',
            name: 'frontend',
          }),
      ),
    /500/,
  );
});

test('createContextAlias posts alias+contextId to alias/create/context', async () => {
  let capturedUrl = '';
  let capturedBody: unknown;
  await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as typeof fetch,
    () => createContextAlias(namespaceConfig, 'frontend', 'ctx-new'),
  );
  assert.equal(capturedUrl, 'http://localhost:2428/admin-api/alias/create/context');
  assert.deepEqual(capturedBody, { alias: 'frontend', contextId: 'ctx-new' });
});

test('createContextAlias throws on non-2xx HTTP status', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async () => new Response('boom', { status: 500 })) as typeof fetch,
        () => createContextAlias(namespaceConfig, 'frontend', 'ctx-new'),
      ),
    /500/,
  );
});

// ---- listNamespaceFolders ----

function foldersFetch(
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

test('listNamespaceFolders joins contexts with their alias and drops unaliased contexts', async () => {
  const folders = await withFetch(
    foldersFetch(
      [{ contextId: 'ctx-1' }, { contextId: 'ctx-2' }, { contextId: 'ctx-3' }],
      [{ name: 'frontend', value: 'ctx-1' }, { name: 'backend', value: 'ctx-2' }],
    ),
    () => listNamespaceFolders(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(folders, [
    { contextId: 'ctx-1', name: 'frontend' },
    { contextId: 'ctx-2', name: 'backend' },
  ]);
});

test('listNamespaceFolders parses the real node flat-map alias shape', async () => {
  const folders = await withFetch(
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
    () => listNamespaceFolders(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(folders, [{ contextId: 'ctx-1', name: 'frontend' }]);
});

test('listNamespaceFolders prefers the group-entry name over the alias when both are present', async () => {
  const folders = await withFetch(
    foldersFetch(
      [{ contextId: 'ctx-1', name: 'core' }],
      [{ name: 'stale-alias', value: 'ctx-1' }],
    ),
    () => listNamespaceFolders(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(folders, [{ contextId: 'ctx-1', name: 'core' }]);
});

test('listNamespaceFolders dedupes when two aliases point at the same context', async () => {
  const folders = await withFetch(
    foldersFetch(
      [{ contextId: 'ctx-1' }],
      [{ name: 'first', value: 'ctx-1' }, { name: 'second', value: 'ctx-1' }],
    ),
    () => listNamespaceFolders(namespaceConfig, 'ns-1'),
  );
  assert.deepEqual(folders, [{ contextId: 'ctx-1', name: 'first' }]);
});

test('listNamespaceFolders throws when the contexts fetch fails', async () => {
  await assert.rejects(
    () =>
      withFetch(
        (async (url: string | URL) =>
          String(url).includes('/contexts')
            ? new Response('nope', { status: 500 })
            : new Response(JSON.stringify({ data: { aliases: [] } }), { status: 200 })) as typeof fetch,
        () => listNamespaceFolders(namespaceConfig, 'ns-1'),
      ),
    /500/,
  );
});

// ---- pickFolder ----

const folders: NamespaceFolder[] = [
  { contextId: 'ctx-1', name: 'frontend' },
  { contextId: 'ctx-2', name: 'backend' },
];

test('pickFolder returns the named match when wanted is set', () => {
  assert.deepEqual(pickFolder(folders, 'backend'), { contextId: 'ctx-2', name: 'backend' });
});

test('pickFolder throws a helpful error listing available folders when the wanted name is not found', () => {
  assert.throws(() => pickFolder(folders, 'missing'), /"missing" not found.*frontend.*backend/s);
});

test('pickFolder returns the only folder when none is wanted', () => {
  assert.deepEqual(pickFolder([folders[0]]), folders[0]);
});

test('pickFolder throws when multiple folders exist and none is wanted', () => {
  assert.throws(() => pickFolder(folders), /Multiple folders exist.*frontend.*backend/s);
});

test('pickFolder throws when no folders exist', () => {
  assert.throws(() => pickFolder([]), /No folders found/);
});

// ---- createFolderLister ----

test('createFolderLister caches across calls and does not re-fetch', async () => {
  let namespaceFetches = 0;
  let foldersFetches = 0;
  const listFolders = createFolderLister(namespaceConfig);

  const impl = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/admin-api/namespaces')) {
      namespaceFetches += 1;
      return new Response(JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team' }] }), { status: 200 });
    }
    if (u.includes('/contexts')) {
      foldersFetches += 1;
      return new Response(JSON.stringify({ data: [{ contextId: 'ctx-1' }] }), { status: 200 });
    }
    if (u.includes('/alias/list/context')) {
      return new Response(JSON.stringify({ data: { aliases: [{ name: 'frontend', value: 'ctx-1' }] } }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const first = await withFetch(impl, () => listFolders());
  const second = await withFetch(impl, () => listFolders());

  assert.deepEqual(first, [{ contextId: 'ctx-1', name: 'frontend' }]);
  assert.deepEqual(second, first);
  assert.equal(namespaceFetches, 1);
  assert.equal(foldersFetches, 1);
});

test('createFolderLister does not cache a rejected resolution', async () => {
  let attempt = 0;
  const listFolders = createFolderLister(namespaceConfig);

  await withFetch(
    (async () => {
      attempt += 1;
      return new Response('nope', { status: 500 });
    }) as typeof fetch,
    () => assert.rejects(() => listFolders(), /500/),
  );

  const folders2 = await withFetch(
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
    () => listFolders(),
  );
  assert.deepEqual(folders2, [{ contextId: 'ctx-1', name: 'frontend' }]);
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

test('createTargetResolver resolves the explicit folder param over BOARD_FOLDER', async () => {
  const cfg: Config = { ...namespaceConfig, folderDefault: 'backend' };
  const target = createTargetResolver(cfg);
  const resolved = await withFetch(fullNamespaceFetch(), () => target('frontend'));
  assert.deepEqual(resolved, { contextId: 'ctx-1', executorPublicKey: 'exec-frontend' });
});

test('createTargetResolver falls back to BOARD_FOLDER when no folder param is given', async () => {
  const cfg: Config = { ...namespaceConfig, folderDefault: 'backend' };
  const target = createTargetResolver(cfg);
  const resolved = await withFetch(fullNamespaceFetch(), () => target());
  assert.deepEqual(resolved, { contextId: 'ctx-2', executorPublicKey: 'exec-backend' });
});

test('createTargetResolver infers the single folder when neither folder param nor BOARD_FOLDER is set', async () => {
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

test('createTargetResolver rejects with a helpful error when the folder param does not match', async () => {
  const target = createTargetResolver(namespaceConfig);
  await assert.rejects(
    () => withFetch(fullNamespaceFetch(), () => target('nope')),
    /"nope" not found.*frontend.*backend/s,
  );
});

test('createTargetResolver resolves a folder param against the real node flat-map alias shape', async () => {
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

test('createTargetResolver ignores the folder param when BOARD_CONTEXT pins a context directly', async () => {
  const target = createTargetResolver(baseConfig);
  const resolved = await withFetch(
    (async (url: string | URL) => {
      if (String(url).includes('alias/lookup')) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ data: { identities: ['exec-1'] } }), { status: 200 });
    }) as typeof fetch,
    () => target('frontend'),
  );
  assert.deepEqual(resolved, { contextId: 'my-board', executorPublicKey: 'exec-1' });
});
