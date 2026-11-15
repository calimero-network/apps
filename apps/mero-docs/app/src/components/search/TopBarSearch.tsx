import * as React from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/common/Kbd';
import { KEY_LABELS } from '@/lib/platform';

// CSS picks the variant, so the right one paints first and nothing depends on matchMedia.
// `wide` holds the field back to 960px for a header with other things to fit.
const FIELD_FROM = {
  md: ['md:flex', 'md:hidden'],
  wide: ['min-[960px]:flex', 'min-[960px]:hidden'],
} as const;

export function TopBarSearch({
  onOpen,
  pillFrom = 'md',
}: {
  onOpen: () => void;
  pillFrom?: keyof typeof FIELD_FROM;
}) {
  const [showField, hideIcon] = FIELD_FROM[pillFrom];
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Search docs, folders and tags"
        className={`hidden h-[34px] w-full min-w-0 max-w-[460px] cursor-text items-center gap-2 rounded-lg border border-border/60 bg-secondary pl-[11px] pr-2 text-[13px] text-muted-foreground/80 transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showField}`}
      >
        <Search className="h-[15px] w-[15px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          Search docs, folders and #tags
        </span>
        <Kbd className="shrink-0 text-muted-foreground/80">
          {KEY_LABELS.search}
        </Kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className={`h-9 w-9 shrink-0 ${hideIcon}`}
        aria-label="Search"
        onClick={onOpen}
      >
        <Search className="h-4 w-4" />
      </Button>
    </>
  );
}
