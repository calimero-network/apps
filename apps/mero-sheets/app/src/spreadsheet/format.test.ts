import { describe, it, expect } from 'vitest';
import { changeDecimals, formatValue, parseFormat } from './format';

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

describe('parameterized formats', () => {
  it('takes decimals, a currency code and a date style', () => {
    expect(formatValue('1234.5', 'number:0')).toBe('1,235');
    expect(formatValue('1234.5', 'currency:EUR')).toBe('€1,234.50');
    expect(formatValue('1234.5', 'currency:JPY:0')).toBe('¥1,235');
    expect(formatValue('0.256', 'percent:1')).toBe('25.6%');
    expect(formatValue('2026-07-08', 'date:us')).toBe('07/08/2026');
    expect(formatValue('2026-07-08', 'date:eu')).toBe('08/07/2026');
    expect(formatValue('2026-07-08', 'date:long')).toBe('8 July 2026');
    expect(formatValue('00123', 'text')).toBe('00123');
  });
  it('shows an unknown currency code after the number', () => {
    expect(formatValue('5', 'currency:ZZZZ')).toBe('5.00 ZZZZ');
  });
  it('parses keywords with their defaults', () => {
    expect(parseFormat('currency')).toEqual({ kind: 'currency', code: 'USD', decimals: 2, style: '' });
    expect(parseFormat('number:x').decimals).toBe(2);
  });
  it('adds and removes decimal places', () => {
    expect(changeDecimals('', 1)).toBe('number:3');
    expect(changeDecimals('number:0', -1)).toBe('number:0');
    expect(changeDecimals('currency:EUR:2', -1)).toBe('currency:EUR:1');
    expect(changeDecimals('percent', 1)).toBe('percent:1');
  });
});
