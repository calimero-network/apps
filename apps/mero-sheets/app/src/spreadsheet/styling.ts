/**
 * Cell styles and rules, as the grid shows them.
 *
 * A cell's own style comes from the contract (one value per field). Rules add
 * to it: a conditional format styles cells that meet its condition (the first
 * matching rule wins a field), a colour scale shades numbers between two
 * colours, and a validation marks values it would not accept, draws a
 * checkbox, or offers a list to pick from. Conditions are tested with the
 * contract's own evaluator (passed in, so this stays pure).
 */
import type { CSSProperties } from 'react';
import type { Rule, RuleInput } from '../api/spreadsheet/SpreadsheetClient';
import type { Rect } from './refs';

export type Style = Readonly<Record<string, string>>;

/** A cell's style as CSS. */
export function styleCss(style: Style | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = 'italic';
  const deco = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.textDecoration = deco;
  if (style.color) css.color = style.color;
  if (style.fill) css.backgroundColor = style.fill;
  if (style.align) css.textAlign = style.align as CSSProperties['textAlign'];
  if (style.wrap) { css.whiteSpace = 'normal'; css.lineHeight = 1.2; }
  return css;
}

/** A rule placed on the grid. */
export interface PlacedRule {
  id: string;
  rule: RuleInput;
  rect: Rect;
}

type Locate = (rowId: string, colId: string) => { row: number; col: number } | null;

/** A sheet's rules as position rectangles; one whose corner is gone drops out. */
export function placeRules(rules: readonly Rule[], sheetId: string, locate: Locate): PlacedRule[] {
  const out: PlacedRule[] = [];
  for (const { id, rule } of rules) {
    if (rule.sheet_id !== sheetId) continue;
    const a = locate(rule.top_row_id, rule.left_col_id);
    const b = locate(rule.bottom_row_id, rule.right_col_id);
    if (!a || !b) continue;
    out.push({
      id,
      rule,
      rect: {
        top: Math.min(a.row, b.row), left: Math.min(a.col, b.col),
        bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col),
      },
    });
  }
  return out;
}

const inside = (r: Rect, row: number, col: number) =>
  row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;

/** The lowest and highest number in each colour scale's range. */
export function scaleBounds(
  placed: readonly PlacedRule[],
  cells: readonly { row: number; col: number; computed_value: string }[],
): Map<string, { min: number; max: number }> {
  const out = new Map<string, { min: number; max: number }>();
  for (const p of placed) {
    if (p.rule.kind !== 'scale') continue;
    let min = Infinity;
    let max = -Infinity;
    for (const c of cells) {
      if (!inside(p.rect, c.row, c.col) || c.computed_value.trim() === '') continue;
      const n = Number(c.computed_value);
      if (!Number.isFinite(n)) continue;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    if (min <= max) out.set(p.id, { min, max });
  }
  return out;
}

/** The colour `t` (0..1) of the way from `from` to `to` (`#rrggbb`). */
export function mixColor(from: string, to: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const k = Math.max(0, Math.min(1, t));
  return `#${[0, 1, 2]
    .map((i) => Math.round(ch(from, i) + (ch(to, i) - ch(from, i)) * k).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** What the rules do to one cell. */
export interface RuleEffect {
  /** Fields the rules set (over the cell's own style). */
  style: Record<string, string>;
  /** Why the value breaks a validation, or null. */
  invalid: string | null;
  /** A checkbox validation covers the cell. */
  checkbox: boolean;
  /** A list validation covers the cell: its choices. */
  options: string[] | null;
}

export const NO_EFFECT: RuleEffect = { style: {}, invalid: null, checkbox: false, options: null };

export function ruleEffect(
  placed: readonly PlacedRule[],
  scales: ReadonlyMap<string, { min: number; max: number }>,
  row: number,
  col: number,
  value: string,
  matches: (condition: string, args: readonly string[], value: string) => boolean,
  describe: (condition: string, args: readonly string[]) => string,
): RuleEffect {
  let effect: RuleEffect | null = null;
  const edit = () => (effect ??= { style: {}, invalid: null, checkbox: false, options: null });
  for (const { id, rule, rect } of placed) {
    if (!inside(rect, row, col)) continue;
    if (rule.kind === 'format') {
      if (!matches(rule.condition, rule.args, value)) continue;
      const e = edit();
      for (const [field, v] of Object.entries(rule.style)) if (!(field in e.style)) e.style[field] = v;
    } else if (rule.kind === 'scale') {
      const bounds = scales.get(id);
      const n = Number(value);
      if (!bounds || value.trim() === '' || !Number.isFinite(n)) continue;
      const e = edit();
      if (!('fill' in e.style)) {
        const t = bounds.max === bounds.min ? 1 : (n - bounds.min) / (bounds.max - bounds.min);
        e.style.fill = mixColor(rule.args[0], rule.args[1], t);
      }
    } else if (rule.kind === 'validate') {
      const e = edit();
      if (rule.condition === 'checkbox') e.checkbox = true;
      if (rule.condition === 'one_of') e.options = [...rule.args];
      // An empty cell only breaks a rule that asks for a value.
      const judged = value.trim() !== '' || rule.condition === 'not_empty';
      if (judged && !e.invalid && !matches(rule.condition, rule.args, value)) {
        e.invalid = `Must be ${describe(rule.condition, rule.args)}`;
      }
    }
  }
  return effect ?? NO_EFFECT;
}
