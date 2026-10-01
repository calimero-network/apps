import { describe, expect, it } from 'vitest';
import type { Rule } from '../api/spreadsheet/SpreadsheetClient';
import { mixColor, placeRules, ruleEffect, scaleBounds, styleCss } from './styling';

const rule = (id: string, over: Partial<Rule['rule']>): Rule => ({
  id,
  created_by: 'me',
  rule: {
    sheet_id: 's', top_row_id: '0', left_col_id: '0', bottom_row_id: '9', right_col_id: '0',
    kind: 'format', condition: 'gt', args: ['100'], style: { fill: '#ff0000' }, strict: false, ...over,
  },
});
const locate = (r: string, c: string) => (r === 'gone' ? null : { row: Number(r), col: Number(c) });
// A stand-in for the engine's evaluator.
const matches = (condition: string, args: readonly string[], value: string) => {
  const n = Number(value);
  if (condition === 'gt') return value.trim() !== '' && n > Number(args[0]);
  if (condition === 'one_of') return args.includes(value);
  if (condition === 'checkbox') return ['', 'TRUE', 'FALSE'].includes(value.toUpperCase());
  if (condition === 'not_empty') return value.trim() !== '';
  return false;
};
const describeCond = (condition: string, args: readonly string[]) => `${condition} ${args.join(',')}`;

describe('styleCss', () => {
  it('turns fields into CSS', () => {
    expect(styleCss({ bold: '1', underline: '1', strike: '1', fill: '#000000', align: 'right' })).toEqual({
      fontWeight: 700, textDecoration: 'underline line-through', backgroundColor: '#000000', textAlign: 'right',
    });
    expect(styleCss(undefined)).toEqual({});
  });
});

describe('placeRules', () => {
  it("places this sheet's rules and drops ones whose corner is gone", () => {
    const placed = placeRules([rule('a', {}), rule('b', { sheet_id: 'x' }), rule('c', { top_row_id: 'gone' })], 's', locate);
    expect(placed.map((p) => [p.id, p.rect])).toEqual([['a', { top: 0, left: 0, bottom: 9, right: 0 }]]);
  });
});

describe('ruleEffect', () => {
  it('styles a matching cell, and the first matching rule wins a field', () => {
    const placed = placeRules([rule('a', {}), rule('b', { condition: 'gt', args: ['0'], style: { fill: '#00ff00', bold: '1' } })], 's', locate);
    expect(ruleEffect(placed, new Map(), 1, 0, '150', matches, describeCond).style).toEqual({ fill: '#ff0000', bold: '1' });
    expect(ruleEffect(placed, new Map(), 1, 0, '50', matches, describeCond).style).toEqual({ fill: '#00ff00', bold: '1' });
    expect(ruleEffect(placed, new Map(), 1, 1, '150', matches, describeCond).style).toEqual({});
  });

  it('shades a colour scale between the lowest and highest number', () => {
    const placed = placeRules([rule('s', { kind: 'scale', condition: '', args: ['#000000', '#ffffff'], style: {} })], 's', locate);
    const cells = [{ row: 0, col: 0, computed_value: '0' }, { row: 1, col: 0, computed_value: '10' }, { row: 2, col: 0, computed_value: 'x' }];
    const bounds = scaleBounds(placed, cells);
    expect(bounds.get('s')).toEqual({ min: 0, max: 10 });
    expect(ruleEffect(placed, bounds, 1, 0, '5', matches, describeCond).style.fill).toBe('#808080');
    expect(ruleEffect(placed, bounds, 2, 0, 'x', matches, describeCond).style.fill).toBeUndefined();
  });

  it('marks invalid values, and offers checkboxes and lists', () => {
    const list = placeRules([rule('v', { kind: 'validate', condition: 'one_of', args: ['Yes', 'No'], style: {} })], 's', locate);
    const bad = ruleEffect(list, new Map(), 0, 0, 'Maybe', matches, describeCond);
    expect(bad.invalid).toBe('Must be one_of Yes,No');
    expect(bad.options).toEqual(['Yes', 'No']);
    expect(ruleEffect(list, new Map(), 0, 0, '', matches, describeCond).invalid).toBeNull();
    const box = placeRules([rule('c', { kind: 'validate', condition: 'checkbox', args: [], style: {} })], 's', locate);
    expect(ruleEffect(box, new Map(), 0, 0, 'TRUE', matches, describeCond)).toMatchObject({ checkbox: true, invalid: null });
  });
});

describe('mixColor', () => {
  it('blends two colours', () => {
    expect(mixColor('#000000', '#ff8000', 0.5)).toBe('#804000');
    expect(mixColor('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});
