import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { shortAccount } from "./account";
import { memberNames, type NamesAdmin } from "./directory";
import {
  fetchGroupName,
  backfillGroupName,
  resolveGroupName,
  type GroupNameSources,
} from "./groupName";

// A counter bumped on every directory change, so `useSyncExternalStore` sees a
// new snapshot and the callbacks below get new identities.
let version = 0;
memberNames.subscribe(() => {
  version += 1;
});

export interface MemberNames {
  /** The namespace name for `account`, or `undefined` when it has none. */
  nameOf: (account: string | null | undefined) => string | undefined;
  /**
   * Always a usable label: the namespace name, else `appName` (a name the app
   * holds for this account, such as a contract profile), else a short id.
   */
  displayName: (account: string | null | undefined, appName?: string | null) => string;
  /** Refetch now, e.g. after someone else renamed themselves. */
  refresh: () => void;
}

/**
 * Names for the members of `namespaceId`, for rendering.
 *
 * Safe to call from many components: they share one cached listing, and every
 * one of them re-renders when a name arrives or changes.
 */
export function useMemberNames(
  admin: NamesAdmin | null | undefined,
  namespaceId: string | null | undefined,
): MemberNames {
  // Re-render on any directory change; the resolvers below read it directly.
  useSyncExternalStore(
    (fn) => memberNames.subscribe(fn),
    () => version,
    () => version,
  );

  useEffect(() => {
    if (admin && namespaceId) void memberNames.load(admin, namespaceId);
  }, [admin, namespaceId]);

  const nameOf = useCallback(
    (account: string | null | undefined) => memberNames.peek(namespaceId, account),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namespaceId, version],
  );

  const displayName = useCallback(
    (account: string | null | undefined, appName?: string | null) =>
      memberNames.peek(namespaceId, account) || (appName ?? "").trim() || shortAccount(account),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namespaceId, version],
  );

  const refresh = useCallback(() => {
    if (admin && namespaceId) void memberNames.load(admin, namespaceId, { force: true });
  }, [admin, namespaceId]);

  return { nameOf, displayName, refresh };
}

export interface GroupNameOptions {
  /** Name a context of `groupId` instead of the group itself. */
  contextId?: string;
  /**
   * Promote `localName` into the group's record when the record has none.
   *
   * Every group named before its app wrote the record has only a local label,
   * visible on one browser. Writing it once makes it everyone's. Best-effort:
   * a member without CAN_MANAGE_METADATA is refused and keeps the local label.
   */
  backfillLocal?: boolean;
}

/**
 * The name of a group (or of a context, with `contextId`), resolved by
 * {@link resolveGroupName}. Renders the best name already in hand on the first
 * paint, then the replicated one once it arrives.
 */
export function useGroupName(
  admin: NamesAdmin | null | undefined,
  groupId: string | null | undefined,
  sources: Omit<GroupNameSources, "metadataName">,
  { contextId, backfillLocal = false }: GroupNameOptions = {},
): string {
  const [metadataName, setMetadataName] = useState<string | null>(null);
  const localName = (sources.localName ?? "").trim();

  useEffect(() => {
    setMetadataName(null);
    if (!admin || !groupId) return;
    let cancelled = false;
    void fetchGroupName(admin, groupId, contextId).then((name) => {
      if (cancelled) return;
      setMetadataName(name ?? null);
      // `null`, not `undefined`: only a record known to be unnamed is written.
      if (name === null && backfillLocal && localName && !contextId) {
        void backfillGroupName(admin, groupId, localName).catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [admin, groupId, contextId, backfillLocal, localName]);

  return resolveGroupName({ ...sources, metadataName });
}
