// Folder CRUD, in core alone. A folder is a subgroup under its parent, with
// its name and colour in the subgroup's metadata and one docs context inside
// it; `subgroup_visibility` is Open (namespace members inherit membership via
// core's parent-walk) or Restricted (explicit-invite-only). Nothing is written
// to the namespace-wide registry, which every workspace member replicates.
//
// The previous app-layer membership cascade is gone: core handles
// inheritance natively now, so we don't need to enumerate namespace
// members and add them to each new folder.
//
// Mutations go through mero-react hooks, except rename and member adds: those
// hooks resolve a failed call to null, so they call `admin`, which throws.

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  useCreateGroupInNamespace,
  useCreateContext,
  useDeleteContext,
  useDeleteGroup,
  useSetSubgroupVisibility,
  useMero,
} from '@calimero-network/mero-react';
import { DOCS_SERVICE_ID } from '../constants/config';
import { FOLDER_COLOR_KEY } from '../lib/coreFolders';
import { inheritReadOnly, readOnlyRowsBeforeOpen } from '../lib/applyFolderRole';

const READ_ONLY_NOT_CARRIED = "Couldn't make the parent folder's Read only members read only here."; // shown after create

export interface CreateFolderInput {
  namespaceId: string;
  parentGroupId: string;
  alias: string;
  color?: string | null;
  /** 'Open' = namespace members inherit access (the default).
   *  'Restricted' = explicit invite required (per-subgroup wall). */
  visibility: 'Open' | 'Restricted';
  /** Identities to add to the new subgroup immediately (Restricted
   *  folders only - Open folders inherit members from the namespace).
   *  Added best-effort as the final create step; a failure here does
   *  NOT roll back the folder. */
  members?: string[];
}

export interface FolderOperations {
  /** Resolves to the identities from `input.members` that failed to be added; empty on a clean add. */
  create: (input: CreateFolderInput) => Promise<string[]>;
  rename: (folderId: string, alias: string) => Promise<void>;
  remove: (folderId: string) => Promise<void>;
}

