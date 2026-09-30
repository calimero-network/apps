// Core ends a removal at the group it names: an Open sub-folder that let the
// person in through this folder keeps letting them in by inheritance, and a
// direct row there (left by Read only) survives outright. From an Open
// folder, core records the removal as a ban that only an admin add lifts.

import type { AdminApiClient } from '@calimero-network/mero-js';
import { CAPABILITIES, hasCap } from '@/constants/config';
import {
  applyAcross,
  coreRoleIn,
  type FolderRoleWriter,
} from './applyFolderRole';
import { removeWhereListed } from './removeFromFolders';
import { openConnected, type OpenFolder } from '@/utils/ancestry';
import { isTeeRole, parseGroupRole } from './roles';

type Admin = Pick<
  AdminApiClient,
  'listGroupMembers' | 'removeGroupMembers' | 'getMemberCapabilities'
>;

/** After a removal from `folder`, takes `account` out of each Open sub-folder
 *  reached through it that still lists them. Returns those it could not. */
export async function clearOpenSubtree(
  admin: Admin,
  folders: OpenFolder[],
  folder: string,
  account: string,
): Promise<string[]> {
  const { open, unknown } = openConnected(folders, folder);
  return [...unknown, ...(await removeWhereListed(admin, open, account))];
}

/** Parent members who could join the Open `folder` but are not in it: removed.
 *  Only a direct parent row with CAN_JOIN_OPEN_SUBGROUPS counts, so a member
 *  who could never join (a Guest) is not offered back. */
export async function removedFrom(
  admin: Admin,
  parent: string,
  folder: string,
): Promise<string[]> {
  const inFolder = new Set(
    (await admin.listGroupMembers(folder)).members.map((m) => m.identity),
  );
  const removed: string[] = [];
  for (const m of (await admin.listGroupMembers(parent)).members) {
    const role = parseGroupRole(m.role);
    if (inFolder.has(m.identity) || role === 'Admin' || isTeeRole(role))
      continue;
    const { capabilities } = await admin.getMemberCapabilities(
      parent,
      m.identity,
    );
    if (hasCap(capabilities ?? 0, CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS))
      removed.push(m.identity);
  }
  return removed;
}

/** Lifts this folder's ban on `account` (each sub-folder keeps its own). A
 *  person the parent holds Read only is added as ReadOnly, so they are never
 *  writable here, then Read only is written here and in the Open sub-folders
 *  that let them back in; a shortfall throws. */
export async function restoreTo(
  writer: FolderRoleWriter,
  folders: OpenFolder[],
  parent: string,
  folder: string,
  account: string,
): Promise<void> {
  const readOnly = (await coreRoleIn(writer, parent, account)) === 'ReadOnly';
  // An admin add is what clears the ban; one another admin sets meanwhile is lifted with it.
  await writer.admin.addGroupMembers(folder, {
    members: [{ identity: account, role: readOnly ? 'ReadOnly' : 'Member' }],
  });
  if (!readOnly) return;
  // A folder that does not list them (a ban there) is skipped by applyAcross.
  const { open, unknown } = openConnected(folders, folder);
  const failed = [
    ...unknown,
    ...(await applyAcross(writer, [folder, ...open], account, true)),
  ];
  if (failed.length > 0)
    throw new Error('restored, but Read only could not be finished everywhere');
}
