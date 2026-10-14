// Shared CRM view primitives: buttons, panels, chips and form controls that
// every page composes, so the pages hold layout and behaviour rather than
// re-deriving the same styled blocks.
import React from 'react';
import styled, { css } from 'styled-components';
import { tokens as t, DUE_COLOR, HEALTH_COLOR } from '../theme';
import { dueLabel, formatMoney, ACTIVITY_LABEL, type DealHealth } from '../utils/crm';
import { KindIcon } from './icons';

const btnBase = css`
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  border-radius: ${t.radiusPill}; font-family: inherit; font-size: 13px; font-weight: 600;
  min-height: 36px; padding: 0 16px; cursor: pointer; white-space: nowrap; letter-spacing: -0.005em;
  transition: background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out;
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${t.focus}; }
`;

export const Button = styled.button<{ $variant?: 'primary' | 'ghost' | 'danger' | 'won' | 'lost'; $small?: boolean }>`
  ${btnBase}
  ${({ $small }) => $small && 'min-height: 28px; padding: 0 11px; font-size: 12px; gap: 5px;'}
  ${({ $variant = 'ghost' }) => {
    switch ($variant) {
      case 'primary':
        return `background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
          box-shadow: 0 8px 20px -12px rgba(14, 18, 34, 0.55);
          &:hover:not(:disabled) { background: ${t.color.accentHover}; }`;
      case 'danger':
        return `background: transparent; color: ${t.color.danger}; border: 1px solid ${t.color.dangerBorder};
          &:hover:not(:disabled) { background: ${t.color.badBg}; }`;
      case 'won':
        return `background: ${t.color.goodBg}; color: ${t.color.done}; border: 1px solid color-mix(in srgb, ${t.color.done} 35%, transparent);
          &:hover:not(:disabled) { border-color: ${t.color.done}; }`;
      case 'lost':
        return `background: ${t.color.badBg}; color: ${t.color.urgent}; border: 1px solid ${t.color.dangerBorder};
          &:hover:not(:disabled) { border-color: ${t.color.urgent}; }`;
      default:
        return `background: ${t.color.raised}; color: ${t.color.text}; border: 1px solid ${t.color.borderStrong};
          &:hover:not(:disabled) { background: ${t.color.hover}; }`;
    }
  }}
`;

/**
 * Frosted frame panel; the tables and forms inside stay sharp.
 *
 * ⚠️ backdrop-filter makes this the containing block for any `position: fixed`
 * descendant, so a modal rendered INSIDE a Panel is trapped in it. Render
 * dialogs as siblings of panels (every page does), never as children.
 */
export const Panel = styled.section`
  background: ${t.color.glass}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusLg};
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur}; box-shadow: ${t.shadow};
  padding: 20px 22px; min-width: 0;
  > h3 {
    font-size: 14.5px; letter-spacing: -0.01em; color: ${t.color.text};
    font-weight: 650; margin: 0 0 14px; display: flex; align-items: center; gap: 8px;
    svg { color: ${t.color.accentText}; }
  }
  > .help { font-size: 12.5px; color: ${t.color.text3}; margin: -8px 0 14px; line-height: 1.55; max-width: 640px; }
  @media (max-width: 720px) { padding: 16px; border-radius: 18px; }
`;

export const Page = styled.div`
  flex: 1; overflow-y: auto; padding: 20px 24px 56px;
  display: flex; flex-direction: column; gap: 18px; min-height: 0; min-width: 0;
  /* A child with its own overflow (the stage stepper) would otherwise shrink
     to nothing in this column. */
  > * { flex-shrink: 0; }
  @media (max-width: 720px) { padding: 14px 12px 40px; gap: 14px; }
`;

/** A count next to a heading or tab: small, quiet, rounded. */
export const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px;
  padding: 0 6px; border-radius: ${t.radiusPill}; font-size: 11px; font-weight: 650;
  font-variant-numeric: tabular-nums; color: ${t.color.text2}; background: ${t.color.raised2};
`;

export const Empty = styled.div`
  color: ${t.color.text3}; font-size: 13px; padding: 56px 24px; text-align: center; line-height: 1.6;
  margin: 8px auto; max-width: 460px; width: 100%;
  background: ${t.color.glass}; border: 1px dashed ${t.color.borderStrong}; border-radius: ${t.radiusLg};
  strong { color: ${t.color.text}; display: block; font-size: 15px; font-weight: 650; margin-bottom: 6px; letter-spacing: -0.01em; }
