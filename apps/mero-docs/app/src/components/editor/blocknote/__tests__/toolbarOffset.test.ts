import { describe, expect, it } from 'vitest';
import { toolbarOffset } from '../toolbarOffset';

const editorAt = (type: string) => ({ getTextCursorPosition: () => ({ block: { type } }) }) as never;

describe('toolbarOffset', () => {
  it('keeps the usual gap above text', () => {
    expect(toolbarOffset(editorAt('paragraph'), 40)).toBe(10);
  });

  it('pulls the toolbar inside the top edge of an image', () => {
    expect(toolbarOffset(editorAt('image'), 40)).toBe(-48);
  });
});
