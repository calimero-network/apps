/**
 * StatusBar — thin sync/presence footer below the sheet tabs.
 * Layout:  ● Synced · N peers · M cells
 * Pure presentation; all values are derived by AppPage from live hook state.
 */
import styled from 'styled-components';
import { C } from '../theme';
import { syncLabel, peersLabel, cellsLabel } from '../spreadsheet/presence';

interface StatusBarProps {
  synced: boolean;
  peers: number;
  cells: number;
}

export default function StatusBar({ synced, peers, cells }: StatusBarProps) {
  return (
    <Bar role="status" aria-live="polite">
      <Dot $synced={synced} aria-hidden="true" />
      <span>{syncLabel(synced)}</span>
      <Sep aria-hidden="true">·</Sep>
      <span>{peersLabel(peers)}</span>
      <Sep aria-hidden="true">·</Sep>
      <span>{cellsLabel(cells)}</span>
    </Bar>
  );
}

const Bar = styled.footer`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  flex-shrink: 0;
  padding: 0 14px;
  background: ${C.chrome};
  border-top: 1px solid ${C.line};
  font-size: 11.5px;
  color: ${C.muted};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
`;

const Dot = styled.span<{ $synced: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => (p.$synced ? C.green : C.muted)};
  box-shadow: ${(p) => (p.$synced ? `0 0 6px ${C.green}` : 'none')};
`;

const Sep = styled.span`
  color: ${C.off};
`;
