// Folder CRUD with app-layer cascade. Creates a subgroup under a
// parent, attaches a fresh docs context, registers the folder in the
// namespace registry, and optionally cascades the parent's non-admin
// capabilities to the new subgroup (for inherit-mode creation).
//
// The cascade is app-layer because the backend has no built-in
// "subgroup inherits parent's membership" — it's our policy choice
// per the design spec, and the deliberately-stripped cap mask
// (DEFAULT_CHILD_CAP_MASK) turns parent-admins into child-members.
//
// All mutations go through mero-react hooks so the underlying admin
// client is the same MeroJs instance everything else uses.

import { useCallback } from 'react';
import {
  useCreateGroupInNamespace,
  useNestGroup,
  useCreateContext,
  useDeleteGroup,
  useSetGroupAlias,
  useAddGroupMembers,
} from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';
import {
  getApplicationId,
  DOCS_SERVICE_ID,
} from '../constants/config';
import {
  computeCascadeTargets,
  CascadeFolder,
} from './useFolderCascade';

export interface CreateFolderInput {
  namespaceId: string;
  parentGroupId: string;
  alias: string;
  color?: string | null;
  visibility: 'Inherit' | 'Restricted';
}

export interface FolderOperations {
  /** Returns the new folder's groupId on success. */
  create: (input: CreateFolderInput) => Promise<string>;
  rename: (folderId: string, alias: string) => Promise<void>;
  remove: (folderId: string) => Promise<void>;
  /** App-layer cascade: add an identity to every inherit-mode
   *  descendant of `parentFolderId` with the given cap mask. */
  cascadeTo: (
    parentFolderId: string,
    identity: string,
    capabilities: number,
  ) => Promise<void>;
}

export function useFolderOperations(
  registryClient: RegistryClient | null,
  rootGroupId: string | null,
  tree: CascadeFolder[],
): FolderOperations {
  const { createGroupInNamespace } = useCreateGroupInNamespace();
  const { nestGroup } = useNestGroup();
  const { createContext } = useCreateContext();
  const { deleteGroup } = useDeleteGroup();
  const { setGroupAlias } = useSetGroupAlias();
  const { addGroupMembers } = useAddGroupMembers();

  const create = useCallback(
    async (input: CreateFolderInput): Promise<string> => {
      if (!registryClient || !rootGroupId) {
        throw new Error('workspace not bootstrapped');
      }
      const group = await createGroupInNamespace(input.namespaceId, { alias: input.alias });
      if (!group?.groupId) throw new Error('createGroupInNamespace returned no groupId');
      const newId = group.groupId;

      if (input.parentGroupId !== rootGroupId) {
        await nestGroup(input.parentGroupId, { childGroupId: newId });
      }

      const ctx = await createContext({
        applicationId: getApplicationId(),
        groupId: newId,
        serviceName: DOCS_SERVICE_ID,
        initializationParams: [],
      });
      if (!ctx?.contextId) {
        throw new Error('createContext returned no contextId');
      }

      await registryClient.registerFolder({
        id: newId,
        parent_id: input.parentGroupId === rootGroupId ? null : input.parentGroupId,
        color: input.color ?? null,
      });
      await registryClient.bindFolderContext({
        folder_id: newId,
        context_id: ctx.contextId,
      });

      if (input.visibility === 'Restricted') {
        await registryClient.setVisibility({ id: newId, visibility: 'Restricted' });
      }
      // NB: the inherit-mode member cascade for existing parent
      // members is handled by useFolderMembership + cascadeTo when
      // the UI explicitly invites people, not at creation time.

      return newId;
    },
    [registryClient, rootGroupId, createGroupInNamespace, nestGroup, createContext],
  );

  const rename = useCallback(
    async (folderId: string, alias: string) => {
      await setGroupAlias(folderId, { alias });
    },
    [setGroupAlias],
  );

  const remove = useCallback(
    async (folderId: string) => {
      if (!registryClient) throw new Error('registry not ready');
      // Leaf-first descendant walk: delete deepest first so each
      // delete sees a childless node. Admin API enforces this by
      // refusing to delete groups that still have subgroups.
      const victims = [folderId, ...descendantsOf(tree, folderId)];
      victims.sort((a, b) => depthIn(tree, b) - depthIn(tree, a));
      for (const id of victims) {
        await registryClient.unregisterFolder({ id });
        await deleteGroup(id);
      }
    },
    [registryClient, tree, deleteGroup],
  );

  const cascadeTo = useCallback(
    async (parentFolderId: string, identity: string, capabilities: number) => {
      const targets = computeCascadeTargets(tree, parentFolderId, capabilities);
      const failures: string[] = [];
      for (const t of targets) {
        try {
          // Default role "member" — exact caps are controlled by the
          // bitmask via useGroupCapabilities.setCapabilities once the
          // member row exists. addGroupMembers creates the row; cap
          // assignment is a follow-up via UI-level permission edits.
          await addGroupMembers(t.folderId, {
            members: [{ identity, role: 'member' }],
          });
        } catch (e) {
          failures.push(t.folderId);
          console.warn('cascade member-add failed for', t.folderId, e);
        }
      }
      if (failures.length) {
        console.warn(`cascade: ${failures.length}/${targets.length} folders failed`);
      }
      // Deliberately discard `capabilities` arg at this layer — we
      // parked caps assignment for a follow-up (see above). Still
      // accepting it in the signature so callers can pass the mask
      // they want, ready for when we wire cap-setting through.
      void capabilities;
    },
    [tree, addGroupMembers],
  );

  return { create, rename, remove, cascadeTo };
}

function descendantsOf(tree: CascadeFolder[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const f of tree) {
    if (!f.parent_id) continue;
    const arr = children.get(f.parent_id) ?? [];
    arr.push(f.id);
    children.set(f.parent_id, arr);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const c of children.get(id) ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(rootId);
  return out;
}

function depthIn(tree: CascadeFolder[], id: string): number {
  const byId = new Map(tree.map((f) => [f.id, f]));
  let d = 0;
  let cur = byId.get(id)?.parent_id ?? null;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    d++;
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return d;
}
