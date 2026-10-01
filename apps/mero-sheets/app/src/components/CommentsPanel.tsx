/**
 * CommentsPanel — discussion on cells.
 *
 * Shows the selected cell's thread (comments and replies, resolve/reopen, edit
 * and delete your own), or every open thread in the workbook with a jump to
 * its cell. `@nickname` mentions a collaborator: their app tells them.
 */
import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import type { Comment } from '../hooks/useSpreadsheet';
import { ago, nsToMs } from '../lib/time';

interface CommentsPanelProps {
  comments: Comment[];
  /** The selected cell, when there is one: its thread is shown first. */
  cell: { sheetId: string; rowId: string; colId: string; label: string } | null;
  selfId: string | null;
  nameOf: (memberId: string) => string;
  /** "B3" (or "Sheet 2!B3") for a comment's cell; null when it is gone. */
  where: (c: Comment) => string | null;
  onAdd: (text: string, parent: string) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onJump: (c: Comment) => void;
  onClose: () => void;
}

type View = 'cell' | 'open';

export default function CommentsPanel(props: CommentsPanelProps) {
  const { comments, cell, onClose } = props;
  const [view, setView] = useState<View>(cell ? 'cell' : 'open');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const roots = comments.filter((c) => !c.parent);
  const cellRoots = cell
    ? roots.filter((c) => c.sheet_id === cell.sheetId && c.row_id === cell.rowId && c.col_id === cell.colId)
    : [];
  const openRoots = roots.filter((c) => !c.resolved);

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label="Comments" onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">Comments</span>
          <CloseBtn onClick={onClose} aria-label="Close comments">×</CloseBtn>
        </Header>
        <Tabs role="group" aria-label="Show">
          <Chip type="button" aria-pressed={view === 'cell'} disabled={!cell} onClick={() => setView('cell')}>
            {cell ? `Cell ${cell.label}` : 'This cell'}
          </Chip>
          <Chip type="button" aria-pressed={view === 'open'} onClick={() => setView('open')}>
            Open threads ({openRoots.length})
          </Chip>
        </Tabs>
        <Body>
          {view === 'cell' && cell && (
            <>
              {cellRoots.length === 0 && <Empty>No comments on {cell.label} yet.</Empty>}
              {cellRoots.map((root) => <Thread key={root.id} root={root} {...props} />)}
              <Composer placeholder={`Comment on ${cell.label}… (@name to mention)`} onSubmit={(t) => props.onAdd(t, '')} testId="field-comment" />
            </>
          )}
          {view === 'open' && (
            <>
              {openRoots.length === 0 && <Empty>No open threads.</Empty>}
              {openRoots.map((root) => (
                <div key={root.id}>
                  <JumpLink type="button" onClick={() => props.onJump(root)}>{props.where(root) ?? '(removed cell)'}</JumpLink>
                  <Thread root={root} {...props} />
                </div>
              ))}
            </>
          )}
        </Body>
      </Panel>
    </Overlay>
  );
}

function Thread({ root, comments, selfId, nameOf, onAdd, onEdit, onResolve, onDelete }: CommentsPanelProps & { root: Comment }) {
  const replies = comments.filter((c) => c.parent === root.id);
  const [replying, setReplying] = useState(false);
  return (
    <ThreadBox $resolved={root.resolved} data-testid="item-Comment-thread">
      {[root, ...replies].map((c) => (
        <Entry key={c.id} c={c} mine={c.author === selfId} nameOf={nameOf} onEdit={onEdit} onDelete={onDelete} />
      ))}
      <Actions>
        <button type="button" onClick={() => setReplying((r) => !r)}>Reply</button>
        <button type="button" onClick={() => void onResolve(root.id, !root.resolved)} data-testid="action-resolve-comment">
          {root.resolved ? 'Reopen' : 'Resolve'}
        </button>
      </Actions>
      {replying && (
        <Composer placeholder="Reply…" onSubmit={async (t) => { await onAdd(t, root.id); setReplying(false); }} testId="field-reply" />
      )}
    </ThreadBox>
  );
}

