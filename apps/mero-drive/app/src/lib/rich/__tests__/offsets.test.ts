import { describe, it, expect } from 'vitest';
import { scalarLength, utf16ToScalar, scalarToUtf16 } from '../offsets';

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // man ZWJ woman ZWJ girl
const COMBINING = 'é'; // e + combining acute

describe('scalarLength', () => {
  it('counts ASCII as one scalar per unit', () => {
    expect(scalarLength('hello')).toBe(5);
  });

  it('counts an astral emoji as one scalar and two units', () => {
    expect(scalarLength('a\u{1F44B}b')).toBe(3);
    expect('a\u{1F44B}b'.length).toBe(4);
  });

  it('counts a ZWJ family as five scalars and eight units', () => {
    expect(scalarLength(FAMILY)).toBe(5);
    expect(FAMILY.length).toBe(8);
  });

  it('counts a combining mark as its own scalar', () => {
    expect(scalarLength(COMBINING)).toBe(2);
  });
});

describe('utf16ToScalar', () => {
  it('is the identity on ASCII', () => {
    expect(utf16ToScalar('hello', 0)).toBe(0);
    expect(utf16ToScalar('hello', 3)).toBe(3);
  });

  it('maps the unit after an astral emoji to scalar two', () => {
    expect(utf16ToScalar('a\u{1F44B}b', 3)).toBe(2);
  });

  it('maps every ZWJ family boundary', () => {
    expect(utf16ToScalar(FAMILY, 2)).toBe(1);
    expect(utf16ToScalar(FAMILY, 3)).toBe(2);
    expect(utf16ToScalar(FAMILY, 5)).toBe(3);
    expect(utf16ToScalar(FAMILY, 6)).toBe(4);
  });

  it('maps a combining mark to its own scalar index', () => {
    expect(utf16ToScalar(COMBINING, 1)).toBe(1);
  });

  it('maps the string end to the scalar length', () => {
    expect(utf16ToScalar('a\u{1F44B}b', 4)).toBe(3);
    expect(utf16ToScalar(FAMILY, 8)).toBe(5);
  });

  it('clamps an index past the string end to the scalar length', () => {
    expect(utf16ToScalar('a\u{1F44B}b', 99)).toBe(3);
    expect(utf16ToScalar('abc', -4)).toBe(0);
  });

  it('rejects an index that falls inside a surrogate pair', () => {
    expect(() => utf16ToScalar('a\u{1F44B}b', 2)).toThrow(
      /inside a surrogate pair/,
    );
  });
});

describe('scalarToUtf16', () => {
  it('maps scalar two past an astral emoji to unit three', () => {
    expect(scalarToUtf16('a\u{1F44B}b', 2)).toBe(3);
  });

  it('maps the scalar length to the string end', () => {
    expect(scalarToUtf16(FAMILY, 5)).toBe(8);
  });

  it('clamps a scalar index past the end', () => {
    expect(scalarToUtf16('a\u{1F44B}b', 99)).toBe(4);
    expect(scalarToUtf16('abc', -1)).toBe(0);
  });
});
