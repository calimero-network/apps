import type { ReactNode } from 'react';

export type PersonView = { id: string; name: string; colour: string };
export type TagView = { key: string; name: string; color?: string };
export type DocRowView = {
  key: string; // `${folderId}/${docId}`
  title: string; // "" renders "Untitled" (muted)
  folderPath: string[]; // ['Engineering', 'Specs']
  folderColor?: string;
  tags: TagView[];
  here: PersonView[]; // avatars in "Here now"
  liveLabel?: string; // e.g. "Bob is here", shown as LivePill after the title
  updatedLabel: string; // "2 min ago"
  archived?: boolean; // muted row + small "Archived" label
};

export type FilterIcon =
  | 'folder'
  | 'tag'
  | 'calendar'
  | 'user'
  | 'mention'
  | 'archive';
export type FilterChipView = {
  id: string;
  icon: FilterIcon;
  label: string;
  active: boolean;
  onClear?: () => void;
  onToggle?: () => void;
  popover?: ReactNode; // content rendered in a Popover anchored to the chip
  open?: boolean; // controls the popover, e.g. to close it after a single pick
  onOpenChange?: (open: boolean) => void;
};
