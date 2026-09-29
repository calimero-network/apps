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

export interface FolderRoleWriter {
  admin: {
    listGroupMembers(groupId: string): Promise<unknown>;
    updateMemberRole(groupId: string, identity: string, request: { role: GroupRole }): Promise<void>;
    addGroupMembers(
      groupId: string,
      request: { members: { identity: string; role: GroupRole }[] },
    ): Promise<void>;
    setMemberCapabilities(
      groupId: string,
      identity: string,
      request: { capabilities: number },
    ): Promise<void>;
  };
  registry: {
    setFolderRole(params: { folder_id: FolderId; member: string; role: Role }): Promise<void>;
  };
}

// Some node versions wrap the list in `data`, as useFolderMembership notes.
async function membersOf(
  writer: FolderRoleWriter,
  group: string,
): Promise<{ identity: string; role?: string }[]> {
  const raw = (await writer.admin.listGroupMembers(group)) as {
    members?: { identity: string; role?: string }[];
    data?: { identity: string; role?: string }[];
  };
  return raw.members ?? raw.data ?? [];
}

/** `account`'s role in the folder's effective member list, or null if absent. */
export async function coreRoleIn(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
): Promise<GroupRole | null> {
  const row = (await membersOf(writer, folder)).find((m) => m.identity === account);
  return row ? parseGroupRole(row.role) : null;
}

/** Sets the core role; a member who only inherits an Open folder has no
 *  direct row to update, and gets one. */
export async function setCoreRole(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
  role: GroupRole,
): Promise<void> {
  try {
    await writer.admin.updateMemberRole(folder, account, { role });
  } catch (e: unknown) {
    if (!(e instanceof HTTPError && e.status === 404)) throw e;
    await writer.admin.addGroupMembers(folder, { members: [{ identity: account, role }] });
  }
}

/** The three writes of a folder role, core first because core enforces it. */
export async function applyFolderGrant(
  writer: FolderRoleWriter,
  folder: string,
  account: string,
  next: FolderAccessRole,
  current: GroupRole,
): Promise<void> {
  const grant = FOLDER_ROLE_GRANTS[next];
  if (grant.coreRole !== current) await setCoreRole(writer, folder, account, grant.coreRole);
  await writer.registry.setFolderRole({ folder_id: FolderId(folder), member: account, role: grant.role });
  await writer.admin.setMemberCapabilities(folder, account, { capabilities: grant.folderCaps });
}

/**
 * Carries Read only, or its end, into each of `folders` the member reaches:
 * Read only where they are not already, Editor where they are Read only.
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
      if (readOnly === (role === 'ReadOnly')) continue;
      await applyFolderGrant(writer, folder, account, readOnly ? 'ReadOnly' : 'Editor', role);
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
  const readOnly = (await membersOf(writer, parent))
    .filter((m) => parseGroupRole(m.role) === 'ReadOnly')
    .map((m) => m.identity);
  const failed: string[] = [];
  for (const account of readOnly) {
    if ((await applyAcross(writer, [folder], account, true)).length > 0) failed.push(account);
  }
  return failed;
}
