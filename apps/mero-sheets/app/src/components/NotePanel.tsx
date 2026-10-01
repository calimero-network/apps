/**
 * NotePanel — a cell's note: rich text everyone can edit at once.
 *
 * The note is a text CRDT in the contract, so two people typing in the same
 * note both keep their words. Typing is sent as a delta a moment after you
 * pause; the toolbar formats the selection. The editable surface is rendered
 * by hand from the note's runs (not by React), so a re-render after a save or
 * a collaborator's edit keeps the caret where it was.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import {
  NOTE_MARKS, charOffset, formatOps, hasMark, rebase, spansText,
  type NoteMark, type NoteOp, type Span,
} from '../spreadsheet/notes';

/** How long typing pauses before it is sent. */
const SAVE_DELAY_MS = 400;

interface NotePanelProps {
  /** The cell the note belongs to (by id, so it follows the cell). */
  label: string;
  load: () => Promise<Span[]>;
  /** Changes whenever any note changes, so an open note picks up others' edits. */
  revision: unknown;
  onEdit: (ops: NoteOp[]) => Promise<void>;
  onClose: () => void;
}

const MARK_LABEL: Record<NoteMark, { text: string; title: string }> = {
  bold: { text: 'B', title: 'Bold' },
  italic: { text: 'I', title: 'Italic' },
  underline: { text: 'U', title: 'Underline' },
  strike: { text: 'S', title: 'Strikethrough' },
  highlight: { text: 'H', title: 'Highlight' },
};

export default function NotePanel({ label, load, revision, onEdit, onClose }: NotePanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const spansRef = useRef<Span[]>([]);
  // The text the note had when last rendered: what the next diff counts from.
  const baseRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const render = useCallback((spans: Span[]) => {
    const el = editorRef.current;
    if (!el) return;
    // Build the new content first: the refs and the DOM change together.
    const nodes = spans.map(spanNode);
    const sel = selectionOffsets(el);
    spansRef.current = spans;
    baseRef.current = spansText(spans);
    el.replaceChildren(...nodes);
    if (sel) setSelectionOffsets(el, sel[0], sel[1]);
  }, []);

  // Re-read the note and show it, unless the editor has unsent typing.
  const reload = useCallback(async () => {
    const spans = await load();
    const el = editorRef.current;
    if (el && readText(el) === baseRef.current && timerRef.current === null) render(spans);
  }, [load, render]);

  // Serialise writes: each waits for the one before, so deltas arrive in order.
  const run = useCallback((write: () => Promise<void>) => {
    const next = busyRef.current.then(async () => {
      setStatus('saving');
      try {
        await write();
        setStatus('saved');
        setError(null);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    busyRef.current = next;
    return next;
  }, []);

  // Send the typing since the last save. The note may have moved on (someone
  // else typed), so the edit is rebased onto what the node holds now.
  const flush = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    const el = editorRef.current;
    if (!el || readText(el) === baseRef.current) return busyRef.current;
    return run(async () => {
      const text = readText(el);
      if (text === baseRef.current) return;
      const server = spansText(await load());
      await onEdit(rebase(baseRef.current, server, text));
      // What this editor showed when it sent: the next save counts from here.
      baseRef.current = text;
      await reload();
    });
  }, [load, onEdit, reload, run]);

  useEffect(() => {
    let live = true;
    load()
      .then((spans) => { if (live) { render(spans); setStatus('saved'); } })
      .catch((err: unknown) => { if (live) { setStatus('error'); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { live = false; };
    // Load once per cell; later changes arrive through `revision`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Someone changed a note: pick it up once this editor's own typing is sent.
  const firstRevision = useRef(true);
  useEffect(() => {
    if (firstRevision.current) { firstRevision.current = false; return; }
    void flush().then(() => reload().catch(() => undefined));
  }, [revision, flush, reload]);

  // Send whatever is unsent when the panel closes.
  useEffect(() => () => { void flush(); }, [flush]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onInput = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void flush(); }, SAVE_DELAY_MS);
  };

  const toggle = async (mark: NoteMark) => {
    const el = editorRef.current;
    if (!el || !selectionOffsets(el)) return;
    // Format the note as the node holds it, so positions match its text.
    await flush();
    render(await load());
    const sel = selectionOffsets(el);
    if (!sel || sel[0] === sel[1]) return;
    const text = readText(el);
    const start = charOffset(text, sel[0]);
    const end = charOffset(text, sel[1]);
    const on = !hasMark(spansRef.current, start, end, mark);
    await run(async () => {
      await onEdit(formatOps(start, end, mark, on));
      render(await load());
    });
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label={`Note on ${label}`} onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">Note · {label}</span>
          <CloseBtn onClick={onClose} aria-label="Close note">×</CloseBtn>
        </Header>
        <Toolbar role="toolbar" aria-label="Format">
          {NOTE_MARKS.map((m) => (
            <FmtBtn
              key={m}
              type="button"
              $mark={m}
              title={`${MARK_LABEL[m].title} (select text first)`}
              aria-label={MARK_LABEL[m].title}
              data-testid={`action-note-${m}`}
              // Keep the editor's selection: a click would otherwise move focus.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void toggle(m)}
            >
              {MARK_LABEL[m].text}
            </FmtBtn>
          ))}
          <Status data-testid="note-status">
            {status === 'loading' ? 'Loading…' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : 'Saved'}
          </Status>
        </Toolbar>
        <Editor
          ref={editorRef}
          contentEditable={'plaintext-only' as unknown as boolean}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Note text"
          data-testid="field-note"
          data-placeholder="Add a note everyone can edit…"
          onInput={onInput}
          onBlur={() => void flush()}
        />
        {error && <Err>{error}</Err>}
        <Hint>Everyone in the workbook can edit this note at the same time.</Hint>
      </Panel>
    </Overlay>
  );
}

/** One run as DOM: its formatting as inline style. */
function spanNode(span: Span): HTMLElement {
  const el = document.createElement('span');
  el.textContent = span.text;
  const a = span.attributes;
  if (a.bold) el.style.fontWeight = '700';
  if (a.italic) el.style.fontStyle = 'italic';
  const deco = [a.underline && 'underline', a.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) el.style.textDecoration = deco;
  if (a.highlight) el.style.background = 'rgba(164, 255, 17, 0.3)';
  return el;
}

/** The editor's text: text nodes as they are, a `<br>` as a line break. */
function readText(root: Node): string {
  let out = '';
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n.nodeName === 'BR') out += '\n';
    else out += readText(n);
  });
  return out;
}

/** The UTF-16 offset of a DOM position within `root`'s text, counted as `readText` counts. */
function offsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return readText(range.cloneContents()).length;
}

