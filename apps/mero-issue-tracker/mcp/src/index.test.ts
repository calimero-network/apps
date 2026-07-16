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
  getFixPromptShape,
  createIssue,
  listIssues,
  getIssue,
  addComment,
  assignIssue,
  getFixPrompt,
  createServer,
} from './index.ts';

const cfg: Config = { nodeUrl: 'http://localhost:2428', contextRaw: 'ctx' };
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
