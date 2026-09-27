import * as React from 'react';
import {
  Archive,
  ArrowDownWideNarrow,
  Calendar,
  ChevronDown,
  Folder,
  Tag,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { FilterChipView, FilterIcon } from './types';

export const FILTER_ICONS: Record<FilterIcon, LucideIcon> = {
  folder: Folder,
  tag: Tag,
  calendar: Calendar,
  user: User,
  archive: Archive,
};

interface Props {
  chips: FilterChipView[];
  sortLabel: string;
  onSortClick: () => void;
  onClear: () => void;
}

export function FilterBar({ chips, sortLabel, onSortClick, onClear }: Props) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/60 px-4 pb-3 pt-1 [scrollbar-width:none] md:px-7 [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <FilterChip key={chip.id} chip={chip} />
      ))}
      {chips.some((c) => c.active) && (
        <button
          type="button"
          onClick={onClear}
          className="h-7 shrink-0 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear
        </button>
      )}
      <button
        type="button"
        onClick={onSortClick}
        aria-label={`Sort: ${sortLabel}`}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
        {sortLabel}
      </button>
    </div>
  );
}

function FilterChip({ chip }: { chip: FilterChipView }) {
  const [localOpen, setLocalOpen] = React.useState(false);
  const open = chip.open ?? localOpen;
  const setOpen = chip.onOpenChange ?? setLocalOpen;
  const Icon = FILTER_ICONS[chip.icon];
  const showClear = chip.active && !chip.toggle && chip.onClear;
  const inner =
    'flex h-full items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const label = (
    <>
      <Icon
        className={cn(
          'h-[13px] w-[13px] shrink-0',
          chip.active ? 'opacity-75' : 'text-muted-foreground/80',
        )}
        aria-hidden
      />
      {chip.label}
      {chip.popover && !chip.active && (
        <ChevronDown
          className="h-[13px] w-[13px] shrink-0 text-muted-foreground/80"
          aria-hidden
        />
      )}
    </>
  );

  const shell = (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border text-[12.5px] transition-[color,background-color,box-shadow]',
        chip.active
          ? 'border-primary-ink/45 bg-primary/20 font-medium text-selected-foreground dark:border-primary-ink/35 dark:bg-primary/10'
          : 'border-border bg-card text-secondary-foreground hover:bg-accent',
        open && 'ring-[3px] ring-primary/55 dark:ring-primary/45',
      )}
    >
      {chip.toggle ? (
        <button
          type="button"
          aria-pressed={chip.active}
          onClick={chip.onToggle}
          className={cn(inner, 'pl-2.5 pr-[9px]')}
        >
          {label}
        </button>
      ) : chip.popover ? (
        <PopoverTrigger
          className={cn(inner, 'pl-2.5', showClear ? 'pr-0' : 'pr-[9px]')}
        >
          {label}
        </PopoverTrigger>
      ) : (
        <span className={cn(inner, 'pl-2.5', showClear ? 'pr-0' : 'pr-[9px]')}>
          {label}
        </span>
      )}
      {showClear && (
        <button
          type="button"
          aria-label={`Clear ${chip.label}`}
          onClick={chip.onClear}
          className="flex h-full items-center rounded-full pl-1.5 pr-[9px] opacity-75 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-[13px] w-[13px]" aria-hidden />
        </button>
      )}
    </span>
  );

  if (!chip.popover || chip.toggle) return shell;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{shell}</PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto overflow-hidden rounded-[10px] p-0"
      >
        {chip.popover}
      </PopoverContent>
    </Popover>
  );
}
