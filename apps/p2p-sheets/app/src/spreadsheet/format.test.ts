import { describe, it, expect } from 'vitest';
import { formatValue } from './format';

describe('formatValue', () => {
  it('passes values through unchanged for Automatic (empty) format', () => {
    expect(formatValue('1234.5', '')).toBe('1234.5');
    expect(formatValue('hello', '')).toBe('hello');
  });

  it('formats numbers with 2 decimals and thousands separators', () => {
    expect(formatValue('1234.5', 'number')).toBe('1,234.50');
    expect(formatValue('-1234.5', 'number')).toBe('-1,234.50');
    expect(formatValue('0', 'number')).toBe('0.00');
  });

  it('formats currency with a $ symbol and 2 decimals', () => {
    expect(formatValue('1234.5', 'currency')).toBe('$1,234.50');
    expect(formatValue('-5', 'currency')).toBe('-$5.00');
  });

  it('formats percent by scaling ×100 with no decimals', () => {
    expect(formatValue('0.25', 'percent')).toBe('25%');
    expect(formatValue('-0.1', 'percent')).toBe('-10%');
  });

  it('formats a parseable date as YYYY-MM-DD', () => {
    expect(formatValue('2026-07-08', 'date')).toBe('2026-07-08');
  });

  it('passes non-numeric input through unchanged for numeric formats', () => {
    expect(formatValue('#REF!', 'number')).toBe('#REF!');
    expect(formatValue('', 'currency')).toBe('');
    expect(formatValue('n/a', 'percent')).toBe('n/a');
  });

  it('passes an unparseable date through unchanged', () => {
    expect(formatValue('not a date', 'date')).toBe('not a date');
  });
});
