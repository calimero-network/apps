// Namespace-scope permissions — derived from the caller's capability
// bitmask on the namespace's root group. Consumed by the namespace
// switcher / namespace-level admin panels to gate "create subgroup",
// "manage namespace", "manage members" affordances.

import { useEffect, useState } from 'react';
import { adminRequest } from '../api/adminApi';
import { CAP } from '../constants/config';
import { useSelfIdentity } from './useSelfIdentity';

export interface NamespacePermissions {
  canCreateSubgroup: boolean;
  canManageNamespace: boolean;
  canManageNamespaceMembers: boolean;
  loading: boolean;
}

export function useNamespacePermissions(
  namespaceId: string,
  rootGroupId: string,
): NamespacePermissions {
  const { identity } = useSelfIdentity(namespaceId);
  const [caps, setCaps] = useState<number | null>(null);

  useEffect(() => {
    if (!identity) {
      setCaps(null);
      return;
    }
    // Reset synchronously so a rootGroupId / identity change can't
    // surface the previous group's caps with `loading: false`. Without
    // this, switching from a namespace where the caller is admin to
    // one where they're a member would briefly show admin affordances.
    setCaps(null);
    let alive = true;
    adminRequest<{ capabilities: number }>(`/groups/${rootGroupId}/members/${identity}`)
      .then((r) => {
        if (alive) setCaps(r.capabilities);
      })
      .catch(() => {
        if (alive) setCaps(0);
      });
    return () => {
      alive = false;
    };
  }, [rootGroupId, identity]);

  const has = (bit: number) => caps !== null && (caps & bit) === bit;
  return {
    canCreateSubgroup: has(CAP.CREATE_GROUP),
    canManageNamespace: has(CAP.MANAGE_GROUP),
    canManageNamespaceMembers: has(CAP.MANAGE_MEMBERS),
    loading: caps === null,
  };
}
