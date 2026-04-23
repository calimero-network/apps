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
  useCreateContext,
  useDeleteContext,
  useDeleteGroup,
  useSetGroupAlias,
  useAddGroupMembers,
} from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';
import { adminRequest } from '../api/adminApi';
import {
  getApplicationId,
  DOCS_SERVICE_ID,
} from '../constants/config';
import {
  computeCascadeTargets,
  CascadeFolder,
} from './useFolderCascade';
import { descendantsOf } from '../utils/ancestry';

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
  const { createContext } = useCreateContext();
  const { deleteContext } = useDeleteContext();
  const { deleteGroup } = useDeleteGroup();
  const { setGroupAlias } = useSetGroupAlias();
  const { addGroupMembers } = useAddGroupMembers();

  const create = useCallback(
    async (input: CreateFolderInput): Promise<string> => {
      if (!registryClient || !rootGroupId) {
        throw new Error('workspace not bootstrapped');
      }

      // Best-effort compensating actions on partial failure. The
      // sequence is inherently non-transactional across three
      // backends (admin groups, contexts, registry WASM), so we track
      // what we successfully did and reverse it in the catch. The
      // registry side is reversible via unregisterFolder, the admin
      // side via deleteGroup, and the context side via deleteContext.
      // What useReconcile can't easily recover on its own is a leaked
      // docs context with no registry entry — so rolling back the
      // context on later failures is the most valuable of the three.
      let createdGroupId: string | null = null;
      let createdContextId: string | null = null;
      let registryEntryCreated = false;

      try {
        const group = await createGroupInNamespace(input.namespaceId, { alias: input.alias });
        if (!group?.groupId) throw new Error('createGroupInNamespace returned no groupId');
        createdGroupId = group.groupId;
        const newId = group.groupId;

        // createGroupInNamespace always places the new group as a
        // direct child of the namespace root. To nest it under a
        // specific parent, use core's atomic reparent_group endpoint
        // (core#2200 — strict group-tree invariant). Once mero-react
        // ships a useReparentGroup hook the adminRequest call below
        // should be swapped for it; for now the endpoint shape mirrors
        // the {child_group_id, new_parent_id} body merobox posts (the
        // admin API uses snake_case throughout).
        if (input.parentGroupId !== rootGroupId) {
          await adminRequest(`/groups/reparent`, {
            method: 'POST',
            body: JSON.stringify({
              child_group_id: newId,
              new_parent_id: input.parentGroupId,
            }),
          });
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
        createdContextId = ctx.contextId;

        await registryClient.registerFolder({
          id: newId,
          parent_id: input.parentGroupId === rootGroupId ? null : input.parentGroupId,
          color: input.color ?? null,
        });
        registryEntryCreated = true;

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
      } catch (err) {
        // Reverse in the opposite order of creation. Each cleanup is
        // try/catch-wrapped and logged so a single cleanup failure
        // doesn't mask the original error — the caller still sees
        // the real cause via the outer rethrow.
        if (registryEntryCreated && createdGroupId) {
          await registryClient
            .unregisterFolder({ id: createdGroupId })
            .catch((e) => console.warn('rollback: unregisterFolder failed', e));
        }
        if (createdContextId) {
          await deleteContext(createdContextId).catch((e) =>
            console.warn('rollback: deleteContext failed', e),
          );
        }
        if (createdGroupId) {
          await deleteGroup(createdGroupId).catch((e) =>
            console.warn('rollback: deleteGroup failed', e),
          );
        }
        throw err;
      }
    },
    [registryClient, rootGroupId, createGroupInNamespace, createContext, deleteContext, deleteGroup],
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
      // `descendantsOf` from utils/ancestry already returns leaf-first
      // (post-order) — deepest first, root last — which is exactly
      // what the admin API's "no deletes with live subgroups"
      // invariant needs. Append the folder itself at the end so it's
      // deleted after all of its children.
      const victims = [...descendantsOf(tree, folderId), folderId];
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
