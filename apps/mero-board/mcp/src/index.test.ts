import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Config } from './config.ts';
import type { ResolvedTarget } from './rpc.ts';
import {
  shapes,
  createCard,
  listCards,
  moveCard,
  moveList,
  setCard,
  listFolders,
  addFolder,
  createServer,
} from './index.ts';

const cfg: Config = { nodeUrl: 'http://localhost:2428', contextRaw: 'ctx', serviceName: 'board' };
const target: ResolvedTarget = { contextId: 'ctx-1' };

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

interface SentCall {
  method: string;
  args: Record<string, unknown>;
  contextId: string;
}

/**
 * A mocked /jsonrpc endpoint: records every app method call and answers each
 * from `outputs` (keyed by method name; a function gets the call's args).
 */
function jsonrpcMock(outputs: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {}) {
  const calls: SentCall[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    assert.ok(String(url).endsWith('/jsonrpc'), `unexpected fetch: ${String(url)}`);
    const { params } = JSON.parse(String(init?.body));
    calls.push({
      method: params.method,
      args: params.argsJson,
      contextId: params.contextId,
    });
    const out = outputs[params.method];
    const output = typeof out === 'function' ? (out as (a: Record<string, unknown>) => unknown)(params.argsJson) : out ?? null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output } }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

// A board with two lists: todo [a(i), b(r)] and doing [d(i)].
const board = {
  board: { id: 'board-1' },
  lists: [
    { id: 'todo', rank: 'i' },
    { id: 'doing', rank: 'r' },
  ],
  cards: [
    { id: 'a', list_id: 'todo', rank: 'i' },
    { id: 'b', list_id: 'todo', rank: 'r' },
    { id: 'd', list_id: 'doing', rank: 'i' },
  ],
};

// ---- Schemas ----

test('create_card schema requires board_id, list_id and title; labels default to []', () => {
  const schema = z.object(shapes.createCard);
  assert.equal(schema.safeParse({ board_id: 'b', title: 'T' }).success, false);
  const parsed = schema.parse({ board_id: 'b', list_id: 'l', title: 'T' });
  assert.deepEqual(parsed.labels, []);
  assert.equal(schema.safeParse({ board_id: 'b', list_id: 'l', title: 'x'.repeat(65) }).success, false);
});

test('move_card schema accepts top, bottom and after:<id> only', () => {
  const schema = z.object(shapes.moveCard);
  for (const position of ['top', 'bottom', 'after:card-1']) {
    assert.equal(schema.safeParse({ card_id: 'c', list_id: 'l', position }).success, true, position);
  }
  for (const position of ['middle', 'after:', 'Top']) {
    assert.equal(schema.safeParse({ card_id: 'c', list_id: 'l', position }).success, false, position);
  }
});

test('set_card schema distinguishes null (clear) from omitted', () => {
  const schema = z.object(shapes.setCard);
  const cleared = schema.parse({ card_id: 'c', assignee: null, due_at: null });
  assert.equal(cleared.assignee, null);
  assert.equal(cleared.due_at, null);
  const omitted = schema.parse({ card_id: 'c' });
  assert.equal('assignee' in omitted ? omitted.assignee : undefined, undefined);
  assert.equal('due_at' in omitted ? omitted.due_at : undefined, undefined);
});

// ---- Request shaping ----

