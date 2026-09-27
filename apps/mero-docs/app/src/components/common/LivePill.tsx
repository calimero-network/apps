import * as React from 'react';

// The lime dot is a fill (matches --primary), never text on a light surface.
export function LivePill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary-ink">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {label}
    </span>
  );
}
