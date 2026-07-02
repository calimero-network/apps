/**
 * How long (ms of LOCAL time) a call participant may show no sign of life
 * before the client treats them as a ghost.
 *
 * "Sign of life" is deliberately broad — a moving presence timestamp, an
 * inbound signal, or connected media (see useCall). An earlier version
 * compared `now - presence.updatedAt` across MACHINES, which broke two ways:
 * clock skew between laptops made healthy peers look 60s stale, and a peer
 * whose window was minimized (WKWebView throttles JS timers → heartbeats stop
 * while WebRTC media keeps flowing) was "dead" by presence while actively
 * signaling us — so we tore down every handshake they attempted, in a loop.
 */
export const GHOST_SILENCE_MS = 60_000;

export interface RosterPartition {
  /** Participants to keep peer connections + tiles for. */
  live: string[];
  /** Participants with no observed sign of life past GHOST_SILENCE_MS. */
  ghosts: string[];
}

export interface LivenessView {
  /** The contract's call_participants roster. */
  roster: string[];
  selfId: string;
  /** Local clock (Date.now()). */
  nowMs: number;
  /**
   * Last LOCAL time each member showed any sign of life: their presence
   * `updatedAt` moved (any change — we never compare their clock to ours),
   * or a signal arrived from them. Callers seed first-sighting so a truly
   * dead ghost still expires GHOST_SILENCE_MS after we first observe it.
   */
  lastAliveMs: ReadonlyMap<string, number>;
  /** Peers whose RTCPeerConnection is currently "connected" — media beats
   *  every other liveness source. */
  connected: ReadonlySet<string>;
}

/** Split the call roster into live peers and ghosts, by observed liveness. */
export function partitionRoster(view: LivenessView): RosterPartition {
  const live: string[] = [];
  const ghosts: string[] = [];
  for (const id of view.roster) {
    if (id === view.selfId || view.connected.has(id)) {
      live.push(id);
      continue;
    }
    const seen = view.lastAliveMs.get(id);
    // Unknown = just discovered; the caller seeds lastAliveMs on first
    // sighting, so this stays live and the ghost clock starts now.
    if (seen === undefined || view.nowMs - seen <= GHOST_SILENCE_MS) live.push(id);
    else ghosts.push(id);
  }
  return { live, ghosts };
}
