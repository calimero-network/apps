import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

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
  icon?: LucideIcon; // overrides the kind's icon, e.g. for a tip
};

export type PaletteGroupView = { id: string; label: string; aside?: ReactNode; items: PaletteItemView[] };
