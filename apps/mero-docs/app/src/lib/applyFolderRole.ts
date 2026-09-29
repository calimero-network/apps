// Writes a folder role to core and the registry, for one folder or for a
// folder's whole subtree: Read only on a folder covers every sub-folder the
// member reaches, and core reads only the direct row of each folder's group.

import { HTTPError } from '@calimero-network/mero-js';
import { FolderId, type Role } from '@/generated/registry/RegistryClient';
import {
  FOLDER_ROLE_GRANTS,
  isTeeRole,
  parseGroupRole,
  type FolderAccessRole,
  type GroupRole,
} from './roles';
import { listMembers } from './groupMembers';

export interface FolderRoleWriter {
  admin: {
    listGroupMembers(groupId: string): Promise<unknown>;
    updateMemberRole(
      groupId: string,
      identity: string,
      request: { role: GroupRole },
    ): Promise<void>;
    addGroupMembers(
      groupId: string,
      request: { members: { identity: string; role: GroupRole }[] },
    ): Promise<void>;
    setMemberCapabilities(
      groupId: string,
      identity: string,
      request: { capabilities: number },
    ): Promise<void>;
    getMemberCapabilities(
      groupId: string,
      member: string,
    ): Promise<{ capabilities?: number }>;
  };
  registry: {
    setFolderRole(params: {
      folder_id: FolderId;
      member: string;
      role: Role;
    }): Promise<void>;
    getFolderRole(params: {
      folder_id: FolderId;
      member: string;
    }): Promise<Role>;
  };
}

/** `account`'s role in the folder's effective member list, or null if absent. */
export async function coreRoleIn(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
): Promise<GroupRole | null> {
  const row = (await listMembers(writer.admin, folder)).find(
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

/** The three writes of a folder role, core first because core enforces it.
 *  Read only always writes the core row: an inheritor is listed with its anchor
 *  row's role, but core refuses writes by the direct row alone. */
export async function applyFolderGrant(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
  next: FolderAccessRole,
  current: GroupRole,
): Promise<void> {
  const grant = FOLDER_ROLE_GRANTS[next];
  if (grant.coreRole === 'ReadOnly' || grant.coreRole !== current) {
    if (!(await setCoreRole(writer, folder, account, grant.coreRole))) return;
  }
  await writer.registry.setFolderRole({
    folder_id: FolderId(folder),
    member: account,
    role: grant.role,
  });
  await writer.admin.setMemberCapabilities(folder, account, {
    capabilities: grant.folderCaps,
  });
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

/** A folder takes Read only from its parent: every member core ReadOnly in
 *  `parent` who reaches `folder` is made Read only there too. */
export async function inheritReadOnly(
  writer: FolderRoleWriter,
  parent: string,
  folder: string,
): Promise<string[]> {
  const readOnly = (await listMembers(writer.admin, parent))
    .filter((m) => parseGroupRole(m.role) === 'ReadOnly')
    .map((m) => m.identity);
  const failed: string[] = [];
  for (const account of readOnly) {
    if (await holdsReadOnly(writer, folder, account)) continue;
    if ((await applyAcross(writer, [folder], account, true)).length > 0)
      failed.push(account);
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
