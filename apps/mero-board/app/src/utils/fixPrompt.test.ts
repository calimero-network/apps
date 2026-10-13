import { describe, it, expect } from 'vitest';
import { buildFixPrompt, type IssueForPrompt } from './fixPrompt';

const issue: IssueForPrompt = {
  id: 'issue-1',
  title: 'Login fails',
  summary: 'Users cannot log in',
  impact: 'Blocks all users',
  repro: 'Open app, click login',
  resolution_criteria: 'Login succeeds',
};

describe('buildFixPrompt', () => {
  it('fills every placeholder from the issue record', () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toMatch(/Issue issue-1: Login fails/);
    expect(prompt).toMatch(/## Summary\nUsers cannot log in/);
    expect(prompt).toMatch(/## Impact\nBlocks all users/);
    expect(prompt).toMatch(/## Repro\nOpen app, click login/);
    expect(prompt).toMatch(/## Resolution criteria\nLogin succeeds/);
  });

  it('includes every required section header', () => {
    const prompt = buildFixPrompt(issue);
    for (const heading of ['## Summary', '## Impact', '## Repro', '## Resolution criteria', '## Instructions']) {
      expect(prompt).toContain(heading);
    }
  });
});
