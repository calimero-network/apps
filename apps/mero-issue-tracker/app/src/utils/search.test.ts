import { describe, it, expect } from 'vitest';
import { matchesQuery } from './search';
import type { IssueView } from '../hooks/useItems';

function issue(overrides: Partial<IssueView> = {}): IssueView {
  return {
    id: 'abc12345',
    title: 'Sync fails on reconnect',
    summary: 'Peer drops mid-sync',
    impact: 'Board goes stale',
    repro: 'Kill node B during a push',
    resolution_criteria: 'Reconnect resumes without data loss',
    status: 'Open',
    priority: 'high',
    assignee: null,
    labels: ['networking', 'crdt'],
    created_by: 'x',
    created_at: 0,
    ...overrides,
  };
}

describe('matchesQuery', () => {
  it('matches on title', () => {
    expect(matchesQuery(issue(), 'reconnect')).toBe(true);
  });

  it('matches on summary', () => {
    expect(matchesQuery(issue(), 'drops mid-sync')).toBe(true);
  });

  it('matches on impact', () => {
    expect(matchesQuery(issue(), 'stale')).toBe(true);
  });

  it('matches on repro', () => {
    expect(matchesQuery(issue(), 'kill node b')).toBe(true);
  });

  it('matches on resolution_criteria', () => {
    expect(matchesQuery(issue(), 'data loss')).toBe(true);
  });

  it('matches on a label', () => {
    expect(matchesQuery(issue(), 'crdt')).toBe(true);
  });

  it('matches on the issue id', () => {
    expect(matchesQuery(issue(), 'abc123')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesQuery(issue(), 'RECONNECT')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesQuery(issue(), '')).toBe(true);
  });

  it('a whitespace-only query matches everything', () => {
    expect(matchesQuery(issue(), '   ')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesQuery(issue(), 'nonexistent-term')).toBe(false);
  });
});
