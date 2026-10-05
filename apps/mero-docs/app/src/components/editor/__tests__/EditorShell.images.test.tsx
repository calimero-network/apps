// Who may add images: the shell wires the / menu, paste and drop only when
// handed an uploader, and swallows a file drop either way.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EditorShell } from '../EditorShell';
import type { DriveEditor } from '../blocknote/schema';
import { useAddImages } from '@/hooks/useAddImages';

const h = vi.hoisted(() => ({
  pickImage: undefined as (() => void) | undefined,
  editor: null as DriveEditor | null,
}));
const uploadBlob = vi.fn();
const mero = { admin: { uploadBlob } };

vi.mock('@calimero-network/mero-react', () => ({ useMero: () => ({ mero, admin: mero.admin }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="bn-view">{children}</div>
  ),
}));
vi.mock('@blocknote/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blocknote/react')>()),
  SideMenuController: () => null,
  LinkToolbarController: () => null,
  FormattingToolbarController: () => null,
}));
vi.mock('../blocknote/DocLinkPicker', () => ({ DocLinkPicker: () => null }));
vi.mock('../blocknote/EditorSlashMenu', () => ({
  EditorSlashMenu: ({ pickImage }: { pickImage?: () => void }) => {
    h.pickImage = pickImage;
    return null;
  },
}));
vi.mock('../DocLinkHover', () => ({
  DocLinkHover: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DocAwareLinkToolbar: () => null,
}));
vi.mock('../blocknote/DocLinkNav', () => ({ DocLinkNav: () => null }));
vi.mock('../EditorHeader', () => ({ EditorHeader: () => null }));
vi.mock('../EditorStatusBar', () => ({ EditorStatusBar: () => null }));
vi.mock('@/components/theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

const ID = '1a'.repeat(32);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const png = () => new File([PNG], 'shot.png', { type: 'image/png' });

/** The shell as DocumentEditor drives it: the uploader only for someone who may add images. */
function Shell({ canAddImages }: { canAddImages: boolean }) {
  const [editor, setEditor] = React.useState<DriveEditor | null>(null);
  const addImages = useAddImages(editor, 'ctx-1');
  h.editor = editor;
  return (
    <EditorShell
      documentName="Plan"
      imageContextId="ctx-1"
      onAddImages={canAddImages ? addImages : undefined}
      onEditorReady={setEditor}
    />
  );
}

async function mountShell(canAddImages: boolean): Promise<DriveEditor> {
  render(
    <MemoryRouter>
      <Shell canAddImages={canAddImages} />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(h.editor).not.toBeNull());
  const ready = h.editor as DriveEditor;
  ready.mount(document.body.appendChild(document.createElement('div')));
  ready.setTextCursorPosition(ready.document[0].id, 'end');
  return ready;
}

function pasteFile(editor: DriveEditor, file: File) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['Files'], files: [file], getData: () => '' },
  });
  editor.prosemirrorView!.dom.dispatchEvent(event);
  return event;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const kinds = (editor: DriveEditor) => editor.document.map((b) => b.type);

afterEach(() => {
  uploadBlob.mockReset();
  h.pickImage = undefined;
  h.editor = null;
});

describe('EditorShell images', () => {
  it('lets an editor pick, paste and drop images', async () => {
    uploadBlob.mockResolvedValue({ blobId: ID, size: PNG.length });
    const editor = await mountShell(true);
    expect(h.pickImage).toBeTypeOf('function');

    pasteFile(editor, png());
    await settle();
    expect(kinds(editor)).toContain('image');

    const drop = fireEvent.drop(screen.getByTestId('bn-view'), {
      dataTransfer: { types: ['Files'], files: [png()] },
    });
    await settle();
    expect(drop).toBe(false);
    expect(uploadBlob).toHaveBeenCalledTimes(2);
    editor.unmount();
  });

  it('offers nothing to someone who may not add images, and uploads nothing', async () => {
    const editor = await mountShell(false);
    expect(h.pickImage).toBeUndefined();

    pasteFile(editor, png());
    const drop = fireEvent.drop(screen.getByTestId('bn-view'), {
      dataTransfer: { types: ['Files'], files: [png()] },
    });
    await settle();
    expect(drop).toBe(false); // not handed to the browser, which would open the file
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(kinds(editor)).not.toContain('image');
    editor.unmount();
  });
});