test('createCard sends create_card with rank null and nulls for omitted optionals', async () => {
  const { impl, calls } = jsonrpcMock({ create_card: 'card-1' });
  const id = await withFetch(impl, () =>
    createCard(cfg, target, { board_id: 'board-1', list_id: 'todo', title: 'Write it', labels: [] }),
  );
  assert.equal(id, 'card-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'create_card');
  assert.equal(calls[0].contextId, 'ctx-1');
  assert.deepEqual(calls[0].args, {
    board_id: 'board-1',
    list_id: 'todo',
    title: 'Write it',
    description: null,
    assignee: null,
    due_at: null,
    labels: [],
    rank: null,
  });
});

test('createCard forwards provided optionals as given', async () => {
  const { impl, calls } = jsonrpcMock({ create_card: 'card-1' });
  await withFetch(impl, () =>
    createCard(cfg, target, {
      board_id: 'board-1',
      list_id: 'todo',
      title: 'Write it',
      description: 'Draft',
      assignee: 'acct',
      due_at: 1767225600000,
      labels: ['marketing'],
    }),
  );
  assert.deepEqual(calls[0].args, {
    board_id: 'board-1',
    list_id: 'todo',
    title: 'Write it',
    description: 'Draft',
    assignee: 'acct',
    due_at: 1767225600000,
    labels: ['marketing'],
    rank: null,
  });
});

test('listCards sends null for omitted filters and include_archived as given', async () => {
  const { impl, calls } = jsonrpcMock({ list_cards: [] });
  await withFetch(impl, () => listCards(cfg, target, { assignee: 'acct', include_archived: true }));
  assert.equal(calls[0].method, 'list_cards');
  assert.deepEqual(calls[0].args, {
    board_id: null,
    list_id: null,
    assignee: 'acct',
    label: null,
    include_archived: true,
  });
});

test('moveCard reads get_card then get_board, then sends move_card with a rank between the neighbours', async () => {
  const { impl, calls } = jsonrpcMock({
    get_card: { card: { id: 'd', list_id: 'doing', rank: 'i', board_id: 'board-1' } },
    get_board: board,
  });
  const result = await withFetch(impl, () => moveCard(cfg, target, { card_id: 'd', list_id: 'todo', position: 'after:a' }));
  assert.deepEqual(
    calls.map((c) => c.method),
    ['get_card', 'get_board', 'move_card'],
  );
  assert.deepEqual(calls[0].args, { card_id: 'd' });
  assert.deepEqual(calls[1].args, { board_id: 'board-1' });
  const rank = calls[2].args.rank as string;
  assert.ok(rank > 'i' && rank < 'r', `rank ${rank} not between a(i) and b(r)`);
  assert.deepEqual(calls[2].args, { card_id: 'd', list_id: 'todo', rank });
  assert.deepEqual(result, { card_id: 'd', list_id: 'todo', rank });
});

test('moveCard to top of a list ranks before its first card', async () => {
  const { impl, calls } = jsonrpcMock({
    get_card: { card: { id: 'd', list_id: 'doing', rank: 'i', board_id: 'board-1' } },
    get_board: board,
  });
  await withFetch(impl, () => moveCard(cfg, target, { card_id: 'd', list_id: 'todo', position: 'top' }));
  assert.ok((calls[2].args.rank as string) < 'i');
});

test('moveCard with after: naming a card in another list rejects without sending move_card', async () => {
  const { impl, calls } = jsonrpcMock({
    get_card: { card: { id: 'a', list_id: 'todo', rank: 'i', board_id: 'board-1' } },
    get_board: board,
  });
  await assert.rejects(
    () => withFetch(impl, () => moveCard(cfg, target, { card_id: 'a', list_id: 'todo', position: 'after:d' })),
    /not in list todo/,
  );
  assert.ok(!calls.some((c) => c.method === 'move_card'));
});

test('moveCard to a list on another board rejects without sending move_card', async () => {
  const { impl, calls } = jsonrpcMock({
    get_card: { card: { id: 'a', list_id: 'todo', rank: 'i', board_id: 'board-1' } },
    get_board: board,
  });
  await assert.rejects(
    () => withFetch(impl, () => moveCard(cfg, target, { card_id: 'a', list_id: 'elsewhere', position: 'top' })),
    /not on the card's board/,
  );
  assert.ok(!calls.some((c) => c.method === 'move_card'));
});

test('moveList finds the board of the list and sends move_list with a rank among its lists', async () => {
  const other = { board: { id: 'board-0' }, lists: [{ id: 'x', rank: 'i' }], cards: [] };
  const { impl, calls } = jsonrpcMock({
    list_boards: [{ id: 'board-0' }, { id: 'board-1' }],
    get_board: (args: Record<string, unknown>) => (args.board_id === 'board-1' ? board : other),
  });
  const result = await withFetch(impl, () => moveList(cfg, target, { list_id: 'doing', position: 'top' }));
  assert.deepEqual(calls[0], { method: 'list_boards', args: { include_archived: true }, contextId: 'ctx-1' });
  const last = calls[calls.length - 1];
  assert.equal(last.method, 'move_list');
  const rank = last.args.rank as string;
  assert.ok(rank < 'i', `rank ${rank} not before todo(i)`);
  assert.deepEqual(last.args, { list_id: 'doing', rank });
  assert.deepEqual(result, { list_id: 'doing', rank });
});

test('moveList with after: naming a list on another board rejects without sending move_list', async () => {
  const { impl, calls } = jsonrpcMock({ list_boards: [{ id: 'board-1' }], get_board: board });
  await assert.rejects(
    () => withFetch(impl, () => moveList(cfg, target, { list_id: 'doing', position: 'after:x' })),
    /not another list on the same board/,
  );
  assert.ok(!calls.some((c) => c.method === 'move_list'));
});

test('setCard with only archived sends exactly one set_card_archived call, then reads the card', async () => {
  const { impl, calls } = jsonrpcMock({ get_card: { card: { id: 'c' } } });
  await withFetch(impl, () => setCard(cfg, target, { card_id: 'c', archived: true }));
  const writes = calls.filter((c) => c.method !== 'get_card');
  assert.deepEqual(writes.map((c) => [c.method, c.args]), [['set_card_archived', { card_id: 'c', archived: true }]]);
});

test('setCard sends null to clear assignee and due_at, and skips omitted fields', async () => {
  const { impl, calls } = jsonrpcMock({ get_card: { card: { id: 'c' } } });
  await withFetch(impl, () => setCard(cfg, target, { card_id: 'c', title: 'New', assignee: null, due_at: null }));
  assert.deepEqual(
    calls.map((c) => [c.method, c.args]),
    [
      ['set_card_title', { card_id: 'c', title: 'New' }],
      ['set_card_assignee', { card_id: 'c', assignee: null }],
      ['set_card_due', { card_id: 'c', due_at: null }],
      ['get_card', { card_id: 'c' }],
    ],
  );
});

test('listFolders maps namespace folders to name + context_id', () => {
  assert.deepEqual(listFolders([{ contextId: 'ctx-1', name: 'marketing' }]), [
    { name: 'marketing', context_id: 'ctx-1' },
  ]);
});

// ---- addFolder (add_folder tool) ----

const nsCfg: Config = { nodeUrl: 'http://localhost:2428', namespaceRaw: 'my-team', serviceName: 'board' };

/** A mock fetch covering add_folder's full call graph; `existingContexts` seeds the duplicate check. */
function addFolderFetch(
  existingContexts: Array<{ contextId: string; name?: string }> = [],
  opts: { aliasFails?: boolean } = {},
): { impl: typeof fetch; calls: string[]; createBody: () => unknown } {
  const calls: string[] = [];
  let createBody: unknown;
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
      createBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: { contextId: 'ctx-new', memberPublicKey: 'member-key' } }), {
        status: 200,
      });
    }
    if (u.endsWith('/admin-api/alias/create/context')) {
      return opts.aliasFails
        ? new Response('boom', { status: 500 })
        : new Response(JSON.stringify({ data: {} }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { impl, calls, createBody: () => createBody };
}

test('addFolder creates a board context in the namespace, aliases it, and makes no app call', async () => {
  const { impl, calls, createBody } = addFolderFetch();
  const result = await withFetch(impl, () => addFolder(nsCfg, { name: ' marketing ' }));
  assert.deepEqual(result, { contextId: 'ctx-new', name: 'marketing' });
  assert.deepEqual(createBody(), {
    applicationId: 'app-1',
    groupId: 'ns-1',
    serviceName: 'board',
    name: 'marketing',
    initializationParams: [],
  });
  assert.ok(calls.some((c) => c.endsWith('/admin-api/alias/create/context')));
  assert.ok(!calls.some((c) => c.endsWith('/jsonrpc')));
});

test('addFolder rejects a duplicate folder name without calling createContext', async () => {
  const { impl, calls } = addFolderFetch([{ contextId: 'ctx-1', name: 'marketing' }]);
  await assert.rejects(() => withFetch(impl, () => addFolder(nsCfg, { name: 'marketing' })), /"marketing" already exists/);
  assert.ok(!calls.some((c) => c.endsWith('/admin-api/contexts') && c.startsWith('POST')));
});

test('addFolder rejects when BOARD_NAMESPACE is unset (context-pin mode)', async () => {
  let fetchCalled = false;
  await assert.rejects(
    () =>
      withFetch(
        (async () => {
          fetchCalled = true;
          throw new Error('should not be called');
        }) as typeof fetch,
        () => addFolder(cfg, { name: 'marketing' }),
      ),
    /BOARD_NAMESPACE/,
  );
  assert.equal(fetchCalled, false);
});

test('addFolder succeeds even when alias creation fails (best-effort)', async () => {
  const { impl } = addFolderFetch([], { aliasFails: true });
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (msg: string) => void logged.push(msg);
  try {
    const result = await withFetch(impl, () => addFolder(nsCfg, { name: 'marketing' }));
    assert.deepEqual(result, { contextId: 'ctx-new', name: 'marketing' });
    assert.match(logged.join('\n'), /alias creation for "marketing" failed/);
  } finally {
    console.error = originalError;
  }
});

// ---- Server ----

const EXPECTED_TOOLS = [
  'list_folders',
  'add_folder',
  'list_boards',
  'create_board',
  'rename_board',
  'archive_board',
  'delete_board',
  'get_board',
  'create_list',
  'rename_list',
  'move_list',
  'delete_list',
  'create_card',
  'list_cards',
  'get_card',
  'move_card',
  'set_card',
  'add_label',
  'remove_label',
  'add_checklist_item',
  'set_checklist_item_done',
  'add_comment',
  'delete_card',
];

async function connectedClient(serverCfg: Config = cfg) {
  const server = createServer(serverCfg);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return client;
}

test('add_folder refreshes list_folders in pinned (BOARD_CONTEXT + BOARD_NAMESPACE) mode', async () => {
  const contexts: Array<{ contextId: string; name?: string }> = [{ contextId: 'ctx-old', name: 'old' }];
  let listings = 0;
  const base = addFolderFetch(contexts).impl;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/admin-api/groups/') && u.includes('/contexts')) listings++;
    if (u.endsWith('/admin-api/contexts') && init?.method === 'POST') contexts.push({ contextId: 'ctx-new', name: 'fresh' });
    return base(url, init);
  }) as typeof fetch;
  const client = await connectedClient({ ...nsCfg, contextRaw: 'ctx-pin' });
  await withFetch(impl, async () => {
    await client.callTool({ name: 'list_folders', arguments: {} });
    await client.callTool({ name: 'list_folders', arguments: {} });
    assert.equal(listings, 1, 'second list_folders is served from cache');
    await client.callTool({ name: 'add_folder', arguments: { name: 'fresh' } });
    const before = listings;
    const res = await client.callTool({ name: 'list_folders', arguments: {} });
    assert.equal(listings, before + 1, 'list_folders re-fetches after add_folder');
    assert.match(JSON.stringify(res), /fresh/);
  });
});

