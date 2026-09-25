import React from 'react';
import { initials } from '@/lib/initials';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const MAX_SHOWN = 3; // the rest collapse into a "+N" chip

export interface Peer {
  id: string;
  name: string;
  colour: string;
}

/** Who else has this document open, in their caret colours. */
export function PeerAvatars({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, MAX_SHOWN);
  const hidden = peers.slice(MAX_SHOWN);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="mr-2 flex cursor-default items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="group"
          aria-label={`Also here: ${peers.map((p) => p.name).join(', ')}`}
        >
          {shown.map((p) => (
            <span
              key={p.id}
              className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card first:ml-0"
              style={{ backgroundColor: p.colour }}
            >
              {initials(p.name)}
            </span>
          ))}
          {hidden.length > 0 && (
            <span className="-ml-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground ring-2 ring-card">
              +{hidden.length}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-64">
        <p className="mb-1 font-medium text-muted-foreground">Also here</p>
        <ul className="space-y-1">
          {peers.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.colour }}
              />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
