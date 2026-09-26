import { describe, expect, it } from 'vitest';
import { AxisMetrics, scrollToShow, visibleRange } from './viewport';

describe('AxisMetrics', () => {
  const m = new AxisMetrics(10, 20, new Map([[2, 50]]));
  it('adds up default and resized sizes', () => {
    expect(m.offset(0)).toBe(0);
    expect(m.offset(3)).toBe(90);
    expect(m.total).toBe(9 * 20 + 50);
  });
  it('finds the entry at a pixel, clamped to the axis', () => {
    expect(m.indexAt(0)).toBe(0);
    expect(m.indexAt(45)).toBe(2);
    expect(m.indexAt(89)).toBe(2);
    expect(m.indexAt(90)).toBe(3);
    expect(m.indexAt(-5)).toBe(0);
    expect(m.indexAt(99999)).toBe(9);
  });
});

describe('visibleRange', () => {
  const m = new AxisMetrics(1000, 24, new Map());
  it('covers the viewport plus overscan', () => {
    expect(visibleRange(m, 0, 0, 240, 2)).toEqual({ start: 0, end: 13 });
    expect(visibleRange(m, 0, 2400, 240, 0)).toEqual({ start: 100, end: 111 });
  });
  it('starts after the frozen entries and skips what they cover', () => {
    // Two frozen rows (48px) sit over the top of the viewport.
    expect(visibleRange(m, 2, 0, 240, 0)).toEqual({ start: 2, end: 11 });
    expect(visibleRange(m, 2, 480, 240, 0).start).toBe(22);
  });
  it('stops at the end of the axis', () => {
    expect(visibleRange(m, 0, 24 * 995, 240, 3).end).toBe(1000);
  });
});

describe('scrollToShow', () => {
  const m = new AxisMetrics(1000, 24, new Map());
  it('leaves the scroll alone when the entry is in view', () => {
    expect(scrollToShow(m, 0, 5, 0, 240)).toBe(0);
  });
  it('scrolls down to reveal an entry below, and up to one above', () => {
    expect(scrollToShow(m, 0, 20, 0, 240)).toBe(21 * 24 - 240);
    expect(scrollToShow(m, 0, 3, 2400, 240)).toBe(72);
  });
  it('keeps an entry clear of the frozen ones, and never scrolls for a frozen one', () => {
    expect(scrollToShow(m, 2, 10, 480, 240)).toBe(10 * 24 - 48);
    expect(scrollToShow(m, 2, 1, 480, 240)).toBe(480);
  });
});
