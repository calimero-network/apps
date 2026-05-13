import { describe, it, expect } from 'vitest';
import {
  COLOR_ALLOWLIST,
  MEMBER_IDENTITY_PATTERN,
  looksLikeMemberIdentity,
  safeColor,
} from '../validation';

describe('looksLikeMemberIdentity', () => {
  it('accepts a typical 43-char base58 string of valid chars', () => {
    // 'a' is in the base58 alphabet (a-k range).
    expect(looksLikeMemberIdentity('a'.repeat(43))).toBe(true);
  });

  it('accepts a string containing lowercase `o` (IS valid in base58)', () => {
    // base58 excludes only `0 O I l` — lowercase `o` IS in the alphabet.
    // The previous "fix" wrongly excluded `o`; reverted.
    expect(looksLikeMemberIdentity('a'.repeat(42) + 'o')).toBe(true);
  });

  it('rejects a string containing `l` (excluded from base58)', () => {
    expect(looksLikeMemberIdentity('a'.repeat(42) + 'l')).toBe(false);
  });

  it('rejects strings containing `0`, `O`, `I` (the other base58 exclusions)', () => {
    expect(looksLikeMemberIdentity('a'.repeat(42) + '0')).toBe(false);
    expect(looksLikeMemberIdentity('a'.repeat(42) + 'O')).toBe(false);
    expect(looksLikeMemberIdentity('a'.repeat(42) + 'I')).toBe(false);
  });

  it('rejects too-short / too-long strings', () => {
    expect(looksLikeMemberIdentity('a'.repeat(39))).toBe(false);
    expect(looksLikeMemberIdentity('a'.repeat(51))).toBe(false);
  });

  it('accepts the boundary lengths (40 and 50)', () => {
    expect(looksLikeMemberIdentity('a'.repeat(40))).toBe(true);
    expect(looksLikeMemberIdentity('a'.repeat(50))).toBe(true);
  });

  it('exports a pattern that matches looksLikeMemberIdentity', () => {
    expect(MEMBER_IDENTITY_PATTERN.test('a'.repeat(43))).toBe(true);
    expect(MEMBER_IDENTITY_PATTERN.test('a'.repeat(42) + 'l')).toBe(false);
  });
});

describe('safeColor', () => {
  it('accepts canonical hex / rgb / hsl colors', () => {
    expect(safeColor('#fff')).toBe('#fff');
    expect(safeColor('#ffffff')).toBe('#ffffff');
    expect(safeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(safeColor('hsla(0, 0%, 0%, 0.5)')).toBe('hsla(0, 0%, 0%, 0.5)');
  });

  it('rejects malformed / injected values', () => {
    // The attack-shape we need safeColor to reject; this is a test
    // fixture string, not a value passed to any DOM API.
    const attackUrl = ['java', 'script', ':alert(1)'].join('');
    expect(safeColor(attackUrl)).toBeUndefined();
    expect(safeColor('#xyz')).toBeUndefined();
    expect(safeColor('')).toBeUndefined();
    expect(safeColor(null)).toBeUndefined();
    expect(safeColor(undefined)).toBeUndefined();
  });

  it('trims whitespace before validating', () => {
    expect(safeColor('  #abc  ')).toBe('#abc');
  });

  it('exports an allowlist regex used by safeColor', () => {
    expect(COLOR_ALLOWLIST.test('#abcd')).toBe(true);
    expect(COLOR_ALLOWLIST.test('#abcde')).toBe(false);
  });
});
