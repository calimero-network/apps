// The workspace's folders, read from core alone.
//
// A folder is a subgroup of the workspace's namespace, nested by core's tree;
// its name and colour are the subgroup's metadata and its docs context is the
// one context in the subgroup. Nothing about a folder is kept in the
// namespace-wide registry: every workspace member replicates that context, so
// a Restricted folder's name, colour, parent, docs context and roles would be
// on the disk of people never invited to it. Core's subgroup metadata of a
// Restricted folder is sealed under the subgroup's own key, and core lists a
// Restricted subgroup only to its members and to the admins above it.

import type { AdminApiClient } from '@calimero-network/mero-js';

/** Where a folder's colour lives in its subgroup metadata's `data` map. */
export const FOLDER_COLOR_KEY = 'color';

export interface CoreFolder {
  id: string;
  /** The folder above, or null for a top-level one and for a Shared one. */
  parent_id: string | null;
  color: string | null;
  /** The subgroup's metadata name; null when it has none. */
  alias: string | null;
  /** The folder's docs context; null until one reaches this node. */
  context_id: string | null;
  visibility: 'Open' | 'Restricted' | undefined;
  /** Reached through a context this node holds rather than through the tree:
   *  the caller was added to it but cannot see the folder above it. */
  shared: boolean;
}

export type FolderReader = Pick<
  AdminApiClient,
  'listSubgroups' | 'getGroupInfo' | 'listGroupContexts' | 'getContextsForApplication'
>;

/** A folder's docs context: the one context in its subgroup, or null. */
export async function folderDocsContext(
  admin: Pick<AdminApiClient, 'listGroupContexts'>,
  folderId: string,
): Promise<string | null> {
  const contexts = await admin.listGroupContexts(folderId);
  return contexts[0]?.contextId ?? null;
}

function visibilityOf(raw: string | undefined): CoreFolder['visibility'] {
  if (raw === 'open' || raw === 'Open') return 'Open';
  if (raw === 'restricted' || raw === 'Restricted') return 'Restricted';
  return undefined;
}

// A subgroup's description, or null when core refuses it to this caller.
async function describe(
  admin: FolderReader,
  id: string,
  parent: string | null,
  shared: boolean,
): Promise<{ folder: CoreFolder; namespaceId: string | undefined } | null> {
  const [info, context] = await Promise.all([
    admin.getGroupInfo(id).catch(() => null),
    folderDocsContext(admin, id).catch(() => null),
  ]);
  if (!info) return null;
  const color = info.metadata?.data?.[FOLDER_COLOR_KEY];
  return {
    namespaceId: info.namespaceId,
    folder: {
      id,
      parent_id: parent,
      color: color ? color : null,
      alias: info.metadata?.name || null,
      context_id: context,
      visibility: visibilityOf(info.subgroupVisibility),
      shared,
    },
  };
}

/**
 * Every folder of the workspace rooted at `rootId` this caller can see.
 *
 * The tree is walked from the root one level at a time: core lists a
 * subgroup's Open children to anyone and its Restricted ones only to their
 * members and the admins above. A Restricted folder under a parent the caller
 * cannot see is found instead through its docs context, which a member's node
 * holds; it comes back `shared`, with no parent, and its own subtree is walked
 * from there.
 */
export async function loadCoreFolders(
  admin: FolderReader,
  rootId: string,
  applicationId: string | null,
): Promise<CoreFolder[]> {
  const found = new Map<string, CoreFolder>();
  const seen = new Set<string>([rootId]);

  // Walks down from each of `starts`, describing every child it reaches.
  const walk = async (starts: string[]) => {
    let level = starts;
    while (level.length > 0) {
      const children = await Promise.all(
        level.map(async (parent) =>
          (await admin.listSubgroups(parent).catch(() => [])).map((c) => ({
            id: c.groupId,
            parent: parent === rootId ? null : parent,
          })),
        ),
      );
      const next = children.flat().filter(({ id }) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const described = await Promise.all(
        next.map(({ id, parent }) => describe(admin, id, parent, false)),
      );
      level = [];
      for (const d of described) {
        if (!d) continue;
        found.set(d.folder.id, d.folder);
        level.push(d.folder.id);
      }
    }
  };

  await walk([rootId]);

  if (applicationId) {
    const { contexts } = await admin
      .getContextsForApplication(applicationId)
      .catch(() => ({ contexts: [] }));
    const candidates = [
      ...new Set(
        contexts
          .map((c) => c.groupId)
          .filter((g): g is string => !!g && !seen.has(g)),
      ),
    ];
    for (const g of candidates) seen.add(g);
    const described = await Promise.all(
      candidates.map((id) => describe(admin, id, null, true)),
    );
    const shared: string[] = [];
    for (const d of described) {
      // Another workspace's folder, or the root itself, is not ours to list.
      if (!d || d.namespaceId !== rootId) continue;
      found.set(d.folder.id, d.folder);
      shared.push(d.folder.id);
    }
    await walk(shared);
  }

  return [...found.values()];
}
