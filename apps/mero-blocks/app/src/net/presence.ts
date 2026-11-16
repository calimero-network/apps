// Where every player stands, over the world's ephemeral presence channel
// (`/apps/{app}/presence`): never stored, never in the log, so walking around
// is not a contract call. Each device holds one entry (JSON, at most 4 KiB);
// the newest `seq` wins, and an entry not refreshed within 7 s is gone.

import { presenceState, type CalimeroClient, type PresenceEntry } from "@calimero-network/mero-js";
import type { ClientRoutes } from "@calimero-apps/connect";

import type { PresenceChannel, RemotePlayer, Transform } from "./sync";

/** How long to wait before re-opening a dropped presence stream. */
const RECONNECT_MS = 1500;

type PresenceClient = Pick<CalimeroClient, "presenceStream"> & ClientRoutes<{ apps: "presencePublish" }>;

/** What one device publishes: its avatar id and transform. */
export interface PresenceSlice extends Transform {
  id: string;
}

export function encodeSlice(slice: PresenceSlice | null): Uint8Array | null {
  return slice ? new TextEncoder().encode(JSON.stringify(slice)) : null;
}

/** An entry's `state` (hex) back to a slice; `null` when retracted or not a slice. */
export function decodeSlice(hex: string | null | undefined): PresenceSlice | null {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PresenceSlice> | null;
    if (!v || typeof v.id !== "string" || !v.id) return null;
    const nums = [v.x, v.y, v.z, v.yaw, v.pitch];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return {
      id: v.id,
      name: typeof v.name === "string" ? v.name.slice(0, 64) : "",
      x: v.x!,
      y: v.y!,
      z: v.z!,
      yaw: v.yaw!,
      pitch: v.pitch!,
      sel: typeof v.sel === "number" ? v.sel : 0,
    };
  } catch {
    return null;
  }
}

function entriesOf(kind: string, data: unknown): PresenceEntry[] {
  if (kind === "snapshot") {
    const list = Array.isArray(data) ? data : (data as { present?: unknown } | null)?.present;
    return Array.isArray(list) ? (list as PresenceEntry[]) : [];
  }
  if (kind === "presence" && data && typeof data === "object") return [data as PresenceEntry];
  return [];
}

/** The world at instance `app`'s presence channel, through `client`. */
export function worldPresence(client: PresenceClient, app: string): PresenceChannel {
  // A seq that only grows, across reloads too: the newest one wins.
  let seq = 0;
  let inFlight = false;
  let queued: { slice: PresenceSlice | null } | null = null;
  const send = (slice: PresenceSlice | null) => {
    if (inFlight) {
      queued = { slice };
      return;
    }
    inFlight = true;
    seq = Math.max(seq + 1, Date.now() * 1000);
    void client.apps
      .presencePublish({ app, seq, state: presenceState(encodeSlice(slice)) })
      .catch(() => {
        /* a dropped frame is replaced by the next one */
      })
      .finally(() => {
        inFlight = false;
        const next = queued;
        queued = null;
        if (next) send(next.slice);
      });
  };

  return {
    publish: send,
    subscribe(onPlayers) {
      const abort = new AbortController();
      void (async () => {
        while (!abort.signal.aborted) {
          const present = new Map<string, RemotePlayer>();
          try {
            for await (const event of client.presenceStream(app, abort.signal)) {
              if (event.kind === "snapshot") present.clear();
              for (const entry of entriesOf(event.kind, event.data)) {
                const key = `${entry.account}:${entry.device}`;
                const slice = decodeSlice(entry.state);
                if (slice) present.set(key, { ...slice, online: true });
                else present.delete(key);
              }
              onPlayers([...present.values()]);
            }
          } catch {
            /* dropped (network, node restart): opened again below */
          }
          if (abort.signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
        }
      })();
      return () => abort.abort();
    },
  };
}
