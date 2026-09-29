import * as React from 'react';

import { isHigh, isLow } from '@/lib/rich/offsets';

const MARK_CLASS =
  'rounded-[2px] bg-selected font-semibold text-selected-foreground';

interface HighlightProps {
  text: string;
  ranges: [number, number][]; // [start, end) code unit offsets
  as?: 'mark' | 'b';
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
  ranges: [number, number][],
): [number, number][] {
  const bounded = ranges
    .map(([start, end]): [number, number] => {
      const lo = Math.max(0, Math.min(start, end));
      const hi = Math.min(text.length, Math.max(start, end));
      return [
        isMidSurrogatePair(text, lo) ? lo - 1 : lo,
        isMidSurrogatePair(text, hi) ? hi + 1 : hi,
      ];
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const range of bounded) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function Highlight({ text, ranges, as: Tag = 'mark' }: HighlightProps) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  normalizeRanges(text, ranges).forEach(([start, end], i) => {
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <Tag key={i} className={Tag === 'mark' ? MARK_CLASS : undefined}>
        {text.slice(start, end)}
      </Tag>,
    );
    cursor = end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
