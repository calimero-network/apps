// Writes a folder role to core and the registry, for one folder or for a
// folder's whole subtree: Read only on a folder covers every sub-folder the
// member reaches, and core reads only the direct row of each folder's group.

import { HTTPError, type AdminApiClient } from '@calimero-network/mero-js';
import { FolderId, type RegistryClient } from '@/generated/registry/RegistryClient';
import {
  FOLDER_ROLE_GRANTS,
  isTeeRole,
  parseGroupRole,
  type FolderAccessRole,
  type GroupRole,
} from './roles';
import { openConnected, type OpenFolder } from '@/utils/ancestry';

export interface FolderRoleWriter {
  admin: Pick<
    AdminApiClient,
    | 'listGroupMembers'
    | 'updateMemberRole'
    | 'addGroupMembers'
    | 'setMemberCapabilities'
    | 'getMemberCapabilities'
  >;
  registry: Pick<RegistryClient, 'setFolderRole' | 'getFolderRole'>;
}

/** `account`'s role in the folder's effective member list, or null if absent. */
export async function coreRoleIn(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
): Promise<GroupRole | null> {
  const row = (await writer.admin.listGroupMembers(folder)).members.find(
    (m) => m.identity === account,
  );
  return row ? parseGroupRole(row.role) : null;
}

/** Sets the core role. A member who only inherits an Open folder has no
 *  direct row: Read only adds one, and anything else has nothing to change,
 *  which returns false (a Member row there would escape a Read only parent). */
export async function setCoreRole(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
  role: GroupRole,
): Promise<boolean> {
  try {
    await writer.admin.updateMemberRole(folder, account, { role });
    return true;
  } catch (e: unknown) {
    if (!(e instanceof HTTPError && e.status === 404)) throw e;
    if (role !== 'ReadOnly') return false;
    // A row another admin adds meanwhile is overwritten by this upsert, with the role we want.
    await writer.admin.addGroupMembers(folder, {
      members: [{ identity: account, role }],
    });
    return true;
  }
}

/** A folder role's three writes, core first. Read only always writes the core row (an
 *  inheritor is listed with its anchor's role); false when there was no row to change. */
export async function applyFolderGrant(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
  next: FolderAccessRole,
  current: GroupRole,
): Promise<boolean> {
  const grant = FOLDER_ROLE_GRANTS[next];
  if (grant.coreRole === 'ReadOnly' || grant.coreRole !== current) {
    if (!(await setCoreRole(writer, folder, account, grant.coreRole)))
      return false;
  }
  await writer.registry.setFolderRole({
    folder_id: FolderId(folder),
    member: account,
    role: grant.role,
  });
  await writer.admin.setMemberCapabilities(folder, account, {
    capabilities: grant.folderCaps,
  });
  return true;
}

/**
 * Carries Read only, or its end, into each of `folders` (parents first) the
 * member reaches: Read only everywhere, Editor where they are listed Read only.
 * Returns the folders it could not change.
 */
export async function applyAcross(
  writer: FolderRoleWriter,
  folders: readonly string[],
  account: string,
  readOnly: boolean,
): Promise<string[]> {
  const failed: string[] = [];
  for (const folder of folders) {
    try {
      const role = await coreRoleIn(writer, folder, account);
      if (role === null || role === 'Admin' || isTeeRole(role)) continue;
      if (!readOnly && role !== 'ReadOnly') continue;
      await applyFolderGrant(
        writer,
        folder,
        account,
        readOnly ? 'ReadOnly' : 'Editor',
        role,
      );
    } catch (e: unknown) {
      console.warn('[applyAcross] folder role not applied', folder, e);
      failed.push(folder);
    }
  }
  return failed;
}

async function readOnlyIn(
  admin: FolderRoleWriter['admin'],
  parent: string,
): Promise<string[]> {
  const { members } = await admin.listGroupMembers(parent);
  return members
    .filter((m) => parseGroupRole(m.role) === 'ReadOnly')
    .map((m) => m.identity);
}

/** A folder takes Read only from its parent: every member core ReadOnly in
 *  `parent` who reaches `folder` is made Read only there too. */
export async function inheritReadOnly(
  writer: FolderRoleWriter,
  parent: string,
  folder: string,
): Promise<string[]> {
  const readOnly = await readOnlyIn(writer.admin, parent);
  const failed: string[] = [];
  for (const account of readOnly) {
    if (await holdsReadOnly(writer, folder, account)) continue;
    if ((await applyAcross(writer, [folder], account, true)).length > 0)
      failed.push(account);
  }
  return failed;
}

/** Opening `folder` also opens the way to its Open sub-folders, so `folder` and
 *  each of them, parents first, takes Read only from the folder above it.
 *  Returns the accounts it could not change, and the sub-folders of unknown visibility. */
export async function inheritReadOnlyDown(
  writer: FolderRoleWriter,
  folders: OpenFolder[],
  folder: string,
  parent: string,
): Promise<string[]> {
  const { open, unknown } = openConnected(folders, folder);
  const failed = [...unknown];
  for (const id of [folder, ...open]) {
    const above =
      id === folder ? parent : folders.find((f) => f.id === id)?.parent_id;
    if (above) failed.push(...(await inheritReadOnly(writer, above, id)));
  }
  return failed;
}

// Caps are kept on a direct row only, so the grant's caps prove the row is
// there rather than inherited from the parent.
async function holdsReadOnly(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
) {
  const grant = FOLDER_ROLE_GRANTS.ReadOnly;
  if ((await coreRoleIn(writer, folder, account)) !== 'ReadOnly') return false;
  const { capabilities } = await writer.admin.getMemberCapabilities(
    folder,
    account,
  );
  if (capabilities !== grant.folderCaps) return false;
  return (
    (await writer.registry.getFolderRole({
      folder_id: FolderId(folder),
      member: account,
    })) === grant.role
  );
}

/** Before a new folder under `parent` turns Open: a direct ReadOnly row, with
 *  the grant's caps, for each person `parent` holds Read only, so the folder
 *  is never Open without them. The registry rows follow once it is bound. */
export async function readOnlyRowsBeforeOpen(
  writer: FolderRoleWriter,
  parent: string,
  folder: string,
): Promise<void> {
  const readOnly = (await readOnlyIn(writer.admin, parent)).map((identity) => ({
    identity,
    role: 'ReadOnly' as const,
  }));
  if (readOnly.length === 0) return;
  await writer.admin.addGroupMembers(folder, { members: readOnly });
  for (const { identity } of readOnly) {
    await writer.admin.setMemberCapabilities(folder, identity, {
      capabilities: FOLDER_ROLE_GRANTS.ReadOnly.folderCaps,
    });
  }
}
