import { isNamespaceJustJoined } from "@calimero-network/mero-react";

/** How long to keep reading a project of a team this node has only just joined. */
export const PROJECT_SYNC_MS = 90_000;
/**
 * How long to keep reading any other project before calling it unreadable.
 * The team page clears the just-joined flag as soon as the project LIST has
 * loaded, so a project opened from it right after the join is usually read
 * with the flag already off, while its own data is still on the way.
 */
export const PROJECT_SETTLE_MS = 20_000;
const PROJECT_RETRY_MS = 3_000;

/**
 * Read the project, retrying a failed read before calling it an error.
 *
 * Right after an invitation is accepted the node is in the team but often does
 * not hold the project's data yet, so the first read fails and the data lands
 * seconds later. A failed read is retried every few seconds: for up to
 * PROJECT_SYNC_MS while the team is flagged just-joined, else for up to
 * PROJECT_SETTLE_MS (the flag is usually gone by the time a project is opened
 * from the team page). A project that really cannot be read waits that short
 * window before its error. `onSyncing` is called when the retrying starts; a
 * read that still fails after the window throws its last error.
 */
export async function readProjectWithJoinRetry<T>(
  read: () => Promise<T>,
  namespaceId: string | null,
  isCancelled: () => boolean,
  onSyncing?: () => void,
): Promise<T> {
  let deadline: number | null = null;
  for (;;) {
    try {
      return await read();
    } catch (e) {
      if (deadline === null) {
        // Decided once, on the first failure: the window then runs its course
        // even if the flag is cleared while we wait.
        deadline =
          Date.now() +
          (isNamespaceJustJoined(namespaceId) ? PROJECT_SYNC_MS : PROJECT_SETTLE_MS);
        onSyncing?.();
      }
      if (isCancelled() || Date.now() >= deadline) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, PROJECT_RETRY_MS));
    if (isCancelled()) throw new Error("cancelled");
  }
}
