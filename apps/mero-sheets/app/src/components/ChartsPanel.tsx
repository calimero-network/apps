/**
 * ChartsPanel — the sheet's charts, drawn live from their ranges, and a
 * form to chart the selection. Charts are shared and follow their cells as
 * rows and columns move.
 */
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { closeButton, overlay, sheetHeader, sideSheet } from './glass';
import ChartView from './ChartView';
import type { ChartModel } from '../spreadsheet/chart';

export interface ChartsPanelItem {
  id: string;
  kind: 'bar' | 'line';
  title: string;
  /** Null when a corner row or column of its range is gone. */
  model: ChartModel | null;
  where: string | null;
}

export default function ChartsPanel({
  charts, selection, canEdit, onAdd, onRemove, onClose,
}: {
  charts: ChartsPanelItem[];
  /** The selection a new chart would plot, as shown; null with none. */
  selection: string | null;
  canEdit: boolean;
  onAdd: (kind: 'bar' | 'line', title: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'bar' | 'line'>('bar');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label="Charts" onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">Charts</span>
          <CloseBtn onClick={onClose} aria-label="Close charts">×</CloseBtn>
        </Header>
        {canEdit && (
          <Form>
            <p>{selection ? <>Chart <code>{selection}</code>: the first column labels the points, each other column is a series.</> : 'Select a range to chart.'}</p>
            <div className="row">
              <select aria-label="Chart type" value={kind} onChange={(e) => setKind(e.target.value as 'bar' | 'line')} data-testid="field-chart-kind">
                <option value="bar">Bars</option>
                <option value="line">Lines</option>
              </select>
              <input aria-label="Chart title" placeholder="Title (optional)" maxLength={120} value={title}
                onChange={(e) => setTitle(e.target.value)} data-testid="field-chart-title" />
              <button type="button" disabled={!selection || busy} data-testid="action-add-chart"
                onClick={() => void run(async () => { await onAdd(kind, title); setTitle(''); })}>
                Add
              </button>
            </div>
            {error && <p className="err">{error}</p>}
          </Form>
        )}
        <Body>
          {charts.length === 0 && <Empty>No charts on this sheet yet.</Empty>}
          {charts.map((c) => (
            <div key={c.id} data-testid="item-Chart">
              {c.model
                ? <ChartView model={c.model} kind={c.kind} title={c.title} />
                : <Empty>{c.title || 'A chart'}: its range was deleted.</Empty>}
              <Meta>
                <span>{c.where ?? ''}</span>
                {canEdit && <button type="button" disabled={busy} onClick={() => void run(() => onRemove(c.id))}>Remove</button>}
              </Meta>
            </div>
          ))}
        </Body>
      </Panel>
    </Overlay>
  );
}

const Overlay = styled.div`
  ${overlay}
  z-index: 200;
  display: flex; justify-content: flex-end;
`;
const Panel = styled.div`
  ${sideSheet}
  --sheet-w: 460px;
`;
const Header = styled.div`
  ${sheetHeader}
`;
const CloseBtn = styled.button`
  ${closeButton}
`;
const Form = styled.div`
  padding: 12px 18px; border-bottom: 1px solid ${C.line};
  p { margin: 0 0 8px; font-size: 12.5px; color: ${C.muted}; line-height: 1.45; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.greenDeep}; }
  .row { display: flex; gap: 8px; }
  select, input { padding: 7px 9px; font-size: 13px; color: ${C.ink}; background: var(--glass-sunken); border: 1px solid var(--glass-line); border-radius: 8px; }
  input { flex: 1; min-width: 0; }
  button { padding: 7px 14px; font-size: 13px; font-weight: 600; border-radius: 999px; cursor: pointer; color: var(--glass-on-ink); background: var(--glass-ink); border: none; }
  button:disabled { opacity: 0.5; cursor: default; }
  .err { margin: 8px 0 0; color: ${C.danger}; }
`;
const Body = styled.div`flex: 1; overflow-y: auto; padding: 0 18px 24px;`;
const Empty = styled.p`margin: 18px 0; font-size: 13px; color: ${C.muted}; text-align: center;`;
const Meta = styled.div`
  display: flex; justify-content: space-between; padding: 4px 0 10px; font-size: 11.5px; color: ${C.mutedSoft};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  button { font-size: 11.5px; color: ${C.muted}; background: none; border: none; cursor: pointer; }
  button:hover { color: ${C.danger}; }
`;
