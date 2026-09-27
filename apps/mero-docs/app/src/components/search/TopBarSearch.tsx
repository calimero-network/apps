import * as React from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/common/Kbd';

interface TopBarSearchProps {
  onOpen: () => void;
  shortcutLabel: string;
}

// CSS picks the variant, so the right one paints first and nothing depends on matchMedia.
export function TopBarSearch({ onOpen, shortcutLabel }: TopBarSearchProps) {
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Search docs, folders and tags"
        className="hidden h-[34px] w-full min-w-0 max-w-[460px] cursor-text items-center gap-2 rounded-lg border border-border/60 bg-secondary pl-[11px] pr-2 text-[13px] text-muted-foreground/80 transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
      >
        <Search className="h-[15px] w-[15px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search docs, folders and #tags</span>
        <Kbd className="shrink-0 text-muted-foreground/80">{shortcutLabel}</Kbd>
      </button>
      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 md:hidden" aria-label="Search" onClick={onOpen}>
        <Search className="h-4 w-4" />
      </Button>
    </>
  );
}
