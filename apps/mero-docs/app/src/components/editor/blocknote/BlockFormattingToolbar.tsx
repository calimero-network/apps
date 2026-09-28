// BlockNote's formatting toolbar, offering only the block types the / menu does.

import { useMemo } from 'react';
import { FormattingToolbar, useBlockNoteEditor } from '@blocknote/react';
import { blockTypeSelectItems } from './slashMenu';

export function BlockFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const items = useMemo(
    () => blockTypeSelectItems(editor.dictionary),
    [editor],
  );
  return <FormattingToolbar blockTypeSelectItems={items} />;
}
