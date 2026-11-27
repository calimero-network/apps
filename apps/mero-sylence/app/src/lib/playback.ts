import type { SegmentView } from "../generated/client";

/**
 * Playback's pure half: which line is being said at a time, and the speaker
 * timeline drawn under the scrubber. `playback.test.ts` pins both.
 */

type Timed = Pick<SegmentView, "startMs" | "endMs">;

/**
 * The index in `lines` (sorted by `startMs`) of the line being said at `ms`:
 * the last one that started by then. -1 before the first line, and once the
 * last line ended more than `tailMs` ago.
 */
export function activeIndex(lines: readonly Timed[], ms: number, tailMs = 4_000): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return -1;
  const line = lines[found]!;
  const next = lines[found + 1];
  if (!next && ms > line.endMs + tailMs) return -1;
  return found;
}

export interface Lane {
  label: string;
  /** Spans as fractions of the recording, 0–1. */
  spans: { from: number; to: number }[];
}

/**
 * One lane per speaker (in `order`), each the stretches they spoke, merged
 * where the gap is under `mergeMs`. `durationMs` is the recording's length.
 */
export function speakerLanes<T extends Timed>(
  lines: readonly T[],
  labelOf: (line: T) => string,
  order: readonly string[],
  durationMs: number,
  mergeMs = 1_500,
): Lane[] {
  const total = Math.max(durationMs, ...lines.map((l) => l.endMs), 1);
  const raw = new Map<string, { from: number; to: number }[]>(order.map((label) => [label, []]));
  for (const line of [...lines].sort((a, b) => a.startMs - b.startMs)) {
    const label = labelOf(line);
    let spans = raw.get(label);
    if (!spans) {
      spans = [];
      raw.set(label, spans);
    }
    const last = spans[spans.length - 1];
    if (last && line.startMs - last.to < mergeMs) last.to = Math.max(last.to, line.endMs);
    else spans.push({ from: line.startMs, to: Math.max(line.endMs, line.startMs + 200) });
  }
  return [...raw].map(([label, spans]) => ({
    label,
    spans: spans.map((s) => ({ from: Math.min(1, s.from / total), to: Math.min(1, s.to / total) })),
  }));
}

/** Playback speeds offered, in order. */
export const RATES = [1, 1.25, 1.5, 2] as const;

/** The next speed after `rate`, wrapping. */
export function nextRate(rate: number): number {
  const i = RATES.findIndex((r) => r === rate);
  return RATES[(i + 1) % RATES.length]!;
}

/** Speaker colors, by position in the talk stats (CSS variables `--spk-0` … `--spk-7`). */
export function speakerColor(index: number): string {
  return `var(--spk-${((index % 8) + 8) % 8})`;
}
