// Shared layout for "nothing here yet" screens, so every empty state uses
// the same icon size, spacing and text tokens.

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  body: string;
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
        {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
        {children && (
          <div className="mt-4 flex flex-col items-center gap-2">{children}</div>
        )}
      </div>
    </div>
  );
}
