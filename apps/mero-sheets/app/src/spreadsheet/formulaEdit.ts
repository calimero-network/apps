/**
 * Formula-editing model — the "point mode" logic that lets you build a formula
 * by clicking cells, exactly like Google Sheets / Excel.
 *
 * Pure functions over an explicit edit-state snapshot: no DOM, no React. The
 * component reads the input's caret/selection, calls these, and writes the
 * result back.
 */

/** Marks a reference the app auto-inserted, so the next click can replace it. */
export interface AutoRef {
  start: number;
  end: number;
}

export interface EditState {
  text: string;
  /** Caret / selection start (character offset into `text`). */
  selStart: number;
  /** Selection end; equals `selStart` when the caret is collapsed. */
  selEnd: number;
  /** The reference the previous point-click inserted, if any. */
  autoRef?: AutoRef;
}

export interface InsertResult {
  text: string;
  caret: number;
  autoRef: AutoRef;
}

/** True when the (trimmed) text is a formula — i.e. begins with `=`. */
export function isFormula(text: string): boolean {
  return text.trimStart().startsWith('=');
}

/**
 * Insert a cell/range `ref` into a formula being edited.
 *
 * - Normally the ref replaces the current selection (or is inserted at the
 *   collapsed caret) and the caret lands just after it.
 * - If the previous action auto-inserted a reference and the caret is still
 *   collapsed at the end of it (the user clicked another cell without typing),
 *   the previous reference is REPLACED — so click A1 then B2 yields `=B2`, and
 *   a drag that grows the range replaces the in-progress single ref cleanly.
 */
export function insertReference(state: EditState, ref: string): InsertResult {
  const { text, selStart, selEnd, autoRef } = state;

  const collapsed = selStart === selEnd;
  const shouldReplaceAuto =
    !!autoRef && collapsed && selStart === autoRef.end;

  const start = shouldReplaceAuto ? autoRef!.start : selStart;
  const end = shouldReplaceAuto ? autoRef!.end : selEnd;

  const next = text.slice(0, start) + ref + text.slice(end);
  const caret = start + ref.length;
  return {
    text: next,
    caret,
    autoRef: { start, end: caret },
  };
}
