import * as React from 'react';
import { FileText, TextAlignStart } from 'lucide-react';

import { Highlight, type HighlightRange } from '@/components/common/Highlight';

export interface DocLinkPickerItem {
  id: string;
  kind: 'doc' | 'text';
  title: string;
  titleRanges?: HighlightRange[];
  quote?: string;
  quoteRanges?: HighlightRange[];
  folderLabel: string;
}

interface DocLinkPickerMenuProps {
  items: DocLinkPickerItem[];
  activeIndex: number;
  onPick: (item: DocLinkPickerItem) => void;
}

// The [[ menu. The editor's suggestion controller owns the keyboard, so the active row is controlled.
export function DocLinkPickerMenu({
  items,
  activeIndex,
  onPick,
}: DocLinkPickerMenuProps) {
  const labelId = React.useId();
  return (
    <div className="w-[360px] max-w-[min(100%,calc(100vw-16px))] overflow-hidden rounded-[10px] border bg-popover text-popover-foreground shadow-md">
      <div
        id={labelId}
        className="px-3 pb-1 pt-2.5 text-xs font-medium text-muted-foreground"
      >
        Link to a document
      </div>
      {items.length === 0 ? (
        <div className="px-3 pb-2.5 pt-1 text-[13px] text-muted-foreground">
          No documents match
        </div>
      ) : (
        <div role="listbox" aria-labelledby={labelId} className="px-1 pb-1">
          {items.map((item, i) => {
            const Icon = item.kind === 'doc' ? FileText : TextAlignStart;
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={i === activeIndex}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-secondary-foreground aria-selected:bg-accent aria-selected:text-foreground"
                // The caret stays in the document while the menu is open.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
              >
                <Icon
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">
                  <Highlight
                    text={item.title}
                    ranges={item.titleRanges ?? []}
                  />
                  {item.quote !== undefined && (
                    <>
                      {' · “'}
                      <Highlight
                        text={item.quote}
                        ranges={item.quoteRanges ?? []}
                      />
                      {'”'}
                    </>
                  )}
                </span>
                <span className="max-w-[40%] shrink-0 truncate text-[11.5px] text-muted-foreground">
                  {item.folderLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
