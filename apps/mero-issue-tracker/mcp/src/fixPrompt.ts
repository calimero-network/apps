/** The fields of an issue needed to build a fix prompt. */
export interface IssueForPrompt {
  id: string;
  title: string;
  summary: string;
  impact: string;
  repro: string;
  resolution_criteria: string;
}

const PLACEHOLDER = 'FIX_PROMPT_TEMPLATE not yet authored (task 7)';

/**
 * Builds the prompt text for `get_fix_prompt`. Placeholder until task 7 authors
 * the real template — every caller routes through here so task 7 only edits
 * this file.
 */
export function buildFixPrompt(_issue: IssueForPrompt): string {
  return PLACEHOLDER;
}
