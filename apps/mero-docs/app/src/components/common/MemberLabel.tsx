// The one render site for a member: display name, else UNNAMED_MEMBER_LABEL, never a raw key.
// Route every member mention through here so renames show everywhere; the key stays in `title`.

import React from 'react';
import { useMemberName } from '@/hooks/useMemberName';

export const UNNAMED_MEMBER_LABEL = 'Unnamed member'; // shown instead of a raw key

interface Props {
  namespaceId: string | null | undefined;
  memberId: string;
  /** Custom fallback render when no name is set. Default: UNNAMED_MEMBER_LABEL. */
  fallback?: (memberId: string) => React.ReactNode;
  /** Extra className passthrough so each call site keeps its existing
   *  typography (mono code-tag look, muted-foreground, etc). */
  className?: string;
  /** When true, render a tiny "(you)" badge after the name. */
  isSelf?: boolean;
}

export function MemberLabel({
  namespaceId,
  memberId,
  fallback,
  className,
  isSelf,
}: Props) {
  // The roster name still covers a viewer not allowed to read a member's metadata.
  const { name } = useMemberName(namespaceId, memberId);
  const body =
    name ?? (fallback ? fallback(memberId) : UNNAMED_MEMBER_LABEL);
  return (
    <span className={className} title={memberId}>
      {body}
      {isSelf && (
        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          (you)
        </span>
      )}
    </span>
  );
}
