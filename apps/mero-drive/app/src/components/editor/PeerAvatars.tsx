import React from 'react';
import { initials } from '@/lib/initials';

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
    <div
      className="mr-2 flex items-center"
      role="group"
      aria-label={`Also here: ${peers.map((p) => p.name).join(', ')}`}
    >
      {shown.map((p) => (
        <span
          key={p.id}
          title={p.name}
          className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card first:ml-0"
          style={{ backgroundColor: p.colour }}
        >
          {initials(p.name)}
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map((p) => p.name).join(', ')}
          className="-ml-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground ring-2 ring-card"
        >
          +{hidden.length}
        </span>
      )}
    </div>
  );
}
