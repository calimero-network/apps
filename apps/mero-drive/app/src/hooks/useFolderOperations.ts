// Folder CRUD. Creates a subgroup under a parent, attaches a fresh
// docs context, registers the folder in the namespace registry, and
// sets `subgroup_visibility` on the new subgroup (Open by default —
// namespace members inherit membership via core's parent-walk per
// PR #2261; Restricted for explicit-invite-only folders).
//
// The previous app-layer membership cascade is gone: core handles
// inheritance natively now, so we don't need to enumerate namespace
// members and add them to each new folder.
//
// All mutations go through mero-react hooks so the underlying admin
// client is the same MeroJs instance everything else uses.

import { useCallback } from 'react';
import {
  useCreateGroupInNamespace,
  useCreateContext,
  useDeleteContext,
  useDeleteGroup,
  useSetGroupMetadata,
  useSetSubgroupVisibility,
  useAddGroupMembers,
  useMero,
} from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';
import { DOCS_SERVICE_ID } from '../constants/config';
import { reparentGroup } from '../api/reparentGroup';
import { descendantsOf } from '../utils/ancestry';

export interface CreateFolderInput {
  namespaceId: string;
  parentGroupId: string;
  alias: string;
  color?: string | null;
  /** 'Open' = namespace members inherit access (the default).
   *  'Restricted' = explicit invite required (per-subgroup wall). */
  visibility: 'Open' | 'Restricted';
  /** Identities to add to the new subgroup immediately (Restricted
   *  folders only — Open folders inherit members from the namespace).
   *  Added best-effort as the final create step; a failure here does
   *  NOT roll back the folder. */
  members?: string[];
}

export interface FolderOperations {
  /** Returns the new folder's groupId on success. */
  create: (input: CreateFolderInput) => Promise<string>;
  rename: (folderId: string, alias: string) => Promise<void>;
  remove: (folderId: string) => Promise<void>;
}

