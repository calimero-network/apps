import { describe, it, expect } from 'vitest';
import { TAG_COLORS, TAG_COLOR_NAMES } from '../tags';

describe('tag palette', () => {
  it('keeps the colour order new tags are assigned from', () => {
    expect(TAG_COLORS).toEqual([
      '#3b82f6',
      '#8b5cf6',
      '#10b981',
      '#f59e0b',
      '#ec4899',
      '#ef4444',
      '#14b8a6',
      '#64748b',
    ]);
  });

  it('names every colour, in the same order', () => {
    expect(TAG_COLOR_NAMES).toEqual([
      'Blue',
      'Purple',
      'Green',
      'Amber',
      'Pink',
      'Red',
      'Teal',
      'Slate',
    ]);
  });
});
