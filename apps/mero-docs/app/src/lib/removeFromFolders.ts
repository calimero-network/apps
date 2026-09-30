import type { AdminApiClient } from '@calimero-network/mero-js';
import { depthOf, type FolderLite } from '@/utils/ancestry';

type MemberAdmin = Pick<AdminApiClient, 'listGroupMembers' | 'removeGroupMembers'>;

// Removes `account` from each of `ids` that lists them; returns the ones it could not clear.
export async function removeWhereListed(
  admin: MemberAdmin,
  ids: readonly string[],
  account: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      const { members } = await admin.listGroupMembers(id);
      if (!members.some((m) => m.identity === account)) continue;
      await admin.removeGroupMembers(id, { members: [account] });
    } catch (e: unknown) {
      console.warn('[removeFromFolders] not removed', id, e);
      failed.push(id);
    }
  }
  return failed;
}

// Core keeps a member's direct folder rows when they leave the workspace, so a
// workspace removal clears them here. Parents go first, so by the time a folder
// is read an inherited listing has gone with its parent's row, and only direct
// rows are removed: a removal from an Open folder is a ban there.
// Returns the folders it could not clear.
export function removeFromFolders(
  admin: MemberAdmin,
  folders: FolderLite[],
  account: string,
): Promise<string[]> {
  const parentsFirst = [...folders].sort(
    (a, b) => depthOf(folders, a.id) - depthOf(folders, b.id),
  );
  return removeWhereListed(
    admin,
    parentsFirst.map((f) => f.id),
    account,
  );
}