export function useFolderOperations(
  registryClient: RegistryClient | null,
  rootGroupId: string | null,
  applicationId: string | null,
  // Called after a successful create/rename/remove to refresh the
  // workspace's cached subgroup list and registry folders. Without
  // this, mutations succeed server-side but the UI stays stale until
  // the user navigates away and back. Pass `useDriveWorkspace().refetch`.
  refetch: () => Promise<void>,
): FolderOperations {
  const { createGroupInNamespace } = useCreateGroupInNamespace();
  const { createContext } = useCreateContext();
  const { deleteContext } = useDeleteContext();
  const { deleteGroup } = useDeleteGroup();
  const { setGroupMetadata } = useSetGroupMetadata();
  const { setSubgroupVisibility } = useSetSubgroupVisibility();
  const { addGroupMembers } = useAddGroupMembers();
  const { nodeUrl } = useMero();

  const create = useCallback(
    async (input: CreateFolderInput): Promise<string> => {
      if (!registryClient || !rootGroupId) {
        throw new Error('workspace not bootstrapped');
      }
      // Empty applicationId makes admin-api reject the context
      // creation with a base58-decode error. Guard here so the user
      // gets a meaningful message instead of a raw 400.
      if (!applicationId) {
        throw new Error(
          'Application ID not resolved — reconnect or set VITE_APPLICATION_ID',
        );
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
      // Flips true once the folder + docs context exist and are bound.
      // Past this point a failure (e.g. adding members) must NOT roll
      // back a perfectly good folder — it should surface instead.
      let folderReady = false;

      try {
        // Step ordering is load-bearing for Open subgroups. Core
        // encrypts every GroupOp with the key chain implied by
        // current subgroup_visibility at publish time: an Open
        // subgroup whose chain reaches the namespace root encrypts
        // with the namespace key (visible to all namespace members);
        // anything else encrypts with the subgroup key (visible only
        // to direct subgroup members). The create-time `name` stamp
        // and any subsequent `setGroupMetadata` BEFORE
        // `setSubgroupVisibility(Open)` therefore land subgroup-key-
        // encrypted — namespace-only members can't decrypt them, and
        // see the folder as unnamed.
        //
        // Order below: create with no name → reparent → flip
        // visibility → set name. For Restricted subgroups the
        // visibility flip is a no-op (Restricted is the default),
        // and the name write still encrypts with the subgroup key —
        // which is fine because only subgroup members ever read it.
        const group = await createGroupInNamespace(input.namespaceId, {});
        if (!group?.groupId) throw new Error('createGroupInNamespace returned no groupId');
        createdGroupId = group.groupId;
        const newId = group.groupId;

        if (input.parentGroupId !== rootGroupId) {
          if (!nodeUrl) throw new Error('Node URL not resolved');
          await reparentGroup(nodeUrl, newId, input.parentGroupId, rootGroupId);
        }

        // Core expects lowercase `"open"` / `"restricted"`; see
        // `crates/server/src/admin/handlers/groups/set_subgroup_visibility.rs:31`
        // — capitalized values return 400 Bad Request.
        await setSubgroupVisibility(newId, {
          subgroupVisibility: input.visibility.toLowerCase(),
        });

        // Now the name op encrypts on the namespace key chain for
        // Open subgroups; on the subgroup key for Restricted.
        await setGroupMetadata(newId, { name: input.alias });

        const ctx = await createContext({
          applicationId,
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
          // Folder names come from core group metadata's `name` (list
          // rows carry it as of #2338); the registry's `alias` field
          // is kept readable for back-compat but is no longer
          // written.
          alias: null,
        });
        registryEntryCreated = true;

        await registryClient.bindFolderContext({
          folder_id: newId,
          context_id: ctx.contextId,
        });
        folderReady = true;
      } catch (err) {
        // Only genuine *creation-step* failures reach here (everything
        // up to and including bindFolderContext). Roll back the
        // half-built folder, reversing creation order. Each cleanup is
        // try/catch-wrapped and logged so one cleanup failure doesn't
        // mask the original error — the caller still sees the real
        // cause via the outer rethrow.
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

      // --- Post-creation, best-effort (folder is fully built here) ---
      // These steps must NOT throw: a throw propagates to the dialog,
      // which keeps it open with "Create" re-enabled — letting the user
      // resubmit and create a DUPLICATE folder. The folder is already
      // valid, so on failure we log loudly (the role must be a core
      // MemberRole variant — `Member`, not `member` — which silently
      // broke adds before) and let the dialog close. Missing members
      // can be re-added from the folder's sharing panel.
      if (folderReady && createdGroupId) {
        if (input.members && input.members.length > 0) {
          try {
            await addGroupMembers(createdGroupId, {
              members: input.members.map((identity) => ({
                identity,
                role: 'Member',
              })),
            });
          } catch (e) {
            console.error(
              '[create] addGroupMembers failed (folder kept; add via sharing panel)',
              e,
            );
          }
        }
        await refetch().catch((e) =>
          console.error('[create] post-create refetch failed', e),
        );
        return createdGroupId;
      }
      // Unreachable in practice (a creation failure rethrows above), but
      // keeps the function total for TypeScript.
      throw new Error('folder creation did not complete');
    },
    [
      registryClient,
      rootGroupId,
      applicationId,
      refetch,
      nodeUrl,
      createGroupInNamespace,
      setGroupMetadata,
      setSubgroupVisibility,
      addGroupMembers,
      createContext,
      deleteContext,
      deleteGroup,
    ],
  );

  const rename = useCallback(
    async (folderId: string, alias: string) => {
      // Folder names live in core group metadata (`metadata.name`) and
      // are visible to every namespace member on the list rows as of
      // #2338 — no registry alias mirror needed anymore.
      await setGroupMetadata(folderId, { name: alias });
      await refetch();
    },
    [setGroupMetadata, refetch],
  );

  const remove = useCallback(
    async (folderId: string) => {
      if (!registryClient) throw new Error('registry not ready');
      // Compute the cascade from the COMPLETE registry tree, not a
      // display list. The workspace `folders` list is filtered to what
      // the caller can see (hidden restricted folders are dropped), so
      // using it here would miss a hidden restricted child under a
      // visible parent — `descendantsOf` wouldn't enumerate it, and
      // `deleteGroup(parent)` would then fail server-side ("live
      // subgroups"). The registry owns the authoritative tree shape, so
      // re-read it here.
      const all = await registryClient.getFolders();
      const tree = all.map((f) => ({
        id: f.id,
        parent_id: f.parent_id ?? null,
      }));
      // `descendantsOf` from utils/ancestry already returns leaf-first
      // (post-order) — deepest first, root last — which is exactly
      // what the admin API's "no deletes with live subgroups"
      // invariant needs. Append the folder itself at the end so it's
      // deleted after all of its children.
      const victims = [...descendantsOf(tree, folderId), folderId];
      for (const id of victims) {
        // Fetch the bound docs context BEFORE unregistering, because
        // unregister removes the folder-context binding and we lose
        // the handle. Folders without a bound context (shouldn't
        // happen after Phase 7's create path but tolerated during
        // migration) return null and skip the context delete.
        const boundContextId = await registryClient
          .getFolderContext({ folder_id: id })
          .catch(() => null);
        await registryClient.unregisterFolder({ id });
        // Delete the docs context BEFORE the group that contains it.
        // The context is the resource living inside the group; if the
        // group is removed first, core may cascade-delete (or refuse
        // to resolve) the context, leaving `deleteContext` to fail or
        // no-op. This also matches the create-path rollback order
        // (context before group).
        if (boundContextId) {
          await deleteContext(boundContextId).catch((e) =>
            console.warn('failed to delete bound docs context', boundContextId, e),
          );
        }
        await deleteGroup(id);
      }
      await refetch();
    },
    [registryClient, deleteGroup, deleteContext, refetch],
  );

  return { create, rename, remove };
}