export function useFolderOperations(
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
  const { setSubgroupVisibility } = useSetSubgroupVisibility();
  const { admin } = useMero();
  const inFlightRef = useRef<Promise<string[]> | null>(null);

  const createInternal = useCallback(
    async (input: CreateFolderInput): Promise<string[]> => {
      if (!rootGroupId || !admin) {
        throw new Error('workspace not bootstrapped');
      }
      // Empty applicationId makes admin-api reject the context
      // creation with a hex-decode error. Guard here so the user
      // gets a meaningful message instead of a raw 400.
      if (!applicationId) {
        throw new Error(
          'Application ID not resolved. Reconnect or set VITE_APPLICATION_ID',
        );
      }

      // Best-effort compensating actions on partial failure. The sequence is
      // non-transactional (a group, then a context in it), so we track what we
      // did and reverse it in the catch: deleteContext, then deleteGroup.
      const writer = { admin };
      const openChild =
        input.parentGroupId !== rootGroupId && input.visibility === 'Open';
      let createdGroupId: string | null = null;
      let createdContextId: string | null = null;
      // Flips true once the folder + docs context exist.
      // Past this point a failure (e.g. adding members) must NOT roll
      // back a perfectly good folder - it should surface instead.
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
        // encrypted - namespace-only members can't decrypt them, and
        // see the folder as unnamed.
        //
        // Order below: create with no name → reparent → flip
        // visibility → set name. For Restricted subgroups the
        // visibility flip is a no-op (Restricted is the default),
        // and the name write still encrypts with the subgroup key -
        // which is fine because only subgroup members ever read it.
        //
        // A top-level Open folder is instead created Open (core
        // #2771) and never flipped. Created Restricted, core admits
        // the TEE with an op sealed under the subgroup key, and the
        // later Open flip cites it: a namespace member who is not in
        // the subgroup can read the flip but never its ancestry, so
        // it parks the flip - and every governance op after it in the
        // namespace. Born Open, that subgroup-key op never exists.
        // Nested folders keep the flip: they are created under the
        // root and reparented, and the parent may not be Open. Both
        // cases name their visibility rather than lean on core's
        // default.
        const bornOpen =
          input.parentGroupId === rootGroupId && input.visibility === 'Open';
        const group = await createGroupInNamespace(input.namespaceId, {
          visibility: bornOpen ? 'open' : 'restricted',
        });
        if (!group?.groupId) throw new Error('createGroupInNamespace returned no groupId');
        createdGroupId = group.groupId;
        const newId = group.groupId;

        if (input.parentGroupId !== rootGroupId) {
          // Through the session-aware admin: the node's `POST
          // /admin-api/groups/:child/reparent` on a node login, the account
          // admin's governance op on an account. (This used to be a raw
          // `fetch` with the node token read out of localStorage, from before
          // mero-js surfaced `reparentGroup`.)
          await admin.reparentGroup(newId, { newParentId: input.parentGroupId });
        }

        if (openChild) {
          await readOnlyRowsBeforeOpen(writer, input.parentGroupId, newId);
        }

        // Core expects lowercase `"open"` / `"restricted"`; see
        // `crates/server/src/admin/handlers/groups/set_subgroup_visibility.rs:31`
        // - capitalized values return 400 Bad Request.
        if (!bornOpen) {
          await setSubgroupVisibility(newId, {
            subgroupVisibility: input.visibility.toLowerCase(),
          });
        }

        // Now the name op encrypts on the namespace key chain for
        // Open subgroups; on the subgroup key for Restricted.
        // The colour rides in the same record, sealed with the name.
        await admin.setGroupMetadata(newId, {
          name: input.alias,
          data: input.color ? { [FOLDER_COLOR_KEY]: input.color } : {},
        });

        const ctx = await createContext({
          applicationId,
          groupId: newId,
          serviceName: DOCS_SERVICE_ID,
          initializationParams: [],
          // The folder's own name, on the context too. `listGroupContexts`
          // returns this label to every member of the subgroup.
          name: input.alias,
        });
        if (!ctx?.contextId) {
          throw new Error('createContext returned no contextId');
        }
        createdContextId = ctx.contextId;

        folderReady = true;
      } catch (err) {
        // Only genuine *creation-step* failures reach here (everything
        // up to and including the docs context). Roll back the
        // half-built folder, reversing creation order. Each cleanup is
        // try/catch-wrapped and logged so one cleanup failure doesn't
        // mask the original error - the caller still sees the real
        // cause via the outer rethrow.
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
      // which keeps it open with "Create" re-enabled - letting the user
      // resubmit and create a DUPLICATE folder. The folder is already
      // valid, so on failure we log loudly (the role must be a core
      // MemberRole variant - `Member`, not `member` - which silently
      // broke adds before) and let the dialog close. Missing members
      // can be re-added from the folder's sharing panel.
      if (folderReady && createdGroupId) {
        let failedMembers: string[] = [];
        if (input.members && input.members.length > 0) {
          try {
            await admin.addGroupMembers(createdGroupId, {
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
            failedMembers = input.members;
          }
        }
        if (openChild) {
          await inheritReadOnly(writer, input.parentGroupId, createdGroupId)
            .then((failed) => failed.length > 0 && toast.error(READ_ONLY_NOT_CARRIED))
            .catch((e) => {
              console.error('[create] Read only not carried into the new folder', e);
              toast.error(READ_ONLY_NOT_CARRIED);
            });
        }
        await refetch().catch((e) =>
          console.error('[create] post-create refetch failed', e),
        );
        return failedMembers;
      }
      // Unreachable in practice (a creation failure rethrows above), but
      // keeps the function total for TypeScript.
      throw new Error('folder creation did not complete');
    },
    [
      rootGroupId,
      applicationId,
      refetch,
      admin,
      createGroupInNamespace,
      setSubgroupVisibility,
      createContext,
      deleteContext,
      deleteGroup,
    ],
  );

  // Per hook instance, a concurrent call gets the first call's result (its
  // own input is dropped), so a double submit creates one folder.
  const create = useCallback(
    (input: CreateFolderInput): Promise<string[]> => {
      if (inFlightRef.current) return inFlightRef.current;
      const promise = createInternal(input).finally(() => {
        inFlightRef.current = null;
      });
      inFlightRef.current = promise;
      return promise;
    },
    [createInternal],
  );

  const rename = useCallback(
    async (folderId: string, alias: string) => {
      if (!admin) throw new Error('workspace not connected');
      // A metadata write replaces the whole record, so carry the colour over.
      const { metadata } = await admin.getGroupInfo(folderId);
      await admin.setGroupMetadata(folderId, {
        name: alias,
        data: metadata?.data ?? {},
      });
      await refetch();
    },
    [admin, refetch],
  );

  // Core deletes a folder's whole subtree in one op - every descendant group,
  // every context in them - Restricted descendants this caller cannot see
  // included, which no tree it could read would name.
  const remove = useCallback(
    async (folderId: string) => {
      await deleteGroup(folderId);
      await refetch();
    },
    [deleteGroup, refetch],
  );

  return { create, rename, remove };
}
