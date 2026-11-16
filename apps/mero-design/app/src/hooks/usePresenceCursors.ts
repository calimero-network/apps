import { useCallback, useEffect, useRef, useState } from "react";
import { presenceState, type PresenceEntry } from "@calimero-network/mero-js";
import { peekApi } from "../api/client";
import type { CursorState } from "../types";

/** The node drops an entry not refreshed for 7 s: a pointer that is set is sent again this often. */
export const HEARTBEAT_MS = 4_000;
/** At most one pointer update per this long. */
export const CURSOR_THROTTLE_MS = 2_500;
const RETRY_MS = 3_000;

/** What each device publishes: where its pointer is on the board. */
interface CursorSlice {
  x: number;
  y: number;
}

function encode(value: CursorSlice): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** A presence entry's state (hex of the bytes published) as a pointer, or null. */
export function decodeCursor(hex: string | null): CursorSlice | null {
  if (!hex || hex.length % 2 !== 0) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const v = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CursorSlice> | null;
    return v && typeof v.x === "number" && typeof v.y === "number" ? { x: v.x, y: v.y } : null;
  } catch {
    return null;
  }
}

/** The other devices' pointers, from presence entries keyed `account/device`. */
export function cursorsOf(entries: Iterable<PresenceEntry>, self: { account: string; device?: string }, now: number): CursorState[] {
  const out: CursorState[] = [];
  for (const e of entries) {
    if (e.account === self.account && (!self.device || e.device === self.device)) continue;
    const at = decodeCursor(e.state);
    if (at) out.push({ identity: `${e.account}/${e.device}`, account: e.account, x: at.x, y: at.y, updatedAt: now });
  }
  return out;
}

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Live pointers on a board, through the node's presence channel: ephemeral,
 * never part of the board's state. `move` is throttled; the pointer is sent
 * again every {@link HEARTBEAT_MS} while the tab is visible, and taken back
 * when the board closes.
 */
export function usePresenceCursors(app: string | null): {
  cursors: CursorState[];
  move: (x: number, y: number) => void;
} {
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const current = useRef<CursorSlice | null>(null);
  const seq = useRef(0);
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(
    (value: CursorSlice | null) => {
      const api = peekApi();
      if (!app || !api) return;
      seq.current += 1;
      api.client.apps
        .presencePublish({ app, seq: seq.current, state: presenceState(value === null ? null : encode(value)) })
        .catch(() => {})
        .finally(() => api.after());
    },
    [app],
  );

  const move = useCallback(
    (x: number, y: number) => {
      current.current = { x, y };
      if (throttle.current) return;
      throttle.current = setTimeout(() => {
        throttle.current = null;
        if (current.current) publish(current.current);
      }, CURSOR_THROTTLE_MS);
    },
    [publish],
  );

  // Heartbeat while a pointer is set and the tab is seen; retract on close.
  useEffect(() => {
    if (!app) return undefined;
    const timer = setInterval(() => {
      if (current.current && !hidden()) publish(current.current);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      if (throttle.current) clearTimeout(throttle.current);
      throttle.current = null;
      if (current.current) publish(null);
      current.current = null;
    };
  }, [app, publish]);

  // Everyone else's pointers.
  useEffect(() => {
    setCursors([]);
    const api = peekApi();
    if (!app || !api) return undefined;
    const ctrl = new AbortController();
    const self = { account: api.accountId };
    const entries = new Map<string, PresenceEntry>();
    const flush = () => setCursors(cursorsOf(entries.values(), self, Date.now()));
    void (async () => {
      while (!ctrl.signal.aborted) {
        try {
          for await (const event of api.client.presenceStream(app, ctrl.signal)) {
            if (event.kind === "snapshot") {
              entries.clear();
              for (const e of (event.data as PresenceEntry[]) ?? []) entries.set(`${e.account}/${e.device}`, e);
            } else {
              const e = event.data as PresenceEntry;
              if (e.state === null) entries.delete(`${e.account}/${e.device}`);
              else entries.set(`${e.account}/${e.device}`, e);
            }
            flush();
          }
        } catch {
          if (ctrl.signal.aborted) return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    })();
    return () => ctrl.abort();
  }, [app]);

  return { cursors, move };
}
