// Shared view primitives: buttons, panels, tables, form controls, money and
// status badges that every page composes, so the pages hold layout and
// behaviour rather than re-deriving the same styled blocks.
import React, { useEffect } from 'react';
import styled, { css } from 'styled-components';
import { tokens as t, STATUS_COLOR } from '../theme';
import { formatAmount, formatMoney, STATUS_LABEL, type DocStatus } from '../utils/books';

const btnBase = css`
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: ${t.radius}; font-family: inherit; font-size: 12.5px; font-weight: 600;
  padding: 7px 12px; cursor: pointer; white-space: nowrap; text-decoration: none;
  transition: background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
  &:disabled { opacity: 0.55; cursor: default; }
`;

export const Button = styled.button<{ $variant?: 'primary' | 'ghost' | 'danger' | 'success'; $small?: boolean }>`
  ${btnBase}
  ${({ $small }) => $small && 'padding: 4px 9px; font-size: 11.5px;'}
  ${({ $variant = 'ghost' }) => {
    switch ($variant) {
      case 'primary':
        return `background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
          &:hover:not(:disabled) { background: ${t.color.accentHover}; }`;
      case 'danger':
        return `background: transparent; color: ${t.color.danger}; border: 1px solid ${t.color.dangerBorder};
          &:hover:not(:disabled) { background: rgba(217,45,32,0.07); }`;
      case 'success':
        return `background: ${t.color.done}; color: #fff; border: 1px solid transparent;
          &:hover:not(:disabled) { background: #067647; }`;
      default:
        return `background: ${t.color.panel}; color: ${t.color.text}; border: 1px solid ${t.color.borderStrong};
          &:hover:not(:disabled) { background: ${t.color.raised2}; }`;
    }
  }}
`;

export const Panel = styled.section`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px;
  padding: 16px 18px;
  > h3 {
    font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: ${t.color.text2};
    font-weight: 700; margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
  }
  > .help { font-size: 12.5px; color: ${t.color.text3}; margin: -4px 0 12px; line-height: 1.5; }
`;

export const Page = styled.div`
  flex: 1; overflow-y: auto; padding: 20px 24px 56px;
  display: flex; flex-direction: column; gap: 16px; min-height: 0;
  > * { flex-shrink: 0; }
  @media (max-width: 720px) { padding: 14px 12px 40px; }
`;

export const PageHead = styled.div`
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .sub { color: ${t.color.text2}; font-size: 13px; }
  .actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
`;

export const Empty = styled.div`
  color: ${t.color.text3}; font-size: 13px; padding: 44px 20px; text-align: center; line-height: 1.6;
  strong { color: ${t.color.text2}; display: block; font-size: 14px; margin-bottom: 4px; }
`;

const control = css`
  width: 100%; box-sizing: border-box; font-family: inherit;
  font-size: 13px; color: ${t.color.text}; background: ${t.color.panel};
  border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radius}; padding: 7px 9px; outline: none;
  &::placeholder { color: ${t.color.text3}; }
  &:focus { border-color: ${t.color.accent}; box-shadow: 0 0 0 3px ${t.color.accentDim}; }
  &:disabled { opacity: 0.6; background: ${t.color.raised}; }
  color-scheme: light;
`;
export const Input = styled.input`${control}`;
export const NumInput = styled.input`${control} text-align: right; font-variant-numeric: tabular-nums;`;
export const TextArea = styled.textarea`${control} resize: vertical; min-height: 60px; line-height: 1.5;`;
export const Select = styled.select`${control} padding: 6px 7px;`;

export const Label = styled.label`
  display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; font-weight: 600; color: ${t.color.text2};
`;

export const FieldGrid = styled.div<{ $cols?: number }>`
  display: grid; gap: 12px;
  grid-template-columns: repeat(${({ $cols = 2 }) => $cols}, minmax(0, 1fr));
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;

