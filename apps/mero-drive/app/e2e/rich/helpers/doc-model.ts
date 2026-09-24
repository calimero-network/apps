// Pure readings of what a node returned. Every scenario asserts one of these
// against a literal, never that two windows happen to look alike.

import type { Block, Span } from '../../../src/generated/docs/DocsClient';

export function blockText(block: Block): string {
  return block.spans.map((span) => span.text).join('');
}

/** `bold=true|link=x:text` per span, the shape a spans assertion compares. */
export function spanSummary(block: Block): string[] {
  return block.spans.map(
    (span: Span) =>
      `${Object.entries(span.attributes ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('|')}:${span.text}`,
  );
}

/** Non-overlapping occurrences of `needle`; 1 means the passage stayed contiguous. */
export function occurrences(haystack: string, needle: string): number {
  if (needle === '') throw new Error('occurrences needs a non-empty needle');
  return haystack.split(needle).length - 1;
}

/** True when every character of `expected` appears in `text` exactly as often. */
export function sameCharacterCounts(text: string, expected: string): boolean {
  const tally = (value: string) => {
    const counts = new Map<string, number>();
    for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
    return counts;
  };
  const left = tally(text);
  const right = tally(expected);
  if (left.size !== right.size) return false;
  for (const [char, count] of right) {
    if (left.get(char) !== count) return false;
  }
  return true;
}