function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return [offsetOf(root, r.startContainer, r.startOffset), offsetOf(root, r.endContainer, r.endOffset)];
}

function setSelectionOffsets(root: HTMLElement, start: number, end: number) {
  const at = (target: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let last: Node | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.textContent?.length ?? 0;
      if (seen + len >= target) return [n, target - seen];
      seen += len;
      last = n;
    }
    return last ? [last, last.textContent?.length ?? 0] : [root, 0];
  };
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const [sn, so] = at(start);
  const [en, eo] = at(end);
  range.setStart(sn, so);
  range.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(range);
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
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 4px; padding: 8px 16px; border-bottom: 1px solid ${C.line};
`;
const FmtBtn = styled.button<{ $mark: NoteMark }>`
  width: 28px; height: 28px; border-radius: 7px; cursor: pointer;
  border: 1px solid ${C.line}; background: ${C.paper}; color: ${C.ink}; font-size: 13px;
  font-weight: ${(p) => (p.$mark === 'bold' ? 700 : 500)};
  font-style: ${(p) => (p.$mark === 'italic' ? 'italic' : 'normal')};
  text-decoration: ${(p) => (p.$mark === 'underline' ? 'underline' : p.$mark === 'strike' ? 'line-through' : 'none')};
  ${(p) => p.$mark === 'highlight' && 'background: rgba(164, 255, 17, 0.3);'}
  &:hover { border-color: ${C.green}; }
`;
const Status = styled.span`margin-left: auto; font-size: 11.5px; color: ${C.mutedSoft};`;
const Editor = styled.div`
  flex: 1; overflow-y: auto; padding: 14px 18px; outline: none;
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: ${C.ink}; white-space: pre-wrap; word-break: break-word;
  &:empty::before { content: attr(data-placeholder); color: ${C.mutedSoft}; }
`;
const Err = styled.p`margin: 0; padding: 6px 18px; font-size: 12px; color: ${C.danger};`;
const Hint = styled.p`margin: 0; padding: 10px 18px 16px; font-size: 11.5px; color: ${C.mutedSoft}; border-top: 1px solid ${C.line};`;
