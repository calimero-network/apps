// Maps the workspace-wide load error (see useDriveWorkspace) to plain,
// user-facing copy. The raw error can come from several internal fetches
// (registry, subgroups, members) and its message is implementation detail;
// callers should log the raw error to the console and show this instead.

const PERMISSION_PATTERN = /not a member|permission|forbidden/i;
const CONNECTION_PATTERN = /network|fetch|ECONNREFUSED|timeout|HTTP 5/i;

export function folderLoadErrorMessage(error: Error): string {
  if (PERMISSION_PATTERN.test(error.message)) {
    return "You don't have access to this workspace's folders.";
  }
  if (CONNECTION_PATTERN.test(error.message)) {
    return "Couldn't reach your node. Check your connection and try again.";
  }
  return "Couldn't load your folders. Try refreshing the page.";
}
