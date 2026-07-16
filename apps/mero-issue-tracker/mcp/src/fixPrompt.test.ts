import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixPrompt, type IssueForPrompt } from './fixPrompt.ts';

const issue: IssueForPrompt = {
  id: 'issue-1',
  title: 'Login fails',
  summary: 'Users cannot log in',
  impact: 'Blocks all users',
  repro: 'Open app, click login',
  resolution_criteria: 'Login succeeds',
};

test('buildFixPrompt fills every placeholder from the issue record', () => {
  const prompt = buildFixPrompt(issue);
  assert.match(prompt, /Issue issue-1: Login fails/);
  assert.match(prompt, /## Summary\nUsers cannot log in/);
  assert.match(prompt, /## Impact\nBlocks all users/);
  assert.match(prompt, /## Repro\nOpen app, click login/);
  assert.match(prompt, /## Resolution criteria\nLogin succeeds/);
});

test('buildFixPrompt includes every required section header', () => {
  const prompt = buildFixPrompt(issue);
  for (const heading of ['## Summary', '## Impact', '## Repro', '## Resolution criteria', '## Instructions']) {
    assert.ok(prompt.includes(heading), `missing section: ${heading}`);
  }
});

test('buildFixPrompt includes the fixed instruction steps', () => {
  const prompt = buildFixPrompt(issue);
  assert.match(prompt, /Reproduce first/);
  assert.match(prompt, /Find the root cause, not the symptom/);
  assert.match(prompt, /Babysit the PR/);
});
