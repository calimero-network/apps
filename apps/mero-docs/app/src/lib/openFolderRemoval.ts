// Core ends a removal at the group it names: an Open sub-folder that let the
// person in through this folder keeps letting them in by inheritance, and a
// direct row there (left by Read only) survives outright. From an Open
// folder, core records the removal as a ban that only an admin add lifts.

import { CAPABILITIES, hasCap } from '@/constants/config';
import {
  applyAcross,
  coreRoleIn,
  type FolderRoleWriter,
} from './applyFolderRole';
import { listMembers } from './groupMembers';
import { isTeeRole, parseGroupRole } from './roles';

interface OpenFolder {
  id: string;
  parent_id: string | null;
  visibility?: 'Open' | 'Restricted';
}

interface Admin {
  listGroupMembers(groupId: string): Promise<unknown>;
  removeGroupMembers(
    groupId: string,
    request: { members: string[] },
  ): Promise<void>;
  getMemberCapabilities(
    groupId: string,
    member: string,
  ): Promise<{ capabilities?: number }>;
}

/** The Open sub-folders reached through `folder`, parents first; a
 *  Restricted sub-folder walls off everything below it. */
function openConnected(folders: OpenFolder[], folder: string): string[] {
  const out: string[] = [];
  const queue = [folder];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const f of folders) {
      if (
        f.parent_id !== parent ||
        f.visibility !== 'Open' ||
        out.includes(f.id)
      )
        continue;
      out.push(f.id);
      queue.push(f.id);
    }
  }
  return out;
}

/** After a removal from `folder`, takes `account` out of each Open sub-folder
 *  reached through it that still lists them. Returns those it could not. */
export async function clearOpenSubtree(
  admin: Admin,
  folders: OpenFolder[],
  folder: string,
  account: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const id of openConnected(folders, folder)) {
    try {
      if ((await listMembers(admin, id)).some((m) => m.identity === account)) {
        await admin.removeGroupMembers(id, { members: [account] });
      }
    } catch (e: unknown) {
      console.warn('[clearOpenSubtree] not removed', id, e);
      failed.push(id);
    }
  }
  return failed;
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
    (await listMembers(admin, folder)).map((m) => m.identity),
  );
  const removed: string[] = [];
  for (const m of await listMembers(admin, parent)) {
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
 *  writable here, and then gets the rest of the grant; a shortfall throws. */
export async function restoreTo(
  writer: FolderRoleWriter,
  parent: string,
  folder: string,
  account: string,
): Promise<void> {
  const readOnly = (await coreRoleIn(writer, parent, account)) === 'ReadOnly';
  // An admin add is what clears the ban; one another admin sets meanwhile is lifted with it.
  await writer.admin.addGroupMembers(folder, {
    members: [{ identity: account, role: readOnly ? 'ReadOnly' : 'Member' }],
  });
  if (readOnly && (await applyAcross(writer, [folder], account, true)).length > 0) {
    throw new Error('restored, but Read only could not be finished here');
  }
}