function Entry({ c, mine, nameOf, onEdit, onDelete }: {
  c: Comment; mine: boolean; nameOf: (id: string) => string;
  onEdit: (id: string, text: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <EntryBox data-testid="item-Comment">
      <div className="meta">
        <strong>{nameOf(c.author)}</strong>
        <time>{ago(nsToMs(c.created_at))}{c.updated_at !== c.created_at ? ' · edited' : ''}</time>
        {mine && !editing && (
          <span className="own">
            <button type="button" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" onClick={() => void onDelete(c.id)}>Delete</button>
          </span>
        )}
      </div>
      {editing
        ? <Composer initial={c.text} placeholder="Edit comment" onSubmit={async (t) => { await onEdit(c.id, t); setEditing(false); }} testId="field-edit-comment" />
        : <p>{highlight(c.text)}</p>}
    </EntryBox>
  );
}

/** Shows `@mentions` highlighted. */
function highlight(text: string): React.ReactNode[] {
  return text.split(/(@[\p{L}\p{N}_]+(?: [\p{L}\p{N}_]+)?)/u).map((part, i) =>
    part.startsWith('@') ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>);
}

function Composer({ placeholder, initial = '', onSubmit, testId }: {
  placeholder: string; initial?: string; onSubmit: (text: string) => Promise<void>; testId: string;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ComposerBox>
      <textarea
        value={text}
        placeholder={placeholder}
        maxLength={2000}
        disabled={busy}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
      />
      {error && <p className="err">{error}</p>}
      <button type="button" disabled={!text.trim() || busy} onClick={() => void submit()} data-testid={`${testId}-submit`}>
        {busy ? 'Sending…' : 'Send'}
      </button>
    </ComposerBox>
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
  padding: 16px 18px; border-bottom: 1px solid ${C.line};
  .title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; font-size: 20px; color: ${C.mutedSoft};
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
const Tabs = styled.div`display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid ${C.line};`;
const Chip = styled.button`
  font-size: 11px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid ${C.line}; background: ${C.paper}; color: ${C.muted}; cursor: pointer;
  &:disabled { opacity: 0.45; cursor: default; }
  &[aria-pressed='true'] { border-color: ${C.green}; color: ${C.greenDeep}; background: ${C.paper2}; }
`;
const Body = styled.div`flex: 1; overflow-y: auto; padding: 12px 16px 24px;`;
const Empty = styled.p`margin: 16px 0; font-size: 13px; color: ${C.muted}; text-align: center;`;
const JumpLink = styled.button`
  margin: 10px 0 4px; padding: 0; background: none; border: none; cursor: pointer;
  font: 600 12px ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.greenDeep};
  &:hover { text-decoration: underline; }
`;
const ThreadBox = styled.div<{ $resolved: boolean }>`
  border: 1px solid ${C.line}; border-radius: 12px; padding: 8px 12px; margin-bottom: 10px;
  opacity: ${(p) => (p.$resolved ? 0.6 : 1)};
`;
const EntryBox = styled.div`
  padding: 6px 0; border-bottom: 1px solid ${C.line};
  &:last-of-type { border-bottom: none; }
  .meta { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; color: ${C.ink}; }
  .meta time { font-size: 11px; color: ${C.mutedSoft}; }
  .own { margin-left: auto; display: flex; gap: 8px; }
  .own button { font-size: 11px; color: ${C.mutedSoft}; background: none; border: none; cursor: pointer; padding: 0; }
  .own button:hover { color: ${C.ink}; }
  p { margin: 4px 0 0; font-size: 13px; line-height: 1.45; color: ${C.ink}; white-space: pre-wrap; word-break: break-word; }
  mark { background: rgba(164, 255, 17, 0.22); color: inherit; border-radius: 4px; padding: 0 2px; }
`;
const Actions = styled.div`
  display: flex; gap: 12px; padding-top: 6px;
  button { font-size: 12px; color: ${C.muted}; background: none; border: none; cursor: pointer; padding: 0; }
  button:hover { color: ${C.ink}; }
`;
const ComposerBox = styled.div`
  margin-top: 8px;
  textarea {
    width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical;
    padding: 9px 11px; font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 10px; outline: none;
    &:focus { border-color: ${C.green}; }
  }
  .err { margin: 6px 0 0; font-size: 12px; color: ${C.danger}; }
  button {
    margin-top: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; border-radius: 9px; cursor: pointer;
    color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
    &:disabled { opacity: 0.5; cursor: default; }
  }
`;
