import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import type { RuleSpec } from '../hooks/useSpreadsheet';

/**
 * Conditional formatting (style cells that meet a condition, or shade them on
 * a colour scale), data validation (values must meet a condition: refused,
 * or marked) or alerts (tell people when a value starts meeting a condition),
 * for the selection, plus the sheet's existing rules of that kind.
 * Rules are shared, and follow their cells as rows and columns move.
 */
export interface RulesModalItem {
  id: string;
  /** "B2:D9"; null when a corner row or column is gone. */
  where: string | null;
  /** "Fill red when greater than 100". */
  summary: string;
}

type Arity = 0 | 1 | 2 | 'list';
const CONDITIONS: { value: string; label: string; arity: Arity; validate: boolean }[] = [
  { value: 'gt', label: 'greater than', arity: 1, validate: true },
  { value: 'gte', label: 'at least', arity: 1, validate: true },
  { value: 'lt', label: 'less than', arity: 1, validate: true },
  { value: 'lte', label: 'at most', arity: 1, validate: true },
  { value: 'between', label: 'between', arity: 2, validate: true },
  { value: 'not_between', label: 'not between', arity: 2, validate: true },
  { value: 'eq', label: 'equal to', arity: 1, validate: true },
  { value: 'ne', label: 'not equal to', arity: 1, validate: true },
  { value: 'contains', label: 'text contains', arity: 1, validate: true },
  { value: 'not_contains', label: 'text does not contain', arity: 1, validate: true },
  { value: 'starts_with', label: 'text starts with', arity: 1, validate: false },
  { value: 'ends_with', label: 'text ends with', arity: 1, validate: false },
  { value: 'one_of', label: 'one of a list', arity: 'list', validate: true },
  { value: 'empty', label: 'empty', arity: 0, validate: false },
  { value: 'not_empty', label: 'not empty', arity: 0, validate: true },
  { value: 'is_number', label: 'a number', arity: 0, validate: true },
  { value: 'checkbox', label: 'a checkbox (TRUE / FALSE)', arity: 0, validate: true },
];

export const conditionLabel = (value: string) => CONDITIONS.find((c) => c.value === value)?.label ?? value;

