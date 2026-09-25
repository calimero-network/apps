// Backfills a namespace's display `name` from the join-time snapshot.
//
// `useNamespacesForApplication` relays `listNamespacesForApplication`,
// whose rows omit `name` until the node has synced the namespace's
// root-group metadata — which, on a joined node, can lag indefinitely
// (small-cluster gossip). The name is known at JOIN time though: it
// rides the invite URL (core resolves it as `groupName`) and the join
// flow persists it via `rememberNamespaceName`. This hook merges that
// persisted name in, so the workspace switcher shows it immediately —
// with no dependency on metadata sync.
//
// Namespaces the node created itself already carry `name` from the
// list endpoint (the metadata is local); those are left untouched.

import { useMemo } from 'react';
import { getRememberedNamespaceNames } from './namespaceNames';

interface NamespaceLike {
  namespaceId: string;
  name?: string | null;
}

export function useNamespaceDisplayNames<T extends NamespaceLike>(
  namespaces: T[],
): T[] {
  return useMemo(() => {
    const remembered = getRememberedNamespaceNames();
    return namespaces.map((n) => {
      if (n.name) return n;
      const name = remembered[n.namespaceId];
      return name ? { ...n, name } : n;
    });
  }, [namespaces]);
}
