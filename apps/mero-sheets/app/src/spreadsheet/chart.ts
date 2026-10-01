/**
 * What a chart plots, read from its range: the first column labels the
 * points, each other column is a series (named by the first row when that
 * row is text), up to eight series in the categorical palette's fixed order.
 * A one-column range is a single series labelled by row number.
 */
import type { Rect } from './refs';

export const MAX_SERIES = 8;

export interface ChartSeries {
  name: string;
  /** One per label; null where the cell is not a number. */
  values: (number | null)[];
}

export interface ChartModel {
  labels: string[];
  series: ChartSeries[];
  /** Columns past the palette's eight, left out. */
  dropped: number;
}

type ValueAt = (row: number, col: number) => string;

const numberOf = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function chartModel(rect: Rect, valueAt: ValueAt, columnName: (col: number) => string): ChartModel {
  const single = rect.left === rect.right;
  const seriesCols = single ? [rect.left] : Array.from({ length: rect.right - rect.left }, (_, i) => rect.left + 1 + i);
  const header = rect.bottom > rect.top &&
    seriesCols.every((c) => valueAt(rect.top, c).trim() !== '' && numberOf(valueAt(rect.top, c)) === null);
  const first = rect.top + (header ? 1 : 0);
  const rows = Array.from({ length: rect.bottom - first + 1 }, (_, i) => first + i);
  const kept = seriesCols.slice(0, MAX_SERIES);
  return {
    labels: rows.map((r) => (single ? String(r + 1) : valueAt(r, rect.left).trim() || String(r + 1))),
    series: kept.map((c) => ({
      name: header ? valueAt(rect.top, c).trim() : columnName(c),
      values: rows.map((r) => numberOf(valueAt(r, c))),
    })),
    dropped: seriesCols.length - kept.length,
  };
}

/** Round tick values covering `[min, max]` (always including 0), about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toPrecision(12)));
  if (ticks[ticks.length - 1] < hi) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

/** A tick or value as shown: thousands separated, compact past a million. */
export function formatTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}
