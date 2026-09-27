import * as React from 'react';

import { cn } from '@/lib/utils';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  );
}
