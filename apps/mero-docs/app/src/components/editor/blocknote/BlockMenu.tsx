// The block drag-handle menu: Copy link to section first, then BlockNote's own items.

import { createContext, useContext } from 'react';
import { SideMenuExtension } from '@blocknote/core/extensions';
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  useComponentsContext,
  useDictionary,
  useExtensionState,
  type SideMenuProps,
} from '@blocknote/react';
import { inlineToText } from './content';

const SECTION_CHARS = 40; // a block without a heading is named by its opening words

export interface SectionLinks {
  copy: (blockId: string, section: string) => void;
  isConfirmed: (blockId: string) => boolean;
}

export const SectionLinksContext = createContext<SectionLinks | null>(null);

/** What a link to this block calls it: a heading's text, else its opening words. */
export function sectionName(block: {
  type: string;
  content?: unknown;
}): string {
  const text = inlineToText(block.content).trim();
  const chars = Array.from(text);
  if (chars.length === 0) return 'this section';
  if (block.type === 'heading' || chars.length <= SECTION_CHARS) return text;
  return `${chars.slice(0, SECTION_CHARS).join('').trimEnd()}…`;
}

function CopySectionLinkItem() {
  const Components = useComponentsContext()!;
  const links = useContext(SectionLinksContext);
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });
  if (!links || !block) return null;
  const confirmed = links.isConfirmed(block.id);
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={
        confirmed ? () => links.copy(block.id, sectionName(block)) : undefined
      }
      // BlockNote's item type omits `disabled`; the Mantine item it renders takes it.
      {...{ disabled: !confirmed }}
    >
      Copy link to section
      {!confirmed && (
        <span className="ml-2 text-muted-foreground">Saving…</span>
      )}
    </Components.Generic.Menu.Item>
  );
}

function BlockDragMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <CopySectionLinkItem />
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
    </DragHandleMenu>
  );
}

export function BlockSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={BlockDragMenu} />;
}
