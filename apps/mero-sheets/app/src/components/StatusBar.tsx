/**
 * StatusBar — thin sync/presence footer below the sheet tabs.
 * Layout:  ● Up to date · N peers · M cells
 * Pure presentation; the sync state comes from `spreadsheet/sync.ts`.
 */
import styled from 'styled-components';
import { C } from '../theme';
import { peersLabel, cellsLabel } from '../spreadsheet/presence';
import type { SyncTone, SyncView } from '../spreadsheet/sync';

interface StatusBarProps {
  sync: SyncView;
  peers: number;
  cells: number;
}

export default function StatusBar({ sync, peers, cells }: StatusBarProps) {
  return (
    <Bar role="status" aria-live="polite">
      <Dot $tone={sync.tone} aria-hidden="true" />
      <span title={sync.detail} data-testid="sync-status">{sync.label}</span>
      <Sep aria-hidden="true">·</Sep>
      <span>{peersLabel(peers)}</span>
      <Sep aria-hidden="true">·</Sep>
      <span>{cellsLabel(cells)}</span>
    </Bar>
  );
}

/* A quiet line under the sheet card, on the glass ground. */
const Bar = styled.footer`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
  flex-shrink: 0;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: ${C.muted};
  font-family: var(--glass-font);
  white-space: nowrap;
  overflow: hidden;
`;

const TONE: Record<SyncTone, string> = { ok: 'var(--glass-good-ink)', busy: C.muted, warn: '#eda100', off: C.danger };

const Dot = styled.span<{ $tone: SyncTone }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => TONE[p.$tone]};
  box-shadow: ${(p) => (p.$tone === 'ok' ? '0 0 6px var(--glass-good-ink)' : 'none')};
`;

const Sep = styled.span`
  color: ${C.off};
`;
