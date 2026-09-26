// Universal render site for a member identity. Shows the member's
// per-namespace display name (set via core's setMemberMetadata) when
// present, otherwise the shared "unnamed member" fallback so the row
// is never empty and never shows a raw key as visible text.
//
// All call sites that previously rendered a raw or truncated key
// should route through here so a rename surfaces consistently across
// member lists, sharing panels, and confirmation dialogs. The full key
// stays reachable via the `title` tooltip below.

import React from 'react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';

// Shared fallback so a member with no display name is never shown by a raw key.
export const UNNAMED_MEMBER_LABEL = 'Unnamed member';

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
  // Two name sources:
  //   1. The per-(namespace, identity) metadata fetch — authoritative
  //      when it resolves with a name. Refreshes live via the
  //      namespace SSE subscription added in PR #48.
  //   2. The namespace-wide identity→name map in useDriveWorkspace.
  //      Sourced from the namespace's root-group GroupMember rows,
  //      so folder / sharing panels resolve names without each row
  //      firing its own metadata HTTP call — and crucially, it still
  //      surfaces a name when the per-row metadata fetch resolves to
  //      null (e.g. a non-admin viewer who lacks the capability to
  //      read another member's metadata directly). The map itself is
  //      refreshed by the workspace's SSE refetch chain, so an
  //      explicit "clear name" propagates here on the next event.
  const { name } = useMemberDisplayName(namespaceId, memberId);
  const { namespaceMemberNames } = useDriveWorkspace();
  const resolvedName = name ?? namespaceMemberNames[memberId] ?? null;
  const body =
    resolvedName ?? (fallback ? fallback(memberId) : UNNAMED_MEMBER_LABEL);
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
