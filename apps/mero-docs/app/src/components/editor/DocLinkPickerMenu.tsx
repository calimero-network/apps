import * as React from 'react';
import { CircleUserRound, FileText, Hash, TextAlignStart } from 'lucide-react';

import { Highlight } from '@/components/common/Highlight';
import { cn } from '@/lib/utils';
import {
  byGroup,
  MENU_EMPTY,
  MENU_ICON,
  MENU_ID,
  MENU_LABEL,
  MENU_PANEL,
  MENU_ROW,
  menuRowId,
  useActiveRowInView,
} from './caretMenu';

const KIND_ICON = {
  doc: FileText,
  text: TextAlignStart,
  section: Hash,
  person: CircleUserRound,
};
const MODE_COPY = {
  doc: { label: 'Mention or link', empty: 'No people or documents match' },
  section: { label: 'Link to a section', empty: 'No sections match' },
};

export interface DocLinkPickerItem {
  id: string;
  kind: 'doc' | 'text' | 'section' | 'person';
  group?: string; // rows of the @ menu sit under People or Documents
  title: string;
  titleRanges?: [number, number][];
  quote?: string;
  quoteRanges?: [number, number][];
  /** The right-hand context: the folder path, for a section its document, for a person a folder access note. */
  folderLabel: string;
}

interface DocLinkPickerMenuProps {
  mode?: keyof typeof MODE_COPY;
  items: DocLinkPickerItem[];
  activeIndex: number;
  onPick: (item: DocLinkPickerItem) => void;
}

// The @ menu. The editor's suggestion controller owns the keyboard, so the active row is controlled.
export function DocLinkPickerMenu({
  mode = 'doc',
  items,
  activeIndex,
  onPick,
}: DocLinkPickerMenuProps) {
  const labelId = React.useId();
  const ref = useActiveRowInView(activeIndex);
  const copy = MODE_COPY[mode];
  const grouped = items.some((item) => item.group);
  const renderRow = ({
    item,
    index: i,
  }: {
    item: DocLinkPickerItem;
    index: number;
  }) => {
    const Icon = KIND_ICON[item.kind];
    return (
      <div
        key={item.id}
        id={menuRowId(i)}
        role="option"
        aria-selected={i === activeIndex}
        className={MENU_ROW}
        // The caret stays in the document while the menu is open.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(item)}
      >
        <Icon aria-hidden className={MENU_ICON} />
        <span className="min-w-0 flex-1 truncate">
          <Highlight text={item.title} ranges={item.titleRanges ?? []} />
          {item.quote !== undefined && (
            <>
              {' · “'}
              <Highlight text={item.quote} ranges={item.quoteRanges ?? []} />
              {'”'}
            </>
          )}
        </span>
        <span className="max-w-[40%] shrink-0 truncate text-[11.5px] text-muted-foreground">
          {item.folderLabel}
        </span>
      </div>
    );
  };
  return (
    <div
      ref={ref}
      className={cn(MENU_PANEL, 'w-[360px] max-w-[min(100%,calc(100vw-16px))]')}
    >
      <div id={labelId} className={grouped ? 'sr-only' : MENU_LABEL}>
        {copy.label}
      </div>
      {items.length === 0 ? (
        <div className={cn(MENU_EMPTY, 'pt-1')}>{copy.empty}</div>
      ) : (
        <div
          role="listbox"
          id={MENU_ID}
          aria-labelledby={labelId}
          className="px-1 pb-1"
        >
          {byGroup(items).map(({ name, rows }) =>
            name ? (
              <div key={name} role="group" aria-label={name}>
                <div aria-hidden className={cn(MENU_LABEL, 'px-2')}>
                  {name}
                </div>
                {rows.map(renderRow)}
              </div>
            ) : (
              <React.Fragment key="">{rows.map(renderRow)}</React.Fragment>
            ),
          )}
        </div>
      )}
    </div>
  );
}
