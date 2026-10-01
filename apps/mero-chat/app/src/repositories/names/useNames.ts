import { useCallback, useEffect, useMemo, useState } from "react";

import { getGroupId } from "../../constants/config";
import { NameRepository } from "./NameRepository";

/**
 * One repository for the whole app.
 *
 * A module singleton rather than a React context value, so non-component
 * callers (notification handlers, effects, anything outside the tree) resolve
 * through exactly the same cache as the components do. A second instance would
 * be a second cache, and two caches disagree — which is the class of bug this
 * whole thing exists to remove.
 */
export const nameRepository = new NameRepository(() => getGroupId());

/** Re-render when any name lands, so resolved names appear without a poll. */
function useNameUpdates(): void {
  const [, force] = useState(0);
  useEffect(
    () => nameRepository.subscribe(() => force((n) => n + 1)),
    [],
  );
}

/**
 * The display name for one account.
 *
 * Always returns something renderable — a resolved name, or a truncated account
 * while it loads or when the person has none.
 */
export function useDisplayName(account: string | undefined): string {
  useNameUpdates();
  return nameRepository.displayName(account);
}

/**
 * The resolved name, or `undefined` when the repository has none yet.
 *
 * For the few callers that hold a legitimate pre-sync fallback of their own —
 * a DM's creation-time snapshot, say — and need to know whether to use it.
 * Prefer `useDisplayName` everywhere else: it always returns something
 * renderable and callers should not be inventing their own placeholder.
 */
export function useResolvedName(account: string | undefined): string | undefined {
  useNameUpdates();
  return nameRepository.peek(account) ?? undefinedIfUnloaded(account);
}

/** Triggers the fetch that `peek` deliberately does not. */
function undefinedIfUnloaded(account: string | undefined): undefined {
  nameRepository.displayName(account);
  return undefined;
}

/**
 * A resolver for components that render many names.
 *
 * One subscription for the list rather than one per row.
 */
export function useNameResolver(): {
  displayName: (account: string | undefined) => string;
  invalidate: (account?: string) => void;
} {
  useNameUpdates();
  const displayName = useCallback(
    (account: string | undefined) => nameRepository.displayName(account),
    [],
  );
  const invalidate = useCallback(
    (account?: string) => nameRepository.invalidate(account),
    [],
  );
  return useMemo(
    () => ({ displayName, invalidate }),
    [displayName, invalidate],
  );
}
