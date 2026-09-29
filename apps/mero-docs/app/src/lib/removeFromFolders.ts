import { listMembers } from './groupMembers';
import { depthOf, type FolderLite } from '@/utils/ancestry';

// Core keeps a member's direct folder rows when they leave the workspace, so a
// workspace removal clears them here. Parents go first, so by the time a folder
// is read an inherited listing has gone with its parent's row, and only direct
// rows are removed: a removal from an Open folder is a ban there.
// Returns the folders it could not clear.
export async function removeFromFolders(
  admin: {
    listGroupMembers(groupId: string): Promise<unknown>;
    removeGroupMembers(
      groupId: string,
      request: { members: string[] },
    ): Promise<void>;
  },
  folders: FolderLite[],
  account: string,
): Promise<string[]> {
  const parentsFirst = [...folders].sort(
    (a, b) => depthOf(folders, a.id) - depthOf(folders, b.id),
  );
  const failed: string[] = [];
  for (const { id } of parentsFirst) {
    try {
      if (!(await listMembers(admin, id)).some((m) => m.identity === account))
        continue;
      await admin.removeGroupMembers(id, { members: [account] });
    } catch (e: unknown) {
      console.warn('[removeFromFolders] not removed', id, e);
      failed.push(id);
    }
  }
  return failed;
}
