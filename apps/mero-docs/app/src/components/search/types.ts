import type { ReactNode } from 'react';

export type PaletteItemView = {
  id: string;
  kind: 'doc' | 'text' | 'folder' | 'tag' | 'recent' | 'tip';
  title: string;
  titleRanges?: [number, number][];
  context?: ReactNode; // folder swatch + path · tag chips · time, built by the caller
  snippet?: string;
  snippetRanges?: [number, number][];
  right?: ReactNode; // LivePill, arrow for tags
  tagColor?: string; // for kind 'tag'
};

export type PaletteGroupView = { id: string; label: string; aside?: ReactNode; items: PaletteItemView[] };
