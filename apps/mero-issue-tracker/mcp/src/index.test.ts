import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Client, ResolvedTarget } from './node.ts';
import {
  createIssueShape,
  listIssuesShape,
  getIssueShape,
  addCommentShape,
  assignIssueShape,
  setStatusShape,
  setPriorityShape,
  deleteIssueShape,
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
  deleteIssue,
  getFixPrompt,
  listRepos,
  addRepo,
  createServer,
} from './index.ts';

const cfg: Config = {
  target: { kind: 'local', nodes: ['http://127.0.0.1:2501'] },
  apiKey: 'key',
  workspaceRaw: 'Platform',
  source: { package: 'com.calimero.mero-issue-tracker' },
};
const target: ResolvedTarget = { appId: 'app-1' };

interface Sent {
  kind: 'call' | 'view';
  app: string;
  method: string;
  args: unknown;
}

/** A client that records what it is sent and answers from `results` by method name. */
function fakeClient(results: Record<string, unknown> = {}, apps: Array<{ appId: string; name: string; org: string | null }> = []) {
  const sent: Sent[] = [];
  const created: Array<{ name: string; source: unknown; options: unknown }> = [];
  const answer = (kind: Sent['kind']) => async (app: string, method: string, args?: unknown) => {
    sent.push({ kind, app, method, args });
    const r = results[method];
    return { index: 1, result: typeof r === 'function' ? (r as (a: string) => unknown)(app) : (r ?? null), events: [] };
  };
  const client = {
    call: answer('call'),
    view: answer('view'),
    me: async () => ({ orgs: [{ orgId: 'org-1', name: 'Platform', role: 'owner' }] }),
    listApps: async () =>
      apps.map((a) => ({ ...a, owner: 'acct', bundle: 'b', package: 'com.calimero.mero-issue-tracker', version: '1' })),
    createApp: async (name: string, source: unknown, options: unknown) => {
      created.push({ name, source, options });
      return 'app-new';
    },
  } as unknown as Client;
  return { client, sent, created };
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

test('delete_issue schema requires a non-empty issue_id', () => {
  const schema = z.object(deleteIssueShape);
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ issue_id: '' }).success, false);
  assert.equal(schema.safeParse({ issue_id: 'issue-1' }).success, true);
});

test('delete_issue schema accepts an optional repo param', () => {
  const schema = z.object(deleteIssueShape);
  const result = schema.safeParse({ issue_id: 'issue-1', repo: 'some-other-repo' });
  assert.equal(result.success, true);
});

test('get_fix_prompt schema requires a non-empty id', () => {
  const schema = z.object(getFixPromptShape);
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ id: 'issue-1' }).success, true);
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

// ---- Request shaping: ABI names (camelCase), calls vs views ----

test('createIssue calls createIssue with all seven fields, camelCase', async () => {
  const { client, sent } = fakeClient({ createIssue: 'issue-1' });
  const id = await createIssue(client, target, {
    title: 'Bug',
    summary: 'S',
    impact: 'I',
    repro: 'R',
    resolution_criteria: 'C',
    priority: 'high',
    labels: ['ui'],
  });
  assert.equal(id, 'issue-1');
  assert.deepEqual(sent, [
    {
      kind: 'call',
      app: 'app-1',
      method: 'createIssue',
      args: { title: 'Bug', summary: 'S', impact: 'I', repro: 'R', resolutionCriteria: 'C', priority: 'high', labels: ['ui'] },
    },
  ]);
});

test('listIssues is a view and sends null for omitted filters', async () => {
  const { client, sent } = fakeClient({ listIssues: [] });
  await listIssues(client, target, { status: 'Open' });
  assert.deepEqual(sent, [
    { kind: 'view', app: 'app-1', method: 'listIssues', args: { status: 'Open', assignee: null, label: null } },
  ]);
});