export default function RulesModal({
  mode,
  selection,
  people = [],
  items,
  saving,
  error,
  onAdd,
  onRemove,
  onClose,
}: {
  mode: 'format' | 'validate' | 'alert';
  /** Who an alert can tell. */
  people?: { id: string; name: string }[];
  /** The selection a new rule covers, as shown; null with none. */
  selection: string | null;
  items: RulesModalItem[];
  saving: boolean;
  error: string | null;
  onAdd: (spec: RuleSpec) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const choices = CONDITIONS.filter((c) => (mode === 'validate' ? c.validate : c.value !== 'checkbox'));
  const [recipients, setRecipients] = useState<string[]>([]);
  const [scale, setScale] = useState(false);
  const [condition, setCondition] = useState(choices[0].value);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [fill, setFill] = useState('#ffd6d6');
  const [color, setColor] = useState('#9b1c1c');
  const [bold, setBold] = useState(false);
  const [low, setLow] = useState('#ffffff');
  const [high, setHigh] = useState('#57bb8a');
  const [strict, setStrict] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const arity = CONDITIONS.find((c) => c.value === condition)?.arity ?? 0;
  const args = arity === 0 ? [] : arity === 1 ? [a.trim()] : arity === 2 ? [a.trim(), b.trim()]
    : a.split(',').map((x) => x.trim()).filter(Boolean);
  const ready = selection !== null && (scale || (arity === 0 || args.every(Boolean)) && (arity !== 'list' || args.length > 0))
    && (mode !== 'alert' || recipients.length > 0);

  const add = () => {
    if (!ready || saving) return;
    if (mode === 'format' && scale) {
      onAdd({ kind: 'scale', condition: '', args: [low, high], style: {}, strict: false, recipients: [] });
    } else if (mode === 'format') {
      onAdd({ kind: 'format', condition, args, style: { fill, color, ...(bold ? { bold: '1' } : {}) }, strict: false, recipients: [] });
    } else if (mode === 'alert') {
      onAdd({ kind: 'alert', condition, args, style: {}, strict: false, recipients });
    } else {
      onAdd({ kind: 'validate', condition, args, style: {}, strict, recipients: [] });
    }
    setA('');
    setB('');
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Dialog role="dialog" aria-modal="true" aria-labelledby="rules-title" data-testid="rules-modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="rules-title">{mode === 'format' ? 'Conditional formatting' : mode === 'alert' ? 'Alerts' : 'Data validation'}</h3>
        <p className="sub">
          {selection ? <>For <code>{selection}</code>. </> : 'Select cells first. '}
          {mode === 'format' ? 'Style cells by their value.' : mode === 'alert' ? 'Tell people when a value starts meeting a condition, formulas included.' : 'Say what a cell may hold.'}
        </p>

        {mode === 'format' && (
          <Row role="radiogroup" aria-label="Rule type">
            <label><input type="radio" checked={!scale} onChange={() => setScale(false)} /> Cells that meet a condition</label>
            <label><input type="radio" checked={scale} onChange={() => setScale(true)} data-testid="field-rule-scale" /> Colour scale</label>
          </Row>
        )}

        {!scale && (
          <Field>
            <label htmlFor="rule-condition">{mode === 'validate' ? 'The value must be' : 'When the value is'}</label>
            <div className="inline">
              <select id="rule-condition" value={condition} onChange={(e) => setCondition(e.target.value)} data-testid="field-rule-condition">
                {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {arity !== 0 && (
                <input
                  aria-label={arity === 'list' ? 'Choices, separated by commas' : 'Value'}
                  placeholder={arity === 'list' ? 'Yes, No, Maybe' : 'value'}
                  value={a}
                  onChange={(e) => setA(e.target.value)}
                  data-testid="field-rule-a"
                />
              )}
              {arity === 2 && (
                <input aria-label="And" placeholder="and" value={b} onChange={(e) => setB(e.target.value)} data-testid="field-rule-b" />
              )}
            </div>
          </Field>
        )}

        {mode === 'format' && !scale && (
          <Row>
            <label>Fill <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} /></label>
            <label>Text <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <label><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold</label>
            <Preview style={{ background: fill, color, fontWeight: bold ? 700 : 400 }}>123</Preview>
          </Row>
        )}
        {mode === 'format' && scale && (
          <Row>
            <label>Lowest <input type="color" value={low} onChange={(e) => setLow(e.target.value)} /></label>
            <label>Highest <input type="color" value={high} onChange={(e) => setHigh(e.target.value)} /></label>
            <Preview style={{ background: `linear-gradient(90deg, ${low}, ${high})`, width: 90 }} />
          </Row>
        )}
        {mode === 'validate' && (
          <Row role="radiogroup" aria-label="When a value breaks the rule">
            <label><input type="radio" checked={strict} onChange={() => setStrict(true)} data-testid="field-rule-strict" /> Refuse it</label>
            <label><input type="radio" checked={!strict} onChange={() => setStrict(false)} /> Keep it, and mark it</label>
          </Row>
        )}

        {mode === 'alert' && (
          <Recipients>
            <legend>Tell</legend>
            {people.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={recipients.includes(p.id)}
                  data-testid="field-alert-recipient"
                  onChange={() => setRecipients((r) => (r.includes(p.id) ? r.filter((x) => x !== p.id) : [...r, p.id]))}
                />
                {p.name}
              </label>
            ))}
          </Recipients>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}
        <PrimaryBtn onClick={add} disabled={!ready || saving} data-testid="action-add-rule">
          {saving ? 'Saving…' : 'Add rule'}
        </PrimaryBtn>

        {items.length > 0 && (
          <List aria-label="Rules on this sheet">
            {items.map((r) => (
              <li key={r.id} data-testid="item-Rule">
                <span className="where">{r.where ?? '(range removed)'}</span>
                <span className="desc">{r.summary}</span>
                <button type="button" disabled={saving} aria-label="Remove rule" onClick={() => onRemove(r.id)}>×</button>
              </li>
            ))}
          </List>
        )}
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(10px) scale(0.97);}to{opacity:1;transform:none;}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 120;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(14,20,15,0.5); backdrop-filter: blur(4px);
  animation: ${fadeIn} 0.18s ease both;
`;
const Dialog = styled.div`
  width: 100%; max-width: 460px; max-height: calc(100vh - 40px); overflow-y: auto;
  background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 18px;
  padding: 28px 26px 24px; box-shadow: 0 40px 90px -40px rgba(14,20,15,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: ${pop} 0.22s cubic-bezier(0.22,1,0.36,1) both;
  h3 { font-size: 19px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.greenDeep}; }
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 16px 0 0;
  label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: ${C.ink}; }
  input[type='color'] { width: 28px; height: 22px; padding: 0; border: 1px solid ${C.line}; border-radius: 4px; background: none; }
`;
const Field = styled.div`
  margin: 16px 0 0;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  .inline { display: flex; gap: 8px; }
  select, input {
    flex: 1; min-width: 0; box-sizing: border-box; padding: 9px 11px; font-size: 13.5px;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 10px; outline: none;
    &:focus { border-color: ${C.green}; }
  }
`;
const Recipients = styled.fieldset`
  margin: 16px 0 0; padding: 0; border: none;
  legend { font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; padding: 0; }
  label { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: ${C.ink}; margin: 4px 0; }
`;
const Preview = styled.span`
  display: inline-block; min-width: 44px; height: 22px; line-height: 22px; text-align: center;
  font-size: 12px; border-radius: 4px; border: 1px solid ${C.line};
`;
const PrimaryBtn = styled.button`
  display: block; width: 100%; margin-top: 16px; padding: 12px 18px;
  font-size: 13.5px; font-weight: 600; border-radius: 11px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  &:hover:not(:disabled) { background: ${C.greenHover}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const List = styled.ul`
  list-style: none; margin: 20px 0 0; padding: 0; border-top: 1px solid ${C.line};
  li { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-bottom: 1px solid ${C.line}; font-size: 13px; }
  .where { font-weight: 600; color: ${C.ink}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }
  .desc { flex: 1; color: ${C.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: none; background: transparent; color: ${C.mutedSoft}; font-size: 17px; cursor: pointer; padding: 0 4px; }
  button:hover:not(:disabled) { color: ${C.danger}; }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
