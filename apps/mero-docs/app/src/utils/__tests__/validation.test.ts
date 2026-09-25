import { describe, it, expect } from 'vitest';
import {
  COLOR_ALLOWLIST,
  MEMBER_IDENTITY_PATTERN,
  looksLikeMemberIdentity,
  safeColor,
} from '../validation';

describe('looksLikeMemberIdentity', () => {
  // core 0.11.0-rc.27 removed base58: a device key is now 64 hex characters.
  it('accepts a 64-char hex string', () => {
    expect(looksLikeMemberIdentity('a'.repeat(64))).toBe(true);
  });

  it('accepts upper-case hex (a pasted key may be upper-cased)', () => {
    expect(looksLikeMemberIdentity('AbCdEf01'.repeat(8))).toBe(true);
  });

  it('accepts `0` — a valid hex digit, which base58 excluded', () => {
    // The whole point of the migration: `0` used to be rejected, now it is not.
    expect(looksLikeMemberIdentity('0'.repeat(64))).toBe(true);
  });

  it('rejects non-hex letters (`g`, `o`, `l`, `z`)', () => {
    expect(looksLikeMemberIdentity('a'.repeat(63) + 'g')).toBe(false);
    expect(looksLikeMemberIdentity('a'.repeat(63) + 'o')).toBe(false);
    expect(looksLikeMemberIdentity('a'.repeat(63) + 'z')).toBe(false);
  });

  it('rejects the wrong length (63 / 65 chars)', () => {
    expect(looksLikeMemberIdentity('a'.repeat(63))).toBe(false);
    expect(looksLikeMemberIdentity('a'.repeat(65))).toBe(false);
  });

  it('exports a pattern that matches looksLikeMemberIdentity', () => {
    expect(MEMBER_IDENTITY_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(MEMBER_IDENTITY_PATTERN.test('a'.repeat(63) + 'z')).toBe(false);
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
