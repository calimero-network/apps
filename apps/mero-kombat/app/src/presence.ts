import { presenceState, type CalimeroClient, type PresenceEntry } from "@calimero-network/mero-js";
import { type ClientRoutes } from "@calimero-apps/connect";

/**
 * Movement over the node's ephemeral presence channel (`/apps/{app}/presence`):
 * never stored, never in the log. Each device holds one entry per app; the
 * newest `seq` wins, and an entry not refreshed within 7 s is gone. The fight
 * publishes a slice 15 times a second while it runs, which is its heartbeat.
 *
 * v1 sent the same slices through mero-react's `ephemeral.set/subscribe`; the
 * slice format (`game/controller.ts`, `Slice`) is unchanged.
 */

/** A value as presence carries it: JSON, UTF-8, at most 4 KiB. */
export function encodeState(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** An entry's `state` (hex of what `encodeState` wrote) back to its value; `null` when absent or unreadable. */
export function decodeState<T>(hex: string | null | undefined): T | null {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

type PresenceClient = Pick<CalimeroClient, "presenceStream"> & ClientRoutes<{ apps: "presencePublish" }>;

/**
 * Fire-and-forget publishing: one request in flight, and only the newest
 * slice waits behind it (an older one is worthless by the time it would go).
 * `onSent` counts frames for the meter.
 */
export function presencePublisher(client: PresenceClient, app: string, onSent: () => void = () => {}) {
  let seq = 0;
  let inFlight = false;
  let queued: unknown | undefined;
  const send = (value: unknown) => {
    if (inFlight) {
      queued = value;
      return;
    }
    inFlight = true;
    seq += 1;
    onSent();
    client.apps
      .presencePublish({ app, seq, state: presenceState(encodeState(value)) as unknown as string })
      .catch(() => {
        /* a dropped frame is replaced 66 ms later */
      })
      .finally(() => {
        inFlight = false;
        const next = queued;
        queued = undefined;
        if (next !== undefined) send(next);
      });
  };
  return send;
}

function entriesOf(kind: string, data: unknown): PresenceEntry[] {
  if (kind === "snapshot") {
    const list = Array.isArray(data) ? data : (data as { present?: unknown } | null)?.present;
    return Array.isArray(list) ? (list as PresenceEntry[]) : [];
  }
  if (kind === "presence" && data && typeof data === "object") return [data as PresenceEntry];
  return [];
}

/**
 * Every present value in `app` (the snapshot, then each change), decoded,
 * until the returned stop. Retracted and unreadable entries are skipped; the
 * caller tells its own slices apart by their content (a slice names its seat).
 */
export function subscribePresence<T>(
  client: PresenceClient,
  app: string,
  handler: (value: T, entry: PresenceEntry) => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    try {
      for await (const event of client.presenceStream(app, abort.signal)) {
        for (const entry of entriesOf(event.kind, event.data)) {
          const value = decodeState<T>(entry.state);
          if (value !== null) handler(value, entry);
        }
      }
    } catch {
      // Stream closed (sign-out, arena left, network): the fight shows the
      // opponent as away, and the contract's figures still settle the bars.
    }
  })();
  return () => abort.abort();
}
