// What a paste may bring in, through the editor's own paste path on a mounted view.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createExtension } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { schema, type DriveEditor } from '../schema';
import { pastedBlocks } from '../pastedBlocks';

const BLOB_URL = `blob:${'ab'.repeat(32)}`;
const guarded = createExtension({ key: 'pastedBlocks', prosemirrorPlugins: [pastedBlocks()] });

// jsdom has no ClipboardEvent; the view only needs one to hand to its handlers.
beforeAll(() => {
  globalThis.ClipboardEvent ??= class extends Event {
    clipboardData = null;
  } as unknown as typeof ClipboardEvent;
});

function editor(): DriveEditor {
  const { result } = renderHook(() =>
    useCreateBlockNote({ schema, extensions: [guarded] }),
  );
  const live = result.current as DriveEditor;
  live.mount(document.body.appendChild(document.createElement('div')));
  return live;
}

/** One block in BlockNote's own clipboard HTML, as another BlockNote editor copies it. */
const block = (content: string) =>
  `<div class="bn-block-outer" data-node-type="blockOuter" data-id="${content.length}">` +
  `<div class="bn-block" data-node-type="blockContainer" data-id="${content.length}">${content}</div></div>`;
const copied = (...blocks: string[]) =>
  `<div class="bn-block-group" data-node-type="blockGroup">${blocks.map(block).join('')}</div>`;
const paragraph = (text: string) =>
  `<div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">${text}</p></div>`;
const image = (url: string, name: string) =>
  `<div class="bn-block-content" data-content-type="image" data-url="${url}" data-name="${name}"></div>`;

const kinds = (live: DriveEditor) => live.document.map((b) => b.type);

describe('pasting blocks', () => {
  it('drops an image whose url is an address, keeping the text around it', () => {
    const html = copied(
      paragraph('before'),
      image('https://example.com/pixel.png', 'pixel'),
      paragraph('after'),
    );
    const target = editor();
    target.pasteHTML(html, true);
    expect(kinds(target)).not.toContain('image');
    expect(JSON.stringify(target.document)).toContain('before');
    expect(JSON.stringify(target.document)).toContain('after');
  });

  it('keeps an image that names a blob', () => {
    const target = editor();
    target.pasteHTML(copied(image(BLOB_URL, 'cat')), true);
    const kept = target.document.find((b) => b.type === 'image');
    expect(kept?.props).toMatchObject({ url: BLOB_URL, name: 'cat' });
  });

  it("never turns a web page's <img> into an image block", () => {
    const target = editor();
    target.pasteHTML('<p>see</p><img src="https://example.com/pixel.png" alt="pixel">');
    expect(kinds(target)).not.toContain('image');
  });

  it('drops a pasted placeholder for a newer block kind', () => {
    const html = copied(
      '<div class="bn-block-content" data-content-type="unsupported" data-block="{}"></div>',
    );
    const target = editor();
    target.pasteHTML(html, true);
    expect(kinds(target)).not.toContain('unsupported');
  });
});
