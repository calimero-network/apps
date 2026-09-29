import { listMembers } from './groupMembers';

// Core keeps a member's direct folder rows when they leave the workspace, so
// a workspace removal clears them here. Returns the folders it could not.
export async function removeFromFolders(
  admin: {
    listGroupMembers(groupId: string): Promise<unknown>;
    removeGroupMembers(groupId: string, request: { members: string[] }): Promise<void>;
  },
  folders: readonly string[],
  account: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const folder of folders) {
    try {
      if (!(await listMembers(admin, folder)).some((m) => m.identity === account)) continue;
      await admin.removeGroupMembers(folder, { members: [account] });
    } catch (e: unknown) {
      console.warn('[removeFromFolders] not removed', folder, e);
      failed.push(folder);
    }
  }
  return failed;
}
