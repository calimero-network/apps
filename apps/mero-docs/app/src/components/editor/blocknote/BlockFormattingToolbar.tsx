// BlockNote's formatting toolbar, offering only the block types the / menu does.
// Images drop replace, which offers an embed by address, and download and preview.

import { useMemo } from 'react';
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
} from '@blocknote/react';
import { blockTypeSelectItems } from './slashMenu';

const HIDDEN = new Set(['replaceFileButton', 'fileDownloadButton', 'filePreviewButton']);

export function BlockFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const items = useMemo(
    () =>
      getFormattingToolbarItems(blockTypeSelectItems(editor.dictionary)).filter(
        (item) => !HIDDEN.has(String(item.key)),
      ),
    [editor],
  );
  return <FormattingToolbar>{items}</FormattingToolbar>;
}
