// What the / menu offers: BlockNote's own blocks in sentence case, then links
// that open the @ picker for a document or for a section.

import {
  FileText,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  Pilcrow,
  Smile,
  type LucideIcon,
} from 'lucide-react';
import {
  getDefaultSlashMenuItems,
  SuggestionMenu,
} from '@blocknote/core/extensions';
import type { SlashMenuItem } from '@/components/editor/SlashMenu';
import { DOC_LINK_TRIGGER } from './docLinks';
import type { DriveEditor } from './schema';

export const SLASH_TRIGGER = '/';
export const SECTION_LINK_TRIGGER = '#'; // the section picker's menu; typing # never opens it
const LINKS_GROUP = 'Links';
const PLATFORM_MOD = /^(⌘|Ctrl)-/; // how BlockNote's badge spells Mod on this platform

export type SlashItem = SlashMenuItem & {
  aliases: string[];
  onItemClick: () => void;
};

const ICONS: Record<string, LucideIcon> = {
  heading: Heading1,
  heading_2: Heading2,
  heading_3: Heading3,
  heading_4: Heading4,
  heading_5: Heading5,
  heading_6: Heading6,
  toggle_heading: Heading1,
  toggle_heading_2: Heading2,
  toggle_heading_3: Heading3,
  bullet_list: List,
  paragraph: Pilcrow,
  emoji: Smile,
};

/** Never true: the section picker opens from the / menu only. */
export const typedNever = () => false;

const sentenceCase = (text: string) =>
  text.charAt(0) + text.slice(1).toLowerCase();

export function slashMenuItems(editor: DriveEditor): SlashItem[] {
  const openPicker = (trigger: string) => () =>
    editor.getExtension(SuggestionMenu)?.openSuggestionMenu(trigger);
  return [
    ...getDefaultSlashMenuItems(editor).map((item) => ({
      key: item.key,
      title: sentenceCase(item.title),
      group: sentenceCase(item.group ?? ''),
      aliases: item.aliases ?? [],
      shortcut: item.badge?.replace(PLATFORM_MOD, 'Mod-'),
      icon: ICONS[item.key] ?? Pilcrow,
      onItemClick: item.onItemClick,
    })),
    {
      key: 'doc_link',
      title: 'Link to a document',
      group: LINKS_GROUP,
      aliases: ['link', 'doc', 'document', 'page', 'mention'],
      icon: FileText,
      onItemClick: openPicker(DOC_LINK_TRIGGER),
    },
    {
      key: 'section_link',
      title: 'Link to a section',
      group: LINKS_GROUP,
      aliases: ['link', 'section', 'heading', 'anchor'],
      icon: Hash,
      onItemClick: openPicker(SECTION_LINK_TRIGGER),
    },
  ];
}
