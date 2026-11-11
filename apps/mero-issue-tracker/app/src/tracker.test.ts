import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CALLS, VIEWS, tracker } from './tracker';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../logic/res/abi.json'), 'utf8')) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const WIRE_ISSUE = {
  id: 'issue-1-aa',
  title: 'T',
  summary: 's',
  impact: 'i',
  repro: 'r',
  resolutionCriteria: 'rc',
  status: 'Open',
  priority: 'high',
  assignee: null,
  labels: ['bug'],
  createdBy: 'acct-a',
  createdAt: '1700000000000',
};

describe('the client covers the contract', () => {
  it('calls exactly the contract calls, and views exactly its views', () => {
    expect([...CALLS].sort()).toEqual(byKind('call'));
    expect([...VIEWS].sort()).toEqual(byKind('view'));
    expect(byKind('init')).toEqual(['init']);
  });

  it('sends each method the parameter names the ABI declares', async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result =
        method === 'getIssue'
          ? { issue: WIRE_ISSUE, comments: [] }
          : method === 'listIssues' || method === 'getStatusCounts'
            ? []
            : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const t = tracker(withRoutes({ call: vi.fn(record), view: vi.fn(record) }), 'app-1');
    await Promise.all([
      t.setRepoUrl('https://x'),
      t.getRepoInfo(),
      t.createIssue({ title: 't', summary: 's', impact: 'i', repro: 'r', resolutionCriteria: 'rc', priority: 'low', labels: [] }),
      t.setStatus('i', 'Done'),
      t.setSummary('i', 's'),
      t.setImpact('i', 'i'),
      t.setRepro('i', 'r'),
      t.setResolutionCriteria('i', 'rc'),
      t.setPriority('i', 'low'),
      t.setAssignee('i', null),
      t.addLabel('i', 'l'),
      t.removeLabel('i', 'l'),
      t.listIssues({ status: null, assignee: null, label: null }),
      t.getIssue('i'),
      t.getStatusCounts(),
      t.addComment('i', 'b'),
      t.editComment('c', 'b'),
      t.deleteComment('c'),
      t.deleteIssue('i'),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === 'init') continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe('tracker', () => {
  it('turns the wire shapes into the views the screens render', async () => {
    const view = vi.fn(async (_app: string, method: string) => ({
      index: 2,
      result:
        method === 'getIssue'
          ? {
              issue: WIRE_ISSUE,
              comments: [
                { id: 'c1', issueId: 'issue-1-aa', author: 'acct-b', body: 'hi', createdAt: '5', editedAt: '7' },
              ],
            }
          : [{ status: 'Open', count: '3' }],
    }));
    const t = tracker(withRoutes({ call: vi.fn(), view }), 'app-1');
    const detail = await t.getIssue('issue-1-aa');
    expect(detail.issue.resolution_criteria).toBe('rc');
    expect(detail.issue.created_by).toBe('acct-a');
    expect(detail.issue.created_at).toBe(1700000000000);
    expect(detail.comments[0]).toEqual({
      id: 'c1',
      issue_id: 'issue-1-aa',
      author: 'acct-b',
      body: 'hi',
      created_at: 5,
      edited_at: 7,
    });
    expect(await t.getStatusCounts()).toEqual([{ status: 'Open', count: 3 }]);
    expect(view).toHaveBeenCalledWith('app-1', 'getIssue', { issueId: 'issue-1-aa' });
  });

  it('routes calls through the log and runs `after` even when one fails', async () => {
    const call = vi.fn().mockResolvedValueOnce({ index: 3, result: 'issue-9', events: [] }).mockRejectedValueOnce(new Error('boom'));
    const after = vi.fn();
    const t = tracker(withRoutes({ call, view: vi.fn() }), 'app-1', after);
    expect(
      await t.createIssue({ title: 't', summary: 's', impact: 'i', repro: 'r', resolutionCriteria: 'rc', priority: 'low', labels: ['x'] }),
    ).toBe('issue-9');
    expect(call).toHaveBeenCalledWith('app-1', 'createIssue', {
      title: 't',
      summary: 's',
      impact: 'i',
      repro: 'r',
      resolutionCriteria: 'rc',
      priority: 'low',
      labels: ['x'],
    });
    await expect(t.deleteIssue('i')).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(2);
  });
});
