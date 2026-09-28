import * as React from 'react';

import { isHigh, isLow } from '@/lib/rich/offsets';

export interface HighlightRange {
  start: number;
  end: number;
}

interface HighlightProps {
  text: string;
  ranges: HighlightRange[];
}

// A boundary between a high and low surrogate would split one UTF-16
// character across two <mark> runs; widen it to the code point edge instead.
function isMidSurrogatePair(text: string, index: number): boolean {
  return isHigh(text.charCodeAt(index - 1)) && isLow(text.charCodeAt(index));
}

// Clamps ranges to the text, snaps surrogate-pair boundaries outward, then
// sorts and merges overlaps so rendering can walk the text once.
function normalizeRanges(
  text: string,
  ranges: HighlightRange[],
): HighlightRange[] {
  const bounded = ranges
    .map(({ start, end }) => {
      const lo = Math.max(0, Math.min(start, end));
      const hi = Math.min(text.length, Math.max(start, end));
      return {
        start: isMidSurrogatePair(text, lo) ? lo - 1 : lo,
        end: isMidSurrogatePair(text, hi) ? hi + 1 : hi,
      };
    })
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged: HighlightRange[] = [];
  for (const range of bounded) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function Highlight({ text, ranges }: HighlightProps) {
  const merged = normalizeRanges(text, ranges);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, i) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark
        key={i}
        className="rounded-[2px] bg-selected font-semibold text-selected-foreground"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
