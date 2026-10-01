// What the / menu offers: the blocks the app supports in sentence case, and
// links that open the @ picker for a document or for a section.

import {
  FileText,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  Pilcrow,
  type LucideIcon,
} from 'lucide-react';
import type { Dictionary } from '@blocknote/core';
import {
  getDefaultSlashMenuItems,
  SuggestionMenu,
} from '@blocknote/core/extensions';
import {
  blockTypeSelectItems as defaultBlockTypeSelectItems,
  type BlockTypeSelectItem,
} from '@blocknote/react';
import type { SlashMenuItem } from '@/components/editor/SlashMenu';
import { DOC_LINK_TRIGGER } from './docLinks';
import type { DriveEditor } from './schema';

export const SLASH_TRIGGER = '/';
export const SECTION_LINK_TRIGGER = '#'; // the section picker's menu; typing # never opens it
const LINKS_GROUP = 'Links';
const MEDIA_GROUP = 'Media';
// The blocks offered anywhere, by BlockNote's slash_menu key; the schema allows more than the app shows.
const HEADING_BLOCKS = ['heading', 'heading_2', 'heading_3'] as const;
const BASIC_BLOCKS = ['bullet_list', 'paragraph'] as const;
const BASIC_BLOCK_TYPES = ['paragraph', 'bulletListItem']; // BASIC_BLOCKS as block types, for the toolbar
const PLATFORM_MOD = /^(⌘|Ctrl)-/; // how BlockNote's badge spells Mod on this platform

export type SlashItem = SlashMenuItem & {
  aliases: string[];
  onItemClick: () => void;
};

const ICONS: Record<string, LucideIcon> = {
  heading: Heading1,
  heading_2: Heading2,
  heading_3: Heading3,
  bullet_list: List,
  paragraph: Pilcrow,
};

const sentenceCase = (text: string) =>
  text.charAt(0) + text.slice(1).toLowerCase();

/** `pickImage` is left out for someone who may not add images, and the item with it. */
export function slashMenuItems(editor: DriveEditor, pickImage?: () => void): SlashItem[] {
  const openPicker = (trigger: string) => () =>
    editor.getExtension(SuggestionMenu)?.openSuggestionMenu(trigger);
  const blocks = getDefaultSlashMenuItems(editor).map((item) => ({
    key: item.key,
    title: sentenceCase(item.title),
    group: sentenceCase(item.group ?? ''),
    aliases: item.aliases ?? [],
    shortcut: item.badge?.replace(PLATFORM_MOD, 'Mod-'),
    icon: ICONS[item.key] ?? Pilcrow,
    onItemClick: item.onItemClick,
  }));
  const pick = (keys: readonly string[]) =>
    blocks.filter((item) => keys.includes(item.key));
  return [
    ...pick(HEADING_BLOCKS),
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
    ...pick(BASIC_BLOCKS),
    ...(pickImage
      ? [
          {
            key: 'image',
            title: 'Image',
            group: MEDIA_GROUP,
            aliases: ['picture', 'photo', 'upload', 'img'],
            icon: ImageIcon,
            onItemClick: pickImage,
          },
        ]
      : []),
  ];
}

/** The formatting toolbar's block type choices, cut to the same blocks as the / menu. */
export function blockTypeSelectItems(dict: Dictionary): BlockTypeSelectItem[] {
  const offered = ({ type, props }: BlockTypeSelectItem) =>
    type === 'heading'
      ? !props?.isToggleable && Number(props?.level) <= HEADING_BLOCKS.length
      : BASIC_BLOCK_TYPES.includes(type);
  return defaultBlockTypeSelectItems(dict)
    .filter(offered)
    .map((item) => ({ ...item, name: sentenceCase(item.name) }));
}
