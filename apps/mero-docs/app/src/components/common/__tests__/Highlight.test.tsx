import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Highlight } from '../Highlight';

function marks(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('mark')).map((m) => m.textContent ?? '');
}

describe('Highlight', () => {
  it('preserves the full text', () => {
    const { container } = render(
      <Highlight text="hello world" ranges={[{ start: 0, end: 5 }]} />,
    );
    expect(container.textContent).toBe('hello world');
  });

  it('wraps the given range in a mark', () => {
    const { container } = render(
      <Highlight text="hello world" ranges={[{ start: 6, end: 11 }]} />,
    );
    expect(marks(container)).toEqual(['world']);
  });

  it('merges overlapping and unsorted ranges', () => {
    const { container } = render(
      <Highlight text="hello world" ranges={[{ start: 3, end: 8 }, { start: 0, end: 5 }]} />,
    );
    expect(marks(container)).toEqual(['hello wo']);
  });

  it('clamps out-of-range bounds to the text length', () => {
    const { container } = render(
      <Highlight text="hello" ranges={[{ start: -3, end: 3 }, { start: 4, end: 100 }]} />,
    );
    expect(marks(container)).toEqual(['hel', 'o']);
    expect(container.textContent).toBe('hello');
  });

  it('never splits a surrogate pair', () => {
    // '\u{1F680}' (rocket) is a surrogate pair at indices 7-8; this range
    // only names the high surrogate, which must expand to cover the pair.
    const text = 'Launch \u{1F680} party';
    const { container } = render(<Highlight text={text} ranges={[{ start: 7, end: 8 }]} />);
    expect(marks(container)).toEqual(['\u{1F680}']);
    expect(container.textContent).toBe(text);
  });
});
