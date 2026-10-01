// Where the formatting toolbar floats: above the selection, but inside the top edge of an image so it never covers the line above.

import type { DriveEditor } from './schema';

const GAP = 10; // toolbar to selection, as BlockNote's own default
const INSET = 8; // toolbar below an image's top edge

export function toolbarOffset(editor: Pick<DriveEditor, 'getTextCursorPosition'>, toolbarHeight: number): number {
  return editor.getTextCursorPosition().block.type === 'image' ? -(toolbarHeight + INSET) : GAP;
}
