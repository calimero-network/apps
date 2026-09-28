import * as React from 'react';
import { ExternalLink, FolderCheck, Lock, UserX } from 'lucide-react';

import type { MemberHrefTarget } from '@/lib/links';
import { presenceColour } from '@/lib/rich/presence';
import { CANT_OPEN_FOLDER } from './blocknote/mentions';
import { initials } from './PeerAvatars';

const ACCESS: Record<'yes' | 'no' | 'left', [typeof Lock, string]> = {
  yes: [FolderCheck, 'Can open this folder'],
  no: [Lock, CANT_OPEN_FOLDER],
  left: [UserX, 'Not in this workspace'],
};

export type MemberCardProps =
  | {
      state: 'ok';
      id: string;
      name: string;
      role?: string;
      access: keyof typeof ACCESS | 'unknown';
    }
  | { state: 'other-workspace' };

const cardClass = 'w-[260px] max-w-[calc(100vw-16px)] px-3.5 py-3';

/** What a mention's card shows: the member's name and role today, and whether they can open the open doc's folder. */
export function memberCardProps(
  target: MemberHrefTarget,
  d: {
    ws: string | null | undefined;
    members: string[] | null; // null until the member list is read
    name: string;
    role?: string;
    canOpen: boolean | undefined;
  },
): MemberCardProps {
  if (target.ws !== d.ws) return { state: 'other-workspace' };
  const left = d.members !== null && !d.members.includes(target.member);
  return {
    state: 'ok',
    id: target.member,
    name: d.name,
    ...(d.role ? { role: d.role } : {}),
    access: left
      ? 'left'
      : d.canOpen === undefined
        ? 'unknown'
        : d.canOpen
          ? 'yes'
          : 'no',
  };
}

// The person a mention names, shown on hover, focus or click.
export function MemberCard(props: MemberCardProps) {
  if (props.state === 'other-workspace') {
    return (
      <div
        className={`${cardClass} flex items-center gap-2 text-[13px] text-muted-foreground`}
      >
        <ExternalLink aria-hidden className="h-[15px] w-[15px] shrink-0" />
        This mentions someone in another workspace
      </div>
    );
  }
  const access = props.access === 'unknown' ? null : ACCESS[props.access];
  const AccessIcon = access?.[0];
  return (
    <div className={cardClass}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: presenceColour(props.id) }}
        >
          {initials(props.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-foreground">
            {props.name}
          </div>
          {props.role && (
            <div className="truncate text-xs text-muted-foreground">
              {props.role}
            </div>
          )}
        </div>
      </div>
      {access && AccessIcon && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
          <AccessIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {access[1]}
        </div>
      )}
    </div>
  );
}
