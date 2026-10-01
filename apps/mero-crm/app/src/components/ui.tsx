// Shared CRM view primitives: buttons, panels, chips and form controls that
// every page composes, so the pages hold layout and behaviour rather than
// re-deriving the same styled blocks.
import React from 'react';
import styled, { css } from 'styled-components';
import { tokens as t, DUE_COLOR, HEALTH_COLOR } from '../theme';
import { dueLabel, formatMoney, ACTIVITY_LABEL, type DealHealth } from '../utils/crm';
import { KindIcon } from './icons';

const btnBase = css`
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: ${t.radius}; font-family: inherit; font-size: 12.5px; font-weight: 600;
  padding: 6px 11px; cursor: pointer; white-space: nowrap;
  transition: background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
  &:disabled { opacity: 0.55; cursor: default; }
`;

export const Button = styled.button<{ $variant?: 'primary' | 'ghost' | 'danger' | 'won' | 'lost'; $small?: boolean }>`
  ${btnBase}
  ${({ $small }) => $small && 'padding: 4px 8px; font-size: 11.5px;'}
  ${({ $variant = 'ghost' }) => {
    switch ($variant) {
      case 'primary':
        return `background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
          &:hover:not(:disabled) { background: #b6ff5e; }`;
      case 'danger':
        return `background: transparent; color: ${t.color.danger}; border: 1px solid ${t.color.dangerBorder};
          &:hover:not(:disabled) { background: rgba(229,105,95,0.1); }`;
      case 'won':
        return `background: rgba(127,201,107,0.16); color: ${t.color.done}; border: 1px solid rgba(127,201,107,0.4);
          &:hover:not(:disabled) { background: rgba(127,201,107,0.26); }`;
      case 'lost':
        return `background: rgba(229,105,95,0.12); color: ${t.color.urgent}; border: 1px solid ${t.color.dangerBorder};
          &:hover:not(:disabled) { background: rgba(229,105,95,0.22); }`;
      default:
        return `background: ${t.color.raised}; color: ${t.color.text}; border: 1px solid ${t.color.border};
          &:hover:not(:disabled) { background: ${t.color.raised2}; border-color: ${t.color.borderStrong}; }`;
    }
  }}
`;

export const Panel = styled.section`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px;
  padding: 14px 16px;
  > h3 {
    font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text3};
    font-weight: 600; margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
  }
  > .help { font-size: 12.5px; color: ${t.color.text3}; margin: -4px 0 12px; line-height: 1.5; }
`;

export const Page = styled.div`
  flex: 1; overflow-y: auto; padding: 18px 20px 48px;
  display: flex; flex-direction: column; gap: 16px; min-height: 0;
  /* A child with its own overflow (the stage stepper) would otherwise shrink
     to nothing in this column. */
  > * { flex-shrink: 0; }
`;

export const Empty = styled.div`
  color: ${t.color.text3}; font-size: 13px; padding: 48px 20px; text-align: center; line-height: 1.6;
  strong { color: ${t.color.text2}; display: block; font-size: 14px; margin-bottom: 4px; }
`;

const control = css`
  width: 100%; box-sizing: border-box; font-family: inherit;
  font-size: 13px; color: ${t.color.text}; background: ${t.color.raised};
  border: 1px solid ${t.color.border}; border-radius: ${t.radius}; padding: 8px 10px; outline: none;
  &::placeholder { color: ${t.color.text3}; }
  &:focus { border-color: ${t.color.accentBorder}; }
  &:disabled { opacity: 0.6; }
  color-scheme: dark;
`;
export const Input = styled.input`${control}`;
export const TextArea = styled.textarea`${control} resize: vertical; min-height: 64px; line-height: 1.5;`;
export const Select = styled.select`${control} padding: 7px 8px;`;

export const Label = styled.label`
  display: flex; flex-direction: column; gap: 6px; font-size: 11.5px; font-weight: 600; color: ${t.color.text2};
`;

export const Row = styled.div<{ $gap?: number; $wrap?: boolean }>`
  display: flex; align-items: center; gap: ${({ $gap = 8 }) => $gap}px;
  ${({ $wrap }) => $wrap && 'flex-wrap: wrap;'}
`;

export const Chip = styled.span<{ $color?: string }>`
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
  color: ${({ $color }) => $color ?? t.color.text2};
  background: ${t.color.raised2}; border: 1px solid ${t.color.border};
`;

export function Money({ value, currency, compact }: { value: number; currency: string; compact?: boolean }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(value, currency, compact)}</span>;
}

/** "Call · Tomorrow" with the due tone as colour. */
export function DueChip({ kind, dueAt, subject, now }: { kind: string; dueAt: number; subject?: string; now?: number }) {
  const due = dueLabel(dueAt, now);
  return (
    <Chip $color={DUE_COLOR[due.tone]} title={subject ? `${ACTIVITY_LABEL[kind] ?? kind}: ${subject}` : undefined} data-tone={due.tone}>
      <KindIcon kind={kind} size={11} />
      {due.text}
    </Chip>
  );
}

export function HealthDot({ health, size = 8 }: { health: DealHealth; size?: number }) {
  return (
    <span
      aria-label={`Health ${health.score}/100`}
      title={health.reasons.length ? health.reasons.join(' · ') : 'Healthy'}
      style={{
        width: size, height: size, borderRadius: '50%', display: 'inline-block', flex: '0 0 auto',
        background: HEALTH_COLOR[health.level],
      }}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const color = status === 'won' ? t.color.done : status === 'lost' ? t.color.urgent : t.color.text2;
  return <Chip $color={color} data-testid="deal-status">{status === 'open' ? 'Open' : status === 'won' ? 'Won' : 'Lost'}</Chip>;
}

export const Table = styled.table`
  width: 100%; border-collapse: collapse; font-size: 12.5px;
  th {
    text-align: left; font-size: 10.5px; letter-spacing: 0.05em; text-transform: uppercase;
    color: ${t.color.text3}; font-weight: 600; padding: 8px 10px; border-bottom: 1px solid ${t.color.border};
    white-space: nowrap;
  }
  td { padding: 9px 10px; border-bottom: 1px solid ${t.color.border}; vertical-align: middle; }
  tbody tr { cursor: pointer; transition: background 120ms ease-out; }
  tbody tr:hover { background: rgba(255,255,255,0.025); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: ${t.color.text3}; }
  .title { font-weight: 600; color: ${t.color.text}; }
`;

export const Tabs = styled.div`
  display: inline-flex; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radius}; padding: 2px; gap: 2px;
  button {
    font-family: inherit; font-size: 12px; font-weight: 600; color: ${t.color.text2};
    background: transparent; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer;
    &:hover { color: ${t.color.text}; }
    &[aria-pressed='true'] { background: ${t.color.raised2}; color: ${t.color.text}; }
  }
`;

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