`;

/**
 * A table's frame: a frosted card that scrolls sideways INSIDE itself on a
 * narrow screen, so a wide table never scrolls the page.
 */
export const TableCard = styled.div`
  background: ${t.color.glass}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusLg};
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur}; box-shadow: ${t.shadow};
  padding: 6px 10px; overflow-x: auto; min-width: 0;
  @media (max-width: 720px) { padding: 4px 6px; border-radius: 18px; }
`;

const control = css`
  width: 100%; box-sizing: border-box; font-family: inherit; min-height: 38px;
  font-size: 13px; color: ${t.color.text}; background: ${t.color.raised};
  border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radius}; padding: 8px 12px; outline: none;
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  &::placeholder { color: ${t.color.text3}; }
  &:focus { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
  &:disabled { opacity: 0.6; }
`;
export const Input = styled.input`${control}`;
export const TextArea = styled.textarea`${control} resize: vertical; min-height: 76px; line-height: 1.5; padding: 10px 12px;`;
export const Select = styled.select`${control} padding: 7px 10px; cursor: pointer;`;

export const Label = styled.label`
  display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: ${t.color.text2};
`;

export const Row = styled.div<{ $gap?: number; $wrap?: boolean }>`
  display: flex; align-items: center; gap: ${({ $gap = 8 }) => $gap}px;
  ${({ $wrap }) => $wrap && 'flex-wrap: wrap;'}
`;

export const Chip = styled.span<{ $color?: string }>`
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; line-height: 1.3;
  color: ${({ $color }) => $color ?? t.color.text2};
  background: ${({ $color }) => ($color ? `color-mix(in srgb, ${$color} 11%, transparent)` : t.color.raised2)};
  border: 1px solid ${({ $color }) => ($color ? `color-mix(in srgb, ${$color} 22%, transparent)` : t.color.border)};
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

/** Data table. `.hide-sm` columns drop out on a phone. */
export const Table = styled.table`
  width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px;
  th {
    text-align: left; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
    color: ${t.color.text3}; font-weight: 600; padding: 12px 12px 10px; border-bottom: 1px solid ${t.color.border};
    white-space: nowrap;
  }
  td { padding: 12px; border-bottom: 1px solid ${t.color.border}; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr { cursor: pointer; transition: background 120ms ease-out; }
  tbody tr:hover td { background: ${t.color.hover}; }
  tbody tr:hover td:first-child { border-radius: 12px 0 0 12px; }
  tbody tr:hover td:last-child { border-radius: 0 12px 12px 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: ${t.color.text3}; font-size: 12px; }
  .title { font-weight: 600; color: ${t.color.text}; }
  a.link { color: ${t.color.accentText}; &:hover { text-decoration: underline; } }
  @media (max-width: 720px) {
    .hide-sm { display: none; }
    th, td { padding-left: 8px; padding-right: 8px; }
  }
`;

export const Tabs = styled.div`
  display: inline-flex; background: ${t.color.raised2}; border: 1px solid ${t.color.border};
  border-radius: ${t.radiusPill}; padding: 4px; gap: 2px; max-width: 100%; overflow-x: auto;
  button {
    font-family: inherit; font-size: 12.5px; font-weight: 600; color: ${t.color.text2}; white-space: nowrap;
    background: transparent; border: none; border-radius: ${t.radiusPill}; padding: 6px 14px; cursor: pointer;
    transition: background 150ms ease-out, color 150ms ease-out;
    &:hover { color: ${t.color.text}; }
    &:focus-visible { outline: none; box-shadow: 0 0 0 3px ${t.focus}; }
    &[aria-pressed='true'] { background: ${t.color.panel}; color: ${t.color.text}; box-shadow: ${t.shadowCard}; }
  }
`;

/** A heading row at the top of a page: what you are looking at, and its actions. */
export const PageHead = styled.div`
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  .stat { font-size: 13px; color: ${t.color.text2}; strong { color: ${t.color.text}; font-weight: 650; } }
  .end { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
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
