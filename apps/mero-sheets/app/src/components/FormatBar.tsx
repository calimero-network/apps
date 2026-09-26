/**
 * FormatBar — styling for the selection: bold, italic, underline,
 * strikethrough, text and fill colour, alignment, wrapping, the number format
 * with its decimal places, and clearing it all. Each style field merges on
 * its own, so two people formatting the same cells keep both changes.
 */
import React from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { changeDecimals, parseFormat } from '../spreadsheet/format';
import type { Style } from '../spreadsheet/styling';

interface FormatBarProps {
  /** The selected cell's own style and number format. */
  style: Style;
  format: string;
  /** Styles cannot change here (a private sheet, a role, a protected range). */
  disabled: boolean;
  /** The number format can still change (a private sheet keeps formats). */
  formatDisabled: boolean;
  onStyle: (field: string, value: string) => void;
  onFormat: (format: string) => void;
  onClear: () => void;
  onRules: (kind: 'format' | 'validate') => void;
}

const TOGGLES: { field: string; label: string; title: string; css: React.CSSProperties }[] = [
  { field: 'bold', label: 'B', title: 'Bold', css: { fontWeight: 800 } },
  { field: 'italic', label: 'I', title: 'Italic', css: { fontStyle: 'italic' } },
  { field: 'underline', label: 'U', title: 'Underline', css: { textDecoration: 'underline' } },
  { field: 'strike', label: 'S', title: 'Strikethrough', css: { textDecoration: 'line-through' } },
];

const NUMBER_FORMATS: { value: string; label: string }[] = [
  { value: '', label: 'Automatic' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency ($)' },
  { value: 'currency:EUR', label: 'Currency (€)' },
  { value: 'currency:GBP', label: 'Currency (£)' },
  { value: 'percent', label: 'Percent' },
  { value: 'date', label: 'Date (2026-07-08)' },
  { value: 'date:us', label: 'Date (07/08/2026)' },
  { value: 'date:eu', label: 'Date (08/07/2026)' },
  { value: 'date:long', label: 'Date (8 July 2026)' },
  { value: 'text', label: 'Plain text' },
];

/** The option a format belongs to, ignoring its decimal places. */
function formatOption(format: string): string {
  const { kind, code, style } = parseFormat(format);
  if (kind === 'currency') return code === 'USD' ? 'currency' : `currency:${code}`;
  if (kind === 'date') return style ? `date:${style}` : 'date';
  return kind;
}

export default function FormatBar({ style, format, disabled, formatDisabled, onStyle, onFormat, onClear, onRules }: FormatBarProps) {
  const numeric = ['number', 'currency', 'percent', ''].includes(parseFormat(format).kind);
  return (
    <Bar role="toolbar" aria-label="Format">
      {TOGGLES.map((t) => (
        <Btn
          key={t.field}
          type="button"
          style={t.css}
          title={t.title}
          aria-label={t.title}
          aria-pressed={!!style[t.field]}
          disabled={disabled}
          data-testid={`action-style-${t.field}`}
          onClick={() => onStyle(t.field, style[t.field] ? '' : '1')}
        >
          {t.label}
        </Btn>
      ))}
      <Sep />
      <ColorPick title="Text colour" $swatch={style.color}>
        <span aria-hidden="true">A</span>
        <input
          type="color"
          aria-label="Text colour"
          disabled={disabled}
          value={style.color || '#000000'}
          data-testid="field-style-color"
          onChange={(e) => onStyle('color', e.target.value)}
        />
      </ColorPick>
      <ColorPick title="Fill colour" $swatch={style.fill} $fill>
        <span aria-hidden="true">▧</span>
        <input
          type="color"
          aria-label="Fill colour"
          disabled={disabled}
          value={style.fill || '#ffffff'}
          data-testid="field-style-fill"
          onChange={(e) => onStyle('fill', e.target.value)}
        />
      </ColorPick>
      <Sep />
      {(['left', 'center', 'right'] as const).map((a) => (
        <Btn
          key={a}
          type="button"
          title={`Align ${a}`}
          aria-label={`Align ${a}`}
          aria-pressed={style.align === a}
          disabled={disabled}
          onClick={() => onStyle('align', style.align === a ? '' : a)}
        >
          <AlignIcon $align={a} />
        </Btn>
      ))}
      <Btn
        type="button"
        title="Wrap text"
        aria-label="Wrap text"
        aria-pressed={!!style.wrap}
        disabled={disabled}
        onClick={() => onStyle('wrap', style.wrap ? '' : '1')}
      >
        ↵
      </Btn>
      <Sep />
      <Select
        aria-label="Number format"
        value={formatOption(format)}
        disabled={formatDisabled}
        data-testid="field-number-format"
        onChange={(e) => onFormat(e.target.value)}
      >
        {NUMBER_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </Select>
      <Btn type="button" title="Fewer decimal places" aria-label="Fewer decimal places" disabled={formatDisabled || !numeric}
        onClick={() => onFormat(changeDecimals(format, -1))}>.0←</Btn>
      <Btn type="button" title="More decimal places" aria-label="More decimal places" disabled={formatDisabled || !numeric}
        onClick={() => onFormat(changeDecimals(format, 1))}>.00→</Btn>
      <Sep />
      <Btn type="button" title="Clear formatting" aria-label="Clear formatting" disabled={disabled} onClick={onClear}>⌫</Btn>
      <TextBtn type="button" disabled={disabled} onClick={() => onRules('format')} data-testid="action-open-conditional">
        Conditional…
      </TextBtn>
      <TextBtn type="button" disabled={disabled} onClick={() => onRules('validate')} data-testid="action-open-validation">
        Validation…
      </TextBtn>
    </Bar>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
  padding: 4px 12px; border-bottom: 1px solid ${C.line}; background: ${C.paper};
`;
const Btn = styled.button`
  min-width: 26px; height: 26px; padding: 0 5px; border-radius: 6px; cursor: pointer;
  font-size: 12.5px; color: ${C.ink}; background: none; border: 1px solid transparent;
  &:hover:not(:disabled) { background: ${C.paper2}; }
  &[aria-pressed='true'] { background: ${C.paper2}; border-color: ${C.green}; color: ${C.greenDeep}; }
  &:disabled { opacity: 0.4; cursor: default; }
`;
const TextBtn = styled(Btn)`font-size: 12px; color: ${C.muted};`;
const Sep = styled.span`width: 1px; height: 18px; background: ${C.line}; margin: 0 4px;`;
const ColorPick = styled.label<{ $swatch?: string; $fill?: boolean }>`
  position: relative; display: inline-flex; flex-direction: column; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 13px; color: ${C.ink};
  &:hover { background: ${C.paper2}; }
  span { line-height: 1; border-bottom: 3px solid ${(p) => p.$swatch || (p.$fill ? 'transparent' : C.ink)}; }
  input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  input:disabled { cursor: default; }
`;
const AlignIcon = styled.span<{ $align: 'left' | 'center' | 'right' }>`
  display: inline-block; width: 12px; height: 10px;
  background:
    linear-gradient(${C.ink}, ${C.ink}) 0 0 / 100% 2px no-repeat,
    linear-gradient(${C.ink}, ${C.ink}) ${(p) => (p.$align === 'left' ? '0' : p.$align === 'center' ? '50%' : '100%')} 50% / 60% 2px no-repeat,
    linear-gradient(${C.ink}, ${C.ink}) 0 100% / 100% 2px no-repeat;
`;
const Select = styled.select`
  height: 26px; font-size: 12px; padding: 0 6px; border-radius: 6px;
  color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line};
  &:disabled { opacity: 0.5; }
`;