test('the issue tools send issueId, and each to its own method', async () => {
  const { client, sent } = fakeClient({ getIssue: { issue: {}, comments: [] } });
  await getIssue(client, target, { id: 'i-1' });
  await addComment(client, target, { issue_id: 'i-1', body: 'hi' });
  await assignIssue(client, target, { issue_id: 'i-1', assignee: 'bob' });
  await setStatus(client, target, { issue_id: 'i-1', status: 'Done' });
  await setPriority(client, target, { issue_id: 'i-1', priority: 'low' });
  await deleteIssue(client, target, { issue_id: 'i-1' });
  assert.deepEqual(
    sent.map((s) => [s.kind, s.method, s.args]),
    [
      ['view', 'getIssue', { issueId: 'i-1' }],
      ['call', 'addComment', { issueId: 'i-1', body: 'hi' }],
      ['call', 'setAssignee', { issueId: 'i-1', assignee: 'bob' }],
      ['call', 'setStatus', { issueId: 'i-1', status: 'Done' }],
      ['call', 'setPriority', { issueId: 'i-1', priority: 'low' }],
      ['call', 'deleteIssue', { issueId: 'i-1' }],
    ],
  );
});

test('getFixPrompt fills the template from getIssue and getRepoInfo', async () => {
  const { client } = fakeClient({
    getIssue: {
      issue: {
        id: 'issue-7',
        title: 'Login broken',
        summary: 'Clicking login does nothing',
        impact: 'Nobody can sign in',
        repro: 'Click login',
        resolutionCriteria: 'Login works',
      },
      comments: [],
    },
    getRepoInfo: { repoUrl: 'https://github.com/acme/web' },
  });
  const prompt = await getFixPrompt(client, target, { id: 'issue-7' });
  for (const part of ['issue-7', 'Login broken', 'Clicking login does nothing', 'Nobody can sign in', 'Click login', 'Login works']) {
    assert.ok(prompt.includes(part), part);
  }
  assert.ok(prompt.includes('Repository: https://github.com/acme/web'));
});

test('listRepos reads repo_url from each repo app', async () => {
  const { client, sent } = fakeClient({ getRepoInfo: (app: string) => ({ repoUrl: `https://x/${app}` }) });
  const repos = await listRepos(client, [
    { appId: 'a-1', name: 'web' },
    { appId: 'a-2', name: 'api' },
  ]);
  assert.deepEqual(repos, [
    { name: 'web', repo_url: 'https://x/a-1' },
    { name: 'api', repo_url: 'https://x/a-2' },
  ]);
  assert.deepEqual(sent.map((s) => s.app), ['a-1', 'a-2']);
});

test('addRepo creates an instance in the workspace org and sets its repo_url', async () => {
  const { client, sent, created } = fakeClient({}, [{ appId: 'a-1', name: 'web', org: 'org-1' }]);
  const out = await addRepo(client, cfg, { name: 'api', github_url: 'https://github.com/acme/api' });
  assert.deepEqual(out, { appId: 'app-new', name: 'api', url: 'https://github.com/acme/api' });
  assert.deepEqual(created, [{ name: 'api', source: { package: 'com.calimero.mero-issue-tracker' }, options: { org: 'org-1' } }]);
  assert.deepEqual(sent, [
    { kind: 'call', app: 'app-new', method: 'setRepoUrl', args: { url: 'https://github.com/acme/api' } },
  ]);
});

test('addRepo refuses a name the workspace already has, creating nothing', async () => {
  const { client, created } = fakeClient({}, [{ appId: 'a-1', name: 'web', org: 'org-1' }]);
  await assert.rejects(addRepo(client, cfg, { name: 'web', github_url: 'https://x' }), /already exists/);
  assert.equal(created.length, 0);
});

test('addRepo needs a workspace (TRACKER_APP pins one repo)', async () => {
  const { client } = fakeClient();
  await assert.rejects(
    addRepo(client, { ...cfg, workspaceRaw: undefined, appRaw: 'app-1' }, { name: 'x', github_url: 'https://x' }),
    /TRACKER_WORKSPACE/,
  );
});

// ---- Server construction ----

test('createServer builds without connecting (no client until a tool runs)', () => {
  let connected = false;
  const server = createServer(cfg, async () => {
    connected = true;
    return fakeClient().client;
  });
  assert.ok(server);
  assert.equal(connected, false);
});
