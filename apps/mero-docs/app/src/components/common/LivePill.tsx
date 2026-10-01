import * as React from 'react';

import type { DocPeer } from '@/hooks/usePresenceByDoc';

// The lime dot is a fill (matches --primary), never text on a light surface.
export function LivePill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary-ink">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {label}
    </span>
  );
}

/** Who is in a doc right now, for the pill: "Bob is here", "Bob and 2 others are here". */
export function hereLabel(here: DocPeer[]): string | undefined {
  if (here.length === 0) return undefined;
  if (here.length === 1) return `${here[0].name} is here`;
  if (here.length === 2) return `${here[0].name} and ${here[1].name} are here`;
  return `${here[0].name} and ${here.length - 1} others are here`;
}
