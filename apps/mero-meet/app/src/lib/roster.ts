import type { Presence } from "../types";

/**
 * How long (seconds) a call participant's presence may go un-heartbeated before
 * the CLIENT treats them as a ghost. 2× the contract's 30s TTL — gossip lag or
 * a couple of missed beats must never drop a live peer (that bug cancelled
 * handshakes mid-flight and no call ever connected).
 */
export const GHOST_STALE_SECS = 60;

export interface RosterPartition {
  /** Participants to keep peer connections + tiles for. */
  live: string[];
  /** Participants with positive evidence of death (stale presence row). */
  ghosts: string[];
}

/**
 * Split the call roster into live peers and ghosts.
 *
 * The rules are deliberately asymmetric:
 * - self is always live;
 * - a participant with NO presence row is live — their join simply hasn't
 *   gossiped to us yet (dropping them tore down handshakes mid-flight);
 * - a participant whose presence row EXISTS but has been silent past
 *   {@link GHOST_STALE_SECS} is a ghost — they crashed or closed the window
 *   without leave_call. The contract reaps them server-side on any member's
 *   heartbeat; this filter covers rooms still on an older contract and the
 *   window until that reap gossips in.
 */
export function partitionRoster(
  roster: string[],
  presence: Map<string, Presence>,
  selfId: string,
  nowSecs: number,
): RosterPartition {
  const live: string[] = [];
  const ghosts: string[] = [];
  for (const id of roster) {
    if (id === selfId) {
      live.push(id);
      continue;
    }
    const p = presence.get(id);
    if (p && nowSecs - p.updatedAt > GHOST_STALE_SECS) ghosts.push(id);
    else live.push(id);
  }
  return { live, ghosts };
}
