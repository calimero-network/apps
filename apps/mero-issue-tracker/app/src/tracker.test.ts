import { describe, expect, it, vi } from 'vitest';

import { MeroIssueTrackerClient } from './generated/client';
import { toIssueDetail, toStatusCounts } from './tracker';
import { withRoutes } from '@calimero-apps/connect/testing';

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

describe('the board through the generated client', () => {
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
    const t = new MeroIssueTrackerClient(withRoutes({ call: vi.fn(), view }), 'app-1');
    const detail = toIssueDetail(await t.getIssue({ issueId: 'issue-1-aa' }));
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
    expect(toStatusCounts(await t.getStatusCounts())).toEqual([{ status: 'Open', count: 3 }]);
    expect(view).toHaveBeenCalledWith('app-1', 'getIssue', { issueId: 'issue-1-aa' });
  });

  it('routes calls through the log and runs `after` even when one fails', async () => {
    const call = vi.fn().mockResolvedValueOnce({ index: 3, result: 'issue-9', events: [] }).mockRejectedValueOnce(new Error('boom'));
    const after = vi.fn();
    const t = new MeroIssueTrackerClient(withRoutes({ call, view: vi.fn() }), 'app-1', { after });
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
    await expect(t.deleteIssue({ issueId: 'i' })).rejects.toThrow('boom');
    expect(after).toHaveBeenCalledTimes(2);
  });
});