test('createServer builds without resolving context (no network call)', () => {
  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('should not be called at construction time');
  }) as typeof fetch;
  try {
    assert.ok(createServer(cfg));
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('the server registers exactly the board tools', async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort());
  for (const t of tools) {
    if (t.name === 'list_folders' || t.name === 'add_folder') continue;
    assert.ok(t.inputSchema.properties && 'folder' in t.inputSchema.properties, `${t.name} takes no folder`);
  }
  await client.close();
});

test('pass-through tools drop folder and send the contract args (create_board passes rank null)', async () => {
  // Pinned context: the resolver looks up the alias first.
  const sent: SentCall[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/alias/lookup/context/')) {
      return new Response(JSON.stringify({ data: { value: 'ctx-1' } }), { status: 200 });
    }
    const { params } = JSON.parse(String(init?.body));
    sent.push({ method: params.method, args: params.argsJson, contextId: params.contextId });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: 'board-9' } }), { status: 200 });
  }) as typeof fetch;

  await withFetch(impl, async () => {
    const client = await connectedClient();
    const created = await client.callTool({ name: 'create_board', arguments: { name: 'Q4' } });
    assert.deepEqual(JSON.parse((created.content as Array<{ text: string }>)[0].text), { id: 'board-9' });
    await client.callTool({ name: 'archive_board', arguments: { board_id: 'board-9', archived: true } });
    await client.callTool({ name: 'set_checklist_item_done', arguments: { item_id: 'item-1', done: true } });
    await client.close();
  });

  assert.deepEqual(
    sent.map((c) => [c.method, c.args]),
    [
      ['create_board', { name: 'Q4', rank: null }],
      ['set_board_archived', { board_id: 'board-9', archived: true }],
      ['set_checklist_item_done', { item_id: 'item-1', done: true }],
    ],
  );
  assert.ok(sent.every((c) => c.contextId === 'ctx-1'));
});

