import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from './config.ts';
import { callMethod, resolveContextId, resolveExecutor, RpcError } from './rpc.ts';

const baseConfig: Config = {
  nodeUrl: 'http://localhost:2428',
  contextRaw: 'my-tracker',
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
