// Adding picked, pasted or dropped files, on a live editor and a fake node.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCreateBlockNote } from '@blocknote/react';
import { HTTPError } from '@calimero-network/mero-js';
import { toast } from 'sonner';
import { schema, type DriveEditor } from '@/components/editor/blocknote/schema';
import { MAX_IMAGE_BYTES } from '@/lib/images';
import { IMAGE_SIZE_REFUSED, IMAGE_TYPE_REFUSED, useAddImages } from '../useAddImages';

const uploadBlob = vi.fn();
const mero = { admin: { uploadBlob } };
vi.mock('@calimero-network/mero-react', () => ({ useMero: () => ({ mero, admin: mero.admin }) }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

const CTX = 'ctx-1';
const ID = '0f'.repeat(32);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const png = (name = 'cat.png', size = PNG.length) => {
  const data = new Uint8Array(size);
  data.set(PNG);
  return new File([data], name, { type: 'image/png' });
};
const svg = () =>
  new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.png', { type: 'image/png' });

function setup(blocks: Parameters<DriveEditor['replaceBlocks']>[1]) {
  const editor = renderHook(() => useCreateBlockNote({ schema })).result
    .current as DriveEditor;
  editor.replaceBlocks(editor.document, blocks);
  const add = renderHook(() => useAddImages(editor, CTX)).result.current;
  return { editor, add };
}

const images = (editor: DriveEditor) =>
  editor.document.filter((b) => b.type === 'image').map((b) => b.props);

beforeEach(() => {
  uploadBlob.mockReset().mockResolvedValue({ blobId: ID, size: 12 });
  vi.mocked(toast.error).mockClear();
});

describe('useAddImages', () => {
  it("uploads to the folder's context and puts the image in the empty line it was asked from", async () => {
    const { editor, add } = setup([{ type: 'paragraph' }]);
    await act(() => add([png()], editor.document[0].id));
    expect(uploadBlob).toHaveBeenCalledWith({ data: expect.any(File), contextId: CTX });
    expect(editor.document[0]).toMatchObject({
      type: 'image',
      props: { url: `blob:${ID}`, name: 'cat.png' },
    });
  });

  it('puts images after a line that has text, in the order given', async () => {
    const { editor, add } = setup([{ type: 'paragraph', content: 'Intro' }]);
    uploadBlob
      .mockResolvedValueOnce({ blobId: ID, size: 12 })
      .mockResolvedValueOnce({ blobId: 'e1'.repeat(32), size: 12 });
    await act(() => add([png('a.png'), png('b.png')], editor.document[0].id));
    expect(editor.document.map((b) => b.type).slice(0, 3)).toEqual([
      'paragraph',
      'image',
      'image',
    ]);
    expect(images(editor).map((p) => p.name)).toEqual(['a.png', 'b.png']);
  });

  it('refuses a file that is not a PNG, JPEG, GIF or WebP whatever it is called', async () => {
    const { editor, add } = setup([{ type: 'paragraph' }]);
    await act(() => add([svg()], editor.document[0].id));
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(images(editor)).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't add logo.png", {
      description: IMAGE_TYPE_REFUSED,
    });
  });

  it('refuses an image over the size cap', async () => {
    const { editor, add } = setup([{ type: 'paragraph' }]);
    await act(() => add([png('huge.png', MAX_IMAGE_BYTES + 1)], editor.document[0].id));
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn't add huge.png", {
      description: IMAGE_SIZE_REFUSED,
    });
    expect(IMAGE_SIZE_REFUSED).toBe('Images can be up to 10 MB.');
  });

  it('says so when this session may not upload, and adds no block', async () => {
    const { editor, add } = setup([{ type: 'paragraph' }]);
    uploadBlob.mockRejectedValue(
      new HTTPError(403, 'Forbidden', '/admin-api/blobs', new Headers(), ''),
    );
    await act(() => add([png()], editor.document[0].id));
    expect(images(editor)).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't add cat.png",
      expect.objectContaining({ description: "This session can't upload images." }),
    );
  });

  it('adds the image at the end when the line it was asked from is gone', async () => {
    const { editor, add } = setup([{ type: 'paragraph', content: 'Only' }]);
    await act(() => add([png()], 'gone'));
    expect(editor.document.map((b) => b.type)).toContain('image');
  });

  it('leaves the cursor in a line after the last image so typing carries on', async () => {
    const { editor, add } = setup([{ type: 'paragraph' }]);
    await act(() => add([png('a.png'), png('b.png')], editor.document[0].id));
    const [last] = editor.document.filter((b) => b.type === 'image').reverse();
    const after = editor.getNextBlock(last)!;
    expect(after.type).toBe('paragraph');
    expect(editor.getTextCursorPosition().block.id).toBe(after.id);
  });
});
