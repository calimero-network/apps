// A peer's change to one block's text, applied as ProseMirror steps on the block
// that is already there: the editor maps the caret itself and never rebuilds the
// DOM a keystroke it has not read yet still lives in.

import { TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { BOOLEAN_KEYS, type AttrDelta } from '@/lib/rich/attributes';
import { posAt } from '@/lib/rich/cursors';
import type { Change } from '@/lib/rich/delta';
import { blockGeometry, type DocNode } from './presence/geometry';

interface MarkType {
  create(attrs?: Record<string, unknown>): unknown;
}

interface SchemaLike {
  marks: Record<string, MarkType | undefined>;
  text(text: string, marks?: readonly unknown[]): unknown;
}

/** The slice of the BlockNote editor a text change needs. */
export interface RemoteTextEditor {
  readonly pmSchema: unknown;
  readonly prosemirrorView?: EditorView;
  transact<T>(callback: (tr: Transaction) => T): T;
}

/** Reads a keystroke or selection change the view has not processed yet, so a
 *  peer's dispatch never writes the stale selection back over it. */
export function flushPendingInput(view: EditorView | undefined): void {
  try {
    (view as unknown as { domObserver?: { flush(): void } } | undefined)?.domObserver?.flush();
  } catch {
    // An unmounted view throws on access, and it has no pending input to read.
  }
}

/** The browser's own selection in document positions, when it is in this view.
 *  The view's record can lag the browser, and a dispatch writes that record back. */
export function domSelection(view: EditorView | undefined): { anchor: number; head: number } | null {
  try {
    const selection = view?.root && 'getSelection' in view.root ? (view.root as Document).getSelection() : null;
    if (!view || !selection?.anchorNode || !selection.focusNode) return null;
    if (!view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return null;
    return {
      anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset),
      head: view.posAtDOM(selection.focusNode, selection.focusOffset),
    };
  } catch {
    return null;
  }
}

/** Records the browser's selection when the view's record lags it, so a key
 *  that acts on the selection (Enter, a format shortcut) acts where the user is. */
export function syncSelectionFromDom(view: EditorView): void {
  const actual = domSelection(view);
  const { selection } = view.state;
  if (!actual || (actual.anchor === selection.anchor && actual.head === selection.head)) return;
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, actual.anchor, actual.head)));
  } catch {
    // A position outside the document is not a selection worth recording.
  }
}

/** Puts the browser's selection, carried through the steps `tr` holds, on `tr`. */
export function keepSelection(tr: Transaction, before: { anchor: number; head: number } | null): void {
  if (!before) return;
  try {
    // Bias -1: a peer's insert at the caret goes after it, so the user's next
    // keystroke chains onto their own text and each person's run stays whole.
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(before.anchor, -1), tr.mapping.map(before.head, -1)));
  } catch {
    // A position the steps removed has no selection to keep; leave the mapped one.
  }
}

const schemaOf = (editor: RemoteTextEditor): SchemaLike => editor.pmSchema as SchemaLike;

// BlockNote holds a link as an inline node, not a mark, so a link change is left
// to the caller's whole-block path.
const touchesLink = (op: Change): boolean =>
  'insert' in op || 'retain' in op ? Boolean(op.attributes && 'link' in op.attributes) : false;

function markOf(editor: RemoteTextEditor, key: string, value: string): unknown {
  const type = schemaOf(editor).marks[key];
  if (!type) return null;
  return BOOLEAN_KEYS.has(key) ? type.create() : type.create({ stringValue: value });
}

function marksOf(editor: RemoteTextEditor, attrs: AttrDelta | undefined): unknown[] {
  const marks: unknown[] = [];
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value !== null) marks.push(markOf(editor, key, value));
  }
  return marks;
}

const knows = (editor: RemoteTextEditor, op: Change): boolean =>
  'delete' in op || Object.keys(op.attributes ?? {}).every((key) => schemaOf(editor).marks[key]);

/** Applies `ops` to block `blockId`; false when they need the whole-block path. */
export function applyRemoteText(editor: RemoteTextEditor, blockId: string, ops: Change[]): boolean {
  if (ops.some(touchesLink) || !ops.every((op) => knows(editor, op))) return false;
  flushPendingInput(editor.prosemirrorView);
  const before = domSelection(editor.prosemirrorView);
  return editor.transact((tr) => {
    // A peer's edit is not the user's to undo; history rebases theirs past it.
    tr.setMeta('addToHistory', false);
    // Positions come from the transaction's document, so each op sees the last.
    const pos = (scalar: number): number | null => {
      const geometry = blockGeometry(tr.doc as unknown as DocNode, blockId);
      return geometry ? posAt(geometry, scalar) : null;
    };
    let at = 0;
    for (const op of ops) {
      const from = pos(at);
      if (from === null) return false;
      if ('insert' in op) {
        const marks = marksOf(editor, op.attributes);
        tr.insert(from, schemaOf(editor).text(op.insert, marks) as Parameters<Transaction['insert']>[1]);
        at += Array.from(op.insert).length;
      } else if ('delete' in op) {
        const to = pos(at + op.delete);
        if (to === null) return false;
        tr.delete(from, to);
      } else {
        const to = pos(at + op.retain);
        if (to === null) return false;
        for (const [key, value] of Object.entries(op.attributes ?? {})) {
          const type = schemaOf(editor).marks[key] as unknown as Parameters<Transaction['removeMark']>[2];
          if (value === null) tr.removeMark(from, to, type);
          else tr.addMark(from, to, markOf(editor, key, value) as Parameters<Transaction['addMark']>[2]);
        }
        at += op.retain;
      }
    }
    keepSelection(tr, before);
    return true;
  });
}
