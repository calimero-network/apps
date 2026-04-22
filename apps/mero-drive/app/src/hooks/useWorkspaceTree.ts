// Workspace folder tree — merges admin-API subgroup entries (source
// of truth for tree shape + aliases) with registry FolderDto entries
// (source of truth for visibility + color + context binding).
//
// `mergeAdminAndRegistry` is exported separately so the pure merge
// logic can be tested without rendering the hook. The hook wrapper
// adds reactive fetching via mero-react's useSubgroups plus a
// RegistryClient.getFolders() call on mount / client change.
//
// Admin subgroup entries use `{ groupId, alias? }` (per mero-js's
// SubgroupEntry type). Registry entries use `{ id, parent_id, … }`
// (per the generated FolderDto). The merge reconciles the two shapes.

import { useEffect, useState } from 'react';
import type { SubgroupEntry } from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';

export interface AdminSubgroup {
  groupId: string;
  parent_id: string | null;
  alias?: string;
}

export interface RegistryFolderShape {
  id: string;
  parent_id: string | null;
  visibility: 'Inherit' | 'Restricted';
  color: string | null;
}

export interface MergedFolder {
  id: string;
  parent_id: string | null;
  alias: string;
  visibility: 'Inherit' | 'Restricted';
  color: string | null;
}

export function mergeAdminAndRegistry(
  admin: AdminSubgroup[],
  registry: RegistryFolderShape[],
  rootId: string,
): { folders: MergedFolder[] } {
  const regById = new Map(registry.map((r) => [r.id, r]));
  const folders: MergedFolder[] = admin
    .filter((g) => g.groupId !== rootId)
    .map((g) => {
      const r = regById.get(g.groupId);
      return {
        id: g.groupId,
        parent_id: g.parent_id,
        alias: g.alias ?? g.groupId,
        visibility: r?.visibility ?? 'Inherit',
        color: r?.color ?? null,
      };
    });
  return { folders };
}

export interface WorkspaceTreeState {
  folders: MergedFolder[];
  loading: boolean;
  error: Error | null;
}

// `adminSubgroups` is the already-fetched list (passed in from the
// caller's useSubgroups() / useNamespaceGroups() hook). Keeping the
// fetch out of this hook lets the caller decide which mero-react
// hook to subscribe to without this module pinning the choice.
export function useWorkspaceTree(
  rootGroupId: string | null,
  registryClient: RegistryClient | null,
  adminSubgroups: SubgroupEntry[],
  adminLoading: boolean,
): WorkspaceTreeState {
  const [regFolders, setRegFolders] = useState<RegistryFolderShape[]>([]);
  const [regLoading, setRegLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!registryClient) {
      setRegLoading(true);
      return;
    }
    let alive = true;
    setRegLoading(true);
    registryClient
      .getFolders()
      .then((fs) => {
        if (!alive) return;
        setRegFolders(
          fs.map((f) => ({
            id: f.id,
            parent_id: f.parent_id ?? null,
            visibility: f.visibility as 'Inherit' | 'Restricted',
            color: f.color ?? null,
          })),
        );
        setError(null);
        setRegLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRegLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [registryClient]);

  // SubgroupEntry has no parent_id in the admin-API response — it's
  // the flat list of descendants of rootGroupId. The registry's
  // parent_id is what we actually use for the tree shape; admin just
  // gives us membership + alias.
  const admin: AdminSubgroup[] = adminSubgroups.map((s) => {
    const fromReg = regFolders.find((r) => r.id === s.groupId);
    return {
      groupId: s.groupId,
      parent_id: fromReg?.parent_id ?? rootGroupId,
      alias: s.alias,
    };
  });

  const { folders } = rootGroupId
    ? mergeAdminAndRegistry(admin, regFolders, rootGroupId)
    : { folders: [] };

  return {
    folders,
    loading: adminLoading || regLoading,
    error,
  };
}
