/**
 * LinksPanel — ranges this workbook pushes to other workbooks in the
 * workspace, and sheets pushed here from them. A link arrives as a read-only
 * sheet the other workbook's formulas can use, and is pushed again whenever a
 * cell on its sheet changes.
 */
import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';

export interface LinkOut { id: string; name: string; where: string | null; target: string }
export interface LinkIn { sheetId: string; name: string; from: string }

export default function LinksPanel({
  selection, workbooks, outgoing, incoming, canEdit, onPublish, onPush, onUnpublish, onUnlink, onClose,
}: {
  selection: string | null;
  /** Other workbooks in the workspace. */
  workbooks: { contextId: string; name: string }[];
  outgoing: LinkOut[];
  incoming: LinkIn[];
  canEdit: boolean;
  onPublish: (target: string, name: string) => Promise<void>;
  onPush: (id: string) => Promise<void>;
  onUnpublish: (id: string) => Promise<void>;
  onUnlink: (sheetId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(workbooks[0]?.contextId ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setNote(null);
    try { await fn(); if (done) setNote(done); } catch (err) { setNote(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label="Linked workbooks" onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">Linked workbooks</span>
          <CloseBtn onClick={onClose} aria-label="Close links">×</CloseBtn>
        </Header>
        {canEdit && (
          <Form>
            <p>
              {selection ? <>Send <code>{selection}</code> to another workbook, where it appears as a read-only sheet that stays up to date.</> : 'Select a range to link.'}
            </p>
            {workbooks.length === 0 ? (
              <p className="muted">There is no other workbook in this workspace yet.</p>
            ) : (
              <>
                <div className="row">
                  <select aria-label="Workbook" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="field-link-target">
                    {workbooks.map((w) => <option key={w.contextId} value={w.contextId}>{w.name}</option>)}
                  </select>
                  <input aria-label="Sheet name there" placeholder="Sheet name there" maxLength={50} value={name}
                    onChange={(e) => setName(e.target.value)} data-testid="field-link-name" />
                </div>
                <button type="button" disabled={!selection || !name.trim() || !target || busy} data-testid="action-publish"
                  onClick={() => void run(async () => { await onPublish(target, name.trim()); setName(''); }, 'Linked. It appears there once that workbook is open on this node.')}>
                  Link
                </button>
              </>
            )}
          </Form>
        )}
        {note && <Note role="status">{note}</Note>}
        <Body>
          <h4>From this workbook</h4>
          {outgoing.length === 0 && <Empty>No links yet.</Empty>}
          {outgoing.map((l) => (
            <Item key={l.id} data-testid="item-Publication">
              <div><strong>{l.name}</strong> → {l.target}</div>
              <div className="meta">{l.where ?? '(range removed)'}</div>
              {canEdit && (
                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => void run(() => onPush(l.id), 'Pushed.')}>Push now</button>
                  <button type="button" disabled={busy} onClick={() => void run(() => onUnpublish(l.id))}>Stop</button>
                </div>
              )}
            </Item>
          ))}
          <h4>Into this workbook</h4>
          {incoming.length === 0 && <Empty>No linked sheets.</Empty>}
          {incoming.map((l) => (
            <Item key={l.sheetId} data-testid="item-Link">
              <div><strong>{l.name}</strong> ← {l.from}</div>
              {canEdit && (
                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => void run(() => onUnlink(l.sheetId))}>Remove</button>
                </div>
              )}
            </Item>
          ))}
        </Body>
      </Panel>
    </Overlay>
  );
}

const slideIn = keyframes`from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; }`;
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 200; background: rgba(14, 20, 15, 0.3); backdrop-filter: blur(2px);
  animation: ${fadeIn} 0.18s ease; display: flex; justify-content: flex-end;
`;
const Panel = styled.div`
  width: 440px; max-width: 100vw; height: 100%; background: ${C.paper}; border-left: 1px solid ${C.line};
  display: flex; flex-direction: column; animation: ${slideIn} 0.22s cubic-bezier(0.22, 1, 0.36, 1);
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid ${C.line};
  .title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; font-size: 20px; color: ${C.mutedSoft}; background: transparent; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
const Form = styled.div`
  padding: 12px 18px; border-bottom: 1px solid ${C.line};
  p { margin: 0 0 8px; font-size: 12.5px; color: ${C.muted}; line-height: 1.45; }
  .muted { color: ${C.mutedSoft}; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.greenDeep}; }
  .row { display: flex; gap: 8px; margin-bottom: 8px; }
  select, input { flex: 1; min-width: 0; padding: 7px 9px; font-size: 13px; color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 8px; }
  button { padding: 7px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; cursor: pointer; color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c; }
  button:disabled { opacity: 0.5; cursor: default; }
`;
const Note = styled.p`margin: 0; padding: 8px 18px; font-size: 12.5px; color: ${C.muted}; border-bottom: 1px solid ${C.line};`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 4px 18px 24px;
  h4 { margin: 16px 0 6px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.mutedSoft}; }
`;
const Empty = styled.p`margin: 6px 0; font-size: 13px; color: ${C.muted};`;
const Item = styled.div`
  padding: 8px 0; border-bottom: 1px solid ${C.line}; font-size: 13px; color: ${C.ink};
  .meta { font-size: 11.5px; color: ${C.mutedSoft}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
  .actions { display: flex; gap: 12px; margin-top: 4px; }
  .actions button { font-size: 12px; color: ${C.greenDeep}; background: none; border: none; cursor: pointer; padding: 0; }
`;
