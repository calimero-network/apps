import * as React from 'react';
import { Link, Link2Off, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface SectionBannerProps {
  variant: 'opened' | 'missing';
  section?: string;
  onTop?: () => void;
  onDismiss: () => void;
}

// Says why the document opened where it did; the slim bar under the editor header.
export function SectionBanner({
  variant,
  section,
  onTop,
  onDismiss,
}: SectionBannerProps) {
  const Icon = variant === 'opened' ? Link : Link2Off;
  return (
    <div className="flex min-h-[38px] items-center gap-2.5 border-b bg-primary/20 py-1 pl-4 pr-2 text-[12.5px] text-secure dark:bg-primary/10 dark:text-selected-foreground">
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span role="status" className="line-clamp-2 min-w-0 flex-1">
        {variant === 'opened' ? (
          <>
            Opened from a link to <b className="font-semibold">{section}</b>
          </>
        ) : (
          'That section was removed, so you are at the top of the document'
        )}
      </span>
      {variant === 'opened' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2.5 text-xs text-inherit"
          onClick={onTop}
        >
          Go to top
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-[30px] w-[30px] shrink-0 text-inherit [&_svg]:size-3.5"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}
