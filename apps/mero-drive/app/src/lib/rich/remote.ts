// A remote change arrives as a re-read of the whole block, so the editor is
// told to replace its inline content only when the render actually differs -
// an unconditional replacement would move every caret in the block.

import { spansToInline, type AttrSpan, type InlineContent } from './delta';
import { scalarToUtf16 } from './offsets';

/** The inline content to put in the block, or null when it renders the same. */
export function remoteInline(
  current: AttrSpan[],
  spans: AttrSpan[],
): InlineContent[] | null {
  const before = spansToInline(current);
  const after = spansToInline(spans);
  return JSON.stringify(before) === JSON.stringify(after) ? null : after;
}

/** Resolved anchor positions as UTF-16 indexes into `text`, clamped to it. */
export function mapScalarSelection(
  text: string,
  resolved: ReadonlyArray<number | null>,
): (number | null)[] {
  return resolved.map((position) =>
    position === null ? null : scalarToUtf16(text, position),
  );
}
