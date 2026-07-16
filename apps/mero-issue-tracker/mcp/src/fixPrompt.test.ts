import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixPrompt, type IssueForPrompt } from './fixPrompt.ts';

test('buildFixPrompt returns the not-yet-authored placeholder', () => {
  const issue: IssueForPrompt = {
    id: 'issue-1',
    title: 'Login fails',
    summary: 'Users cannot log in',
    impact: 'Blocks all users',
    repro: 'Open app, click login',
    resolution_criteria: 'Login succeeds',
  };
  assert.equal(buildFixPrompt(issue), 'FIX_PROMPT_TEMPLATE not yet authored (task 7)');
});
