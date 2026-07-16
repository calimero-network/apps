// keep in sync with mcp/src/fixPrompt.ts

/** The fields of an issue needed to build a fix prompt. */
export interface IssueForPrompt {
  id: string;
  title: string;
  summary: string;
  impact: string;
  repro: string;
  resolution_criteria: string;
}

/** Builds the "Copy fix prompt" text shown in the Local agent card. `repoUrl`
 *  is the active repo's GitHub URL; omitted from the prompt when empty. */
export function buildFixPrompt(issue: IssueForPrompt, repoUrl?: string): string {
  const repoLine = repoUrl && repoUrl.trim() ? `\nRepository: ${repoUrl.trim()}` : '';
  return `You are fixing a tracked issue. Work systematically; do not skip validation.

Issue ${issue.id}: ${issue.title}${repoLine}

## Summary
${issue.summary}

## Impact
${issue.impact}

## Repro
${issue.repro}

## Resolution criteria
${issue.resolution_criteria}

## Instructions
1. Reproduce first: follow the repro steps/logs above and confirm the bug exists before changing any code. If you cannot reproduce, stop and report why.
2. Find the root cause, not the symptom. Check every caller of anything you change.
3. Fix with the smallest correct change.
4. Validate per this repo's AGENTS.md: choose unit tests vs merobox e2e workflow according to the bug type, add the regression test, and prove the fix against every resolution criterion above.
5. Open a PR describing what changed and the test plan (no agent attribution anywhere).
6. Babysit the PR: address meroreviewer comments, resolve threads without replying to them, iterate until LGTM and CI is green.`;
}
