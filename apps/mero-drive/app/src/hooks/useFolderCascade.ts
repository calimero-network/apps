// Cascade-target computation for inherit-mode child folders. When a
// member is added to a parent folder, the app-layer cascade applies
// the same (stripped) capabilities to every inherit-mode descendant
// — but stops at Restricted subtrees per the design spec.
//
// Effective caps = parentCaps & DEFAULT_CHILD_CAP_MASK. The mask
// strips admin bits (MANAGE_GROUP / MANAGE_MEMBERS / INVITE_MEMBERS)
// so a parent-admin becomes a child-member.

import { useMemo } from 'react';
import { DEFAULT_CHILD_CAP_MASK } from '../constants/config';

export interface CascadeFolder {
  id: string;
  parent_id: string | null;
  visibility: 'Inherit' | 'Restricted';
}

export interface CascadeTarget {
  folderId: string;
  capabilities: number;
}

export function computeCascadeTargets(
  folders: CascadeFolder[],
  startId: string,
  parentCaps: number,
): CascadeTarget[] {
  const childOf = new Map<string, CascadeFolder[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const arr = childOf.get(f.parent_id) ?? [];
    arr.push(f);
    childOf.set(f.parent_id, arr);
  }
  const out: CascadeTarget[] = [];
  const effectiveCaps = parentCaps & DEFAULT_CHILD_CAP_MASK;
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const c of childOf.get(id) ?? []) {
      if (c.visibility === 'Restricted') continue;
      out.push({ folderId: c.id, capabilities: effectiveCaps });
      walk(c.id);
    }
  };
  walk(startId);
  return out;
}

// `useMemo` wrapper earns this module its `use*` name — consumers in
// Phase 7's useFolderOperations will call this on every cascade and
// want a stable reference for dependent effects. Pure callers (tests,
// one-shot cascades) should call `computeCascadeTargets` directly.
export function useFolderCascade(
  folders: CascadeFolder[],
  startId: string,
  parentCaps: number,
): CascadeTarget[] {
  return useMemo(
    () => computeCascadeTargets(folders, startId, parentCaps),
    [folders, startId, parentCaps],
  );
}
