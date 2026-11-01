import type { CalimeroClient, PresenceEntry } from "@calimero-network/mero-js";

/**
 * The node's ephemeral presence channel (`/apps/{app}/presence`), as a lossy
 * datagram pipe for media (approach 1).
 *
 * v1 used mero-js's `ephemeral.set/subscribe` on a 0.x node (16 KiB slices,
 * `ageMs` on a replayed entry). On 1.0 each device holds ONE entry per app:
 * the newest `seq` wins, an entry is at most 4 KiB (`PRESENCE_MAX_BYTES`), it
 * is gone 7 s after its last refresh, and every change reaches every
 * subscriber as one `presence` event. The framing in `ephemeralFrames.ts`
 * (per-sender `msgSeq`, fragment index/count) is what makes a register work
 * as a pipe; it is unchanged.
 */

type PresenceClient = Pick<CalimeroClient, "publishPresence" | "presenceStream">;

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** An entry's `state` back to bytes; `null` when absent or not hex. */
export function fromHex(hex: string | null | undefined): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/**
 * A publisher whose `seq` only grows, across reloads too: the node keeps the
 * highest seq it saw from this device for the entry's 7 s life, and drops
 * anything at or below it, so a counter restarting at 1 after a reload would
 * be silently ignored. Seeded from the clock (microseconds, still far below
 * 2^53).
 */
export function presencePublisher(client: PresenceClient, app: string) {
  let seq = 0;
  return (state: Uint8Array): Promise<void> => {
    seq = Math.max(seq + 1, Date.now() * 1000);
    return client.publishPresence(app, seq, state);
  };
}

export interface PresenceUpdate {
  account: string;
  device: string;
  /** `null`: the author left (retracted, or swept after 7 s). */
  state: Uint8Array | null;
}

/**
 * Every LIVE change in `app` until the returned stop. The opening `snapshot`
 * is skipped on purpose: it is each author's current entry, up to 7 s old,
 * and for media a stale frame is worse than none (v1 skipped entries carrying
 * `ageMs` for the same reason).
 */
export function subscribePresence(
  client: PresenceClient,
  app: string,
  handler: (update: PresenceUpdate) => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    try {
      for await (const event of client.presenceStream(app, abort.signal)) {
        if (event.kind !== "presence" || !event.data || typeof event.data !== "object") continue;
        const entry = event.data as PresenceEntry;
        handler({
          account: entry.account,
          device: entry.device,
          state: entry.state === null ? null : fromHex(entry.state),
        });
      }
    } catch {
      // Closed (sign-out, call left, network): tiles time out on their own.
    }
  })();
  return () => abort.abort();
}
