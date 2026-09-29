// Core records a removal from an Open folder as a ban on that folder alone:
// its Open sub-folders still let the member inherit in, and only an admin add
// on the folder lifts it. These keep a removal and its restore subtree-wide.

import { CAPABILITIES, hasCap } from '@/constants/config';
import { descendantsOf } from '@/utils/ancestry';
import { listMembers } from './groupMembers';
import { parseGroupRole } from './roles';

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
  addGroupMembers(
    groupId: string,
    request: { members: { identity: string; role: 'Member' }[] },
  ): Promise<void>;
  getMemberCapabilities(
    groupId: string,
    member: string,
  ): Promise<{ capabilities?: number }>;
}

const openBelow = (folders: OpenFolder[], folder: string) =>
  descendantsOf(folders, folder)
    .reverse()
    .filter((id) => folders.find((f) => f.id === id)?.visibility === 'Open');

const lists = async (admin: Admin, folder: string, account: string) =>
  (await listMembers(admin, folder)).some((m) => m.identity === account);

/** Bans `account` from each Open sub-folder of `folder` that still lists them. */
export async function banAcrossOpenSubtree(
  admin: Admin,
  folders: OpenFolder[],
  folder: string,
  account: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const id of openBelow(folders, folder)) {
    try {
      if (await lists(admin, id, account))
        await admin.removeGroupMembers(id, { members: [account] });
    } catch (e: unknown) {
      console.warn('[banAcrossOpenSubtree] not removed', id, e);
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
    if (inFolder.has(m.identity) || parseGroupRole(m.role) === 'Admin')
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

/** Lets `account` back into `folder` and the Open sub-folders that dropped them. */
export async function restoreAcrossOpenSubtree(
  admin: Admin,
  folders: OpenFolder[],
  folder: string,
  account: string,
): Promise<string[]> {
  const add = (id: string) =>
    admin.addGroupMembers(id, {
      members: [{ identity: account, role: 'Member' }],
    });
  await add(folder);
  const failed: string[] = [];
  for (const id of openBelow(folders, folder)) {
    try {
      if (!(await lists(admin, id, account))) await add(id);
    } catch (e: unknown) {
      console.warn('[restoreAcrossOpenSubtree] not restored', id, e);
      failed.push(id);
    }
  }
  return failed;
}
