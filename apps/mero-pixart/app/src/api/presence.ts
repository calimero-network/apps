import type { CalimeroClient, PresenceEntry } from "@calimero-network/mero-js";

import type { CursorState } from "../types";

/**
 * Live pointers, on the node's presence channel (`publishPresence`,
 * `presenceStream`).
 *
 * v1 wrote every pointer move into the document (`update_cursor` into an
 * `Authored` map keyed by device, read back with `get_cursors`): a replicated
 * write per move, kept forever. On 1.0 a pointer is presence: one entry per
 * device and app, at most 4 KiB, gone 7 s after its last refresh, never in the
 * app's log. The entry is `{ "x": …, "y": … }` as UTF-8 JSON, hex on the wire.
 */

type PresenceClient = Pick<CalimeroClient, "publishPresence" | "presenceStream">;

/** How often an unchanged pointer is sent again, under the node's 7 s sweep. */
export const HEARTBEAT_MS = 5_000;

export function encodeCursor(x: number, y: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
}

/** A presence entry's hex state as a pointer, or null for anything else. */
export function decodeCursor(hex: string | null | undefined): { x: number; y: number } | null {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as { x?: unknown; y?: unknown };
    return typeof v.x === "number" && typeof v.y === "number" ? { x: v.x, y: v.y } : null;
  } catch {
    return null;
  }
}

/**
 * Publishes this device's pointer. `seq` only grows, across reloads too (the
 * node drops anything at or below the highest it saw), so it is seeded from
 * the clock.
 */
export function cursorPublisher(client: PresenceClient, app: string) {
  let seq = 0;
  return (x: number, y: number): Promise<void> => {
    seq = Math.max(seq + 1, Date.now() * 1000);
    return client.publishPresence(app, seq, encodeCursor(x, y));
  };
}

/** Folds one presence entry into the pointer list (`null` state: the device left). */
export function applyEntry(cursors: CursorState[], entry: PresenceEntry, now = Date.now()): CursorState[] {
  const rest = cursors.filter((c) => !(c.identity === entry.account && c.device === entry.device));
  const at = decodeCursor(entry.state);
  if (!at) return rest;
  return [...rest, { identity: entry.account, device: entry.device, x: at.x, y: at.y, updatedAt: now }];
}

/** Every pointer in `app`, as it changes, until the returned stop. */
export function subscribeCursors(
  client: PresenceClient,
  app: string,
  onChange: (update: (prev: CursorState[]) => CursorState[]) => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    try {
      for await (const event of client.presenceStream(app, abort.signal)) {
        if (event.kind === "snapshot" && Array.isArray(event.data)) {
          const entries = event.data as PresenceEntry[];
          onChange(() => entries.reduce<CursorState[]>((acc, e) => applyEntry(acc, e), []));
        } else if (event.kind === "presence" && event.data && typeof event.data === "object") {
          const entry = event.data as PresenceEntry;
          onChange((prev) => applyEntry(prev, entry));
        }
      }
    } catch {
      // Closed (sign-out, project left, network): pointers simply stop moving.
    }
  })();
  return () => abort.abort();
}