/**
 * A namespace whose folder list grows: `contexts` is the live list the node
 * answers; POST /admin-api/contexts appends to it, as the real node would.
 */
function growingNamespaceFetch(contexts: Array<{ contextId: string; name: string }>) {
  const listings = { count: 0 };
  const sent: SentCall[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/admin-api/namespaces')) {
      return new Response(
        JSON.stringify({ data: [{ namespaceId: 'ns-1', name: 'my-team', targetApplicationId: 'app-1' }] }),
        { status: 200 },
      );
    }
    if (u.includes('/admin-api/groups/') && u.endsWith('/contexts')) {
      listings.count += 1;
      return new Response(JSON.stringify({ data: [...contexts] }), { status: 200 });
    }
    if (u.includes('/alias/list/context')) return new Response(JSON.stringify({ data: {} }), { status: 200 });
    if (u.endsWith('/admin-api/contexts') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      contexts.push({ contextId: 'ctx-new', name: body.name });
      return new Response(JSON.stringify({ data: { contextId: 'ctx-new', memberPublicKey: 'member-key' } }), { status: 200 });
    }
    if (u.endsWith('/admin-api/alias/create/context')) return new Response(JSON.stringify({ data: {} }), { status: 200 });
    if (u.endsWith('/jsonrpc')) {
      const { params } = JSON.parse(String(init?.body));
      sent.push({ method: params.method, args: params.argsJson, contextId: params.contextId });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { output: [] } }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
  return { impl, listings, sent };
}

