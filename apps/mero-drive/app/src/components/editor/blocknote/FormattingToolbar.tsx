// Custom BlockNote formatting toolbar: the default selection toolbar
// (bold / italic / link / block-type / colors …) plus a font-size
// dropdown that applies our custom inline `fontSize` style to the
// selected range — the PR1 feature, re-implemented on BlockNote.
//
// BlockNote's formatting toolbar is a floating toolbar that appears on
// text selection, so the font-size control naturally targets the
// highlighted text (matching the old behaviour).

import React from 'react';
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useActiveStyles,
  useBlockNoteEditor,
  useComponentsContext,
} from '@blocknote/react';
import { schema, FONT_SIZE_OPTIONS } from './schema';

function FontSizeSelect() {
  // Pass the schema so the editor is typed with our custom `fontSize`
  // style (otherwise addStyles/removeStyles wouldn't accept it).
  const editor = useBlockNoteEditor(schema);
  // Non-null assertion is safe: FontSizeSelect is only ever rendered as a
  // child of DriveFormattingToolbar → FormattingToolbarController →
  // <BlockNoteView>, which always provides the components context. It is
  // never mounted standalone.
  const Components = useComponentsContext()!;
  // Re-renders whenever the active styles change so the dropdown
  // reflects the size at the current selection.
  const activeStyles = useActiveStyles(editor);
  const current = activeStyles.fontSize ?? null;

  return (
    <Components.FormattingToolbar.Select
      items={FONT_SIZE_OPTIONS.map((opt) => ({
        text: opt.label,
        icon: undefined,
        isSelected: opt.value === null ? current == null : opt.value === current,
        onClick: () => {
          if (opt.value === null) {
            if (activeStyles.fontSize != null) {
              editor.removeStyles({ fontSize: activeStyles.fontSize });
            }
          } else {
            editor.addStyles({ fontSize: opt.value });
          }
        },
      }))}
    />
  );
}

export function DriveFormattingToolbar() {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {getFormattingToolbarItems()}
          <FontSizeSelect key="fontSize" />
        </FormattingToolbar>
      )}
    />
  );
}
