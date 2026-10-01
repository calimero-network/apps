// Shared layout for "nothing here yet" screens, so every empty state uses
// the same icon size, spacing and text tokens.

import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUIET_LOADER_DELAY_MS = 300; // a shorter wait shows nothing rather than flash a loader

interface Props {
  title: string;
  body?: string;
  icon?: LucideIcon;
  /** The one action that moves the user on, rendered under the copy. */
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  body,
  icon: Icon,
  children,
  className,
}: Props) {
  return (
    <div className={cn('flex h-full items-center justify-center p-8', className)}>
      <div className="max-w-sm text-center">
        {Icon && (
          <Icon
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60"
            aria-hidden
          />
        )}
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {body && (
          <p className="mt-1 text-sm text-muted-foreground text-balance">{body}</p>
        )}
        {children && (
          <div className="mt-4 flex flex-col items-center gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}

// A wait that is usually short: blank at first, then a plain loader.
export function QuietLoading() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), QUIET_LOADER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return shown ? <EmptyState title="Loading…" /> : null;
}
