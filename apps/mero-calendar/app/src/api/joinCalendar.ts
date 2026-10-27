import { isNamespaceJustJoined } from '@calimero-apps/cloud';

/** How long to keep joining a calendar of a team this node has only just joined. */
export const CALENDAR_JOIN_SYNC_MS = 90_000;
/**
 * How long to keep joining any other calendar before giving up. The team page
 * clears the just-joined flag as soon as the calendar LIST has arrived, so a
 * calendar opened from it right after the join is usually joined with the flag
 * already off, while the calendar itself is still on its way to this node.
 */
export const CALENDAR_JOIN_SETTLE_MS = 20_000;
const CALENDAR_JOIN_RETRY_MS = 3_000;

/**
 * Join a team calendar, retrying a refused join before calling it an error.
 *
 * Right after an invitation is accepted the node is in the team but often does
 * not hold a calendar's context yet, so it refuses the join and accepts it
 * seconds later. A refused join is retried every few seconds: for up to
 * CALENDAR_JOIN_SYNC_MS while the team is flagged just-joined, else for up to
 * CALENDAR_JOIN_SETTLE_MS. A join still refused after the window throws its
 * last error.
 */
export async function joinCalendarWithRetry(
  join: () => Promise<unknown>,
  teamId: string | null,
  isCancelled: () => boolean,
): Promise<void> {
  let deadline: number | null = null;
  for (;;) {
    try {
      await join();
      return;
    } catch (e) {
      // Decided once, on the first refusal: the window then runs its course
      // even if the flag is cleared while we wait.
      deadline ??=
        Date.now() +
        (isNamespaceJustJoined(teamId)
          ? CALENDAR_JOIN_SYNC_MS
          : CALENDAR_JOIN_SETTLE_MS);
      if (isCancelled() || Date.now() >= deadline) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, CALENDAR_JOIN_RETRY_MS));
    if (isCancelled()) throw new Error('cancelled');
  }
}