export const Row = styled.div<{ $gap?: number; $wrap?: boolean }>`
  display: flex; align-items: center; gap: ${({ $gap = 8 }) => $gap}px;
  ${({ $wrap }) => $wrap && 'flex-wrap: wrap;'}
`;

export const Chip = styled.span<{ $color?: string }>`
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  color: ${({ $color }) => $color ?? t.color.text2};
  background: ${t.color.raised2};
`;

export function Money({ value, currency, signed }: { value: number; currency: string; signed?: boolean }) {
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', color: signed && value < 0 ? t.color.urgent : undefined }}>
      {signed ? formatAmount(value, currency) : formatMoney(value, currency)}
    </span>
  );
}

export function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <Chip $color={STATUS_COLOR[status]} data-testid="doc-status" data-status={status}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

export const Table = styled.table`
  width: 100%; border-collapse: collapse; font-size: 13px;
  th {
    text-align: left; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
    color: ${t.color.text3}; font-weight: 700; padding: 8px 10px; border-bottom: 1px solid ${t.color.borderStrong};
    white-space: nowrap; background: ${t.color.panel};
  }
  td { padding: 9px 10px; border-bottom: 1px solid ${t.color.border}; vertical-align: middle; }
  tbody tr.click { cursor: pointer; transition: background 120ms ease-out; }
  tbody tr.click:hover { background: ${t.color.hover}; }
  tfoot td { font-weight: 700; border-top: 2px solid ${t.color.borderStrong}; border-bottom: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: ${t.color.text3}; }
  .strong { font-weight: 600; color: ${t.color.text}; }
  .neg { color: ${t.color.urgent}; }
  tr.voided td { color: ${t.color.text3}; text-decoration: line-through; }
`;

export const TableWrap = styled.div`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px; overflow-x: auto;
`;

export const Tabs = styled.div`
  display: inline-flex; background: ${t.color.raised2}; border-radius: ${t.radius}; padding: 3px; gap: 2px; flex-wrap: wrap;
  button {
    font-family: inherit; font-size: 12.5px; font-weight: 600; color: ${t.color.text2};
    background: transparent; border: none; border-radius: 4px; padding: 5px 11px; cursor: pointer;
    &:hover { color: ${t.color.text}; }
    &[aria-pressed='true'] { background: ${t.color.panel}; color: ${t.color.text}; box-shadow: 0 1px 2px rgba(15,23,42,0.08); }
  }
  .n { color: ${t.color.text3}; font-weight: 500; margin-left: 4px; }
`;

export const Stat = styled.div`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px; padding: 14px 16px;
  .k { font-size: 12px; color: ${t.color.text2}; font-weight: 600; }
  .v { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .s { font-size: 12px; color: ${t.color.text3}; margin-top: 2px; }
`;

export const Grid = styled.div<{ $min?: number }>`
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(${({ $min = 220 }) => $min}px, 1fr));
`;

export const ErrorText = styled.p`margin: 0; font-size: 12.5px; color: ${t.color.urgent};`;

// ── modal ──────────────────────────────────────────────────────────────────

const Overlay = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.42); z-index: 50;
  display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px; overflow-y: auto;
`;
const Sheet = styled.div<{ $wide?: boolean }>`
  background: ${t.color.panel}; border-radius: ${t.radiusModal}; width: 100%;
  max-width: ${({ $wide }) => ($wide ? 760 : 480)}px; box-shadow: 0 24px 60px rgba(15,23,42,0.25);
  padding: 20px 22px; display: flex; flex-direction: column; gap: 14px;
  h2 { font-size: 16px; font-weight: 700; margin: 0; }
  .sub { font-size: 12.5px; color: ${t.color.text2}; margin: -8px 0 0; line-height: 1.5; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
`;

export function Modal({
  title, sub, onClose, children, wide, testId,
}: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Overlay onMouseDown={onClose}>
      <Sheet $wide={wide} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </Sheet>
    </Overlay>
  );
}

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
