import { CircleUserRound, FileText, Hash, TextAlignStart } from 'lucide-react';
import type { SuggestionMenuProps } from '@blocknote/react';

import { Highlight } from '@/components/common/Highlight';
import { CaretMenu } from './CaretMenu';

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

// The @ menu.
export function DocLinkPickerMenu<Item extends DocLinkPickerItem>({
  mode = 'doc',
  ...props
}: SuggestionMenuProps<Item> & { mode?: keyof typeof MODE_COPY }) {
  return (
    <CaretMenu
      {...props}
      label={MODE_COPY[mode].label}
      showLabel
      empty={MODE_COPY[mode].empty}
      className="w-[360px] max-w-[min(100%,calc(100vw-16px))]"
      row={(item) => ({
        key: item.id,
        icon: KIND_ICON[item.kind],
        title: (
          <>
            <Highlight text={item.title} ranges={item.titleRanges ?? []} />
            {item.quote !== undefined && (
              <>
                {' · “'}
                <Highlight text={item.quote} ranges={item.quoteRanges ?? []} />
                {'”'}
              </>
            )}
          </>
        ),
        trailing: (
          <span className="max-w-[40%] shrink-0 truncate text-[11.5px] text-muted-foreground">
            {item.folderLabel}
          </span>
        ),
      })}
    />
  );
}