const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content)[0].text;

test('after add_folder, list_folders and folder=<new> see the new folder without a restart', async () => {
  const { impl, sent } = growingNamespaceFetch([{ contextId: 'ctx-1', name: 'frontend' }]);
  await withFetch(impl, async () => {
    const client = await connectedClient(nsCfg);
    // Warm both caches with the one-folder listing.
    assert.deepEqual(JSON.parse(textOf(await client.callTool({ name: 'list_folders', arguments: {} }))), [
      { name: 'frontend', context_id: 'ctx-1' },
    ]);
    await client.callTool({ name: 'list_boards', arguments: { folder: 'frontend' } });

    const added = await client.callTool({ name: 'add_folder', arguments: { name: 'marketing' } });
    assert.equal(added.isError, undefined, textOf(added));

    assert.deepEqual(JSON.parse(textOf(await client.callTool({ name: 'list_folders', arguments: {} }))), [
      { name: 'frontend', context_id: 'ctx-1' },
      { name: 'marketing', context_id: 'ctx-new' },
    ]);
    const boards = await client.callTool({ name: 'list_boards', arguments: { folder: 'marketing' } });
    assert.equal(boards.isError, undefined, textOf(boards));
    await client.close();
  });
  assert.deepEqual(
    sent.map((c) => c.contextId),
    ['ctx-1', 'ctx-new'],
  );
});

test('a folder added elsewhere (e.g. in the app) resolves after one re-list on the miss', async () => {
  const contexts = [{ contextId: 'ctx-1', name: 'frontend' }];
  const { impl, listings, sent } = growingNamespaceFetch(contexts);
  await withFetch(impl, async () => {
    const client = await connectedClient(nsCfg);
    await client.callTool({ name: 'list_boards', arguments: { folder: 'frontend' } });
    assert.equal(listings.count, 1);
    contexts.push({ contextId: 'ctx-ui', name: 'design' });
    const boards = await client.callTool({ name: 'list_boards', arguments: { folder: 'design' } });
    assert.equal(boards.isError, undefined, textOf(boards));
    assert.equal(listings.count, 2, 'exactly one fresh listing on the miss');
    const missing = await client.callTool({ name: 'list_boards', arguments: { folder: 'nope' } });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /Folder "nope" not found/);
    assert.equal(listings.count, 3, 'a real miss re-lists once, then reports');
    await client.close();
  });
  assert.deepEqual(sent.map((c) => c.contextId), ['ctx-1', 'ctx-ui']);
});

test('a guest error in the rc.81+ text shape reaches the agent as the contract message', async () => {
  const impl = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/alias/lookup/context/')) return new Response(JSON.stringify({ data: { value: 'ctx-1' } }), { status: 200 });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: {
          type: 'FunctionCallError',
          data: 'the method call returned an error: {"data":"list still holds cards; move or archive them first","kind":"Invalid"}',
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  await withFetch(impl, async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: 'delete_list', arguments: { list_id: 'list-1' } });
    assert.equal(res.isError, true);
    assert.equal(textOf(res), 'Error: Invalid: list still holds cards; move or archive them first');
    await client.close();
  });
});
