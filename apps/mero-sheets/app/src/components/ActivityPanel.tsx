/**
 * ActivityPanel — who changed what, and when, across the workbook.
 *
 * Reads the contract's activity log (every edit, structural change, sheet and
 * name action, with the cell values before and after). "This cell" narrows it
 * to the selected cell's history. Clicking a cell reference jumps to it.
 */
import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import type { ActivityEntry } from '../hooks/useSpreadsheet';
import { ago, nsToMs } from '../lib/time';

/** How far back the panel reads. */
const DAYS = 14;

interface ActivityPanelProps {
  load: (days: number) => Promise<ActivityEntry[]>;
  /** Bumps whenever the workbook changes, so an open panel stays current. */
  revision: unknown;
  nameOf: (memberId: string) => string;
  sheetName: (sheetId: string) => string | null;
  /** A1 for a cell id on a sheet, or null when its row/column is gone. */
  refOf: (sheetId: string, rowId: string, colId: string) => string | null;
  /** A stored raw value as the formula bar would show it. */
  showRaw: (sheetId: string, raw: string) => string;
  /** The selected cell, for "This cell". */
  selected: { sheetId: string; rowId: string; colId: string } | null;
  onJump: (sheetId: string, rowId: string, colId: string) => void;
  onClose: () => void;
}

export default function ActivityPanel({
  load, revision, nameOf, sheetName, refOf, showRaw, selected, onJump, onClose,
}: ActivityPanelProps) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyCell, setOnlyCell] = useState(false);

  useEffect(() => {
    let live = true;
    load(DAYS)
      .then((e) => { if (live) { setEntries(e); setError(null); } })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [load, revision]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const touchesSelected = (e: ActivityEntry) =>
    !!selected && e.sheet_id === selected.sheetId &&
    e.changes.some((c) => c.row_id === selected.rowId && c.col_id === selected.colId);
  const shown = (entries ?? []).filter((e) => !onlyCell || touchesSelected(e));

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label="Activity" onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">Activity</span>
          <CloseBtn onClick={onClose} aria-label="Close activity">×</CloseBtn>
        </Header>
        <Filters role="group" aria-label="Show">
          <Chip type="button" aria-pressed={!onlyCell} onClick={() => setOnlyCell(false)}>Whole workbook</Chip>
          <Chip type="button" aria-pressed={onlyCell} disabled={!selected} onClick={() => setOnlyCell(true)}
            data-testid="action-cell-history">
            This cell
          </Chip>
        </Filters>
        <List data-testid="list-activity">
          {error && <Empty>{error}</Empty>}
          {!error && entries === null && <Empty>Loading…</Empty>}
          {!error && entries !== null && shown.length === 0 && (
            <Empty>{onlyCell ? 'No changes to this cell in the last two weeks.' : 'Nothing has changed in the last two weeks.'}</Empty>
          )}
          {shown.map((e) => (
            <Item key={e.id} data-testid="item-ActivityEntry">
              <div className="head">
                <strong>{nameOf(e.author)}</strong> {e.summary}
                {e.sheet_id && sheetName(e.sheet_id) && <span className="where"> · {sheetName(e.sheet_id)}</span>}
              </div>
              <time dateTime={new Date(nsToMs(e.at)).toISOString()}>{ago(nsToMs(e.at))}</time>
              {e.changes.length > 0 && (
                <ul className="changes">
                  {e.changes.slice(0, 6).map((c) => {
                    const ref = refOf(e.sheet_id, c.row_id, c.col_id);
                    return (
                      <li key={`${c.row_id}|${c.col_id}`}>
                        {ref
                          ? <button type="button" onClick={() => onJump(e.sheet_id, c.row_id, c.col_id)}>{ref}</button>
                          : <span className="gone">(removed)</span>}
                        <span className="from">{showRaw(e.sheet_id, c.before_raw) || '∅'}</span>
                        <span aria-hidden="true">→</span>
                        <span className="to">{showRaw(e.sheet_id, c.after_raw) || '∅'}</span>
                        {c.before_format !== c.after_format && <span className="fmt">{c.after_format || 'Automatic'}</span>}
                      </li>
                    );
                  })}
                  {e.count > 6 && <li className="more">and {e.count - 6} more</li>}
                </ul>
              )}
            </Item>
          ))}
        </List>
      </Panel>
    </Overlay>
  );
}

const slideIn = keyframes`from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; }`;
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 200;
  background: rgba(14, 20, 15, 0.3); backdrop-filter: blur(2px);
  animation: ${fadeIn} 0.18s ease;
  display: flex; justify-content: flex-end;
`;

const Panel = styled.div`
  width: 420px; max-width: 100vw; height: 100%;
  background: ${C.paper}; border-left: 1px solid ${C.line};
  display: flex; flex-direction: column;
  animation: ${slideIn} 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: -20px 0 60px -20px rgba(14, 20, 15, 0.25);
`;

const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 1px solid ${C.line}; flex-shrink: 0;
  .title { font-size: 15px; font-weight: 700; color: ${C.ink}; letter-spacing: -0.2px; }
`;

const CloseBtn = styled.button`
  width: 30px; height: 30px; display: grid; place-items: center;
  font-size: 20px; line-height: 1; color: ${C.mutedSoft};
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;

const Filters = styled.div`
  display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid ${C.line};
`;

const Chip = styled.button`
  font-size: 11px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid ${C.line}; background: ${C.paper}; color: ${C.muted}; cursor: pointer;
  &:hover:not(:disabled) { color: ${C.ink}; }
  &:disabled { opacity: 0.45; cursor: default; }
  &[aria-pressed='true'] { border-color: ${C.green}; color: ${C.greenDeep}; background: ${C.paper2}; }
`;

const List = styled.ol`
  list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1;
  scrollbar-width: thin; scrollbar-color: ${C.line} transparent;
`;

const Item = styled.li`
  padding: 12px 18px; border-bottom: 1px solid ${C.line}; font-size: 13px; color: ${C.ink};
  .head { line-height: 1.45; }
  .head strong { font-weight: 650; }
  .where { color: ${C.muted}; }
  time { display: block; margin-top: 2px; font-size: 11.5px; color: ${C.mutedSoft}; }
  .changes {
    list-style: none; margin: 8px 0 0; padding: 0;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px;
  }
  .changes li { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; color: ${C.muted}; }
  .changes button {
    font: inherit; color: ${C.greenDeep}; background: none; border: none; padding: 0;
    cursor: pointer; min-width: 36px; text-align: left;
    &:hover { text-decoration: underline; }
  }
  .from { text-decoration: line-through; opacity: 0.75; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .to { color: ${C.ink}; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fmt { font-size: 10.5px; color: ${C.mutedSoft}; text-transform: uppercase; letter-spacing: 0.04em; }
  .gone, .more { color: ${C.mutedSoft}; }
`;

const Empty = styled.li`
  padding: 32px 18px; text-align: center; font-size: 13px; color: ${C.muted};
`;
