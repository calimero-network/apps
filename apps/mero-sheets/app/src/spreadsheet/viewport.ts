/**
 * Which rows and columns are on screen, for a grid too big to render whole
 * (1000 rows × 702 columns). Each axis has a default size, per-index
 * overrides (resized rows and columns), and a number of frozen leading
 * entries that stay in view while the rest scrolls under them.
 */

/** The whole grid, as the engine lays out every sheet. */
export const GRID_ROWS = 1000;
export const GRID_COLS = 702;

export const DEFAULT_ROW_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 100;
export const MIN_ROW_HEIGHT = 16;
export const MIN_COL_WIDTH = 32;
export const MAX_AXIS_SIZE = 1000;

/** Positions and sizes along one axis. */
export class AxisMetrics {
  private readonly starts: Float64Array;

  constructor(readonly count: number, private readonly base: number, private readonly overrides: ReadonlyMap<number, number>) {
    this.starts = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) this.starts[i + 1] = this.starts[i] + this.size(i);
  }

  size(i: number): number {
    return this.overrides.get(i) ?? this.base;
  }

  /** Where entry `i` starts; `offset(count)` is the total length. */
  offset(i: number): number {
    return this.starts[Math.max(0, Math.min(i, this.count))];
  }

  get total(): number {
    return this.starts[this.count];
  }

  /** The entry covering `px`, clamped to the axis. */
  indexAt(px: number): number {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

/**
 * The scrolling entries to render: `[start, end)`, past the `frozen` ones,
 * for a viewport `length` long scrolled by `scroll`, with `overscan` extra
 * on each side.
 */
export function visibleRange(m: AxisMetrics, frozen: number, scroll: number, length: number, overscan = 3): { start: number; end: number } {
  const frozenLength = m.offset(frozen);
  const from = m.indexAt(scroll + frozenLength);
  const to = m.indexAt(scroll + Math.max(length, 0)) + 1;
  return {
    start: Math.max(frozen, from - overscan),
    end: Math.min(m.count, Math.max(to + overscan, frozen)),
  };
}

/**
 * The scroll that brings entry `i` fully into view, or `scroll` unchanged
 * when it already is (or is frozen, and so always in view).
 */
export function scrollToShow(m: AxisMetrics, frozen: number, i: number, scroll: number, length: number): number {
  if (i < frozen) return scroll;
  const start = m.offset(i);
  const end = start + m.size(i);
  const frozenLength = m.offset(frozen);
  if (start < scroll + frozenLength) return Math.max(0, start - frozenLength);
  if (end > scroll + length) return end - length;
  return scroll;
}
