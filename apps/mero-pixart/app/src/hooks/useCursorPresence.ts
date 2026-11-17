import { useCallback, useEffect, useRef, useState } from "react";
import { presenceState, type CalimeroClient, type PresenceEntry } from "@calimero-network/mero-js";

import type { CursorState } from "../types";

/**
 * Remote cursors over the node's presence channel (`presencePublish`,
 * `presenceStream`): ephemeral, never part of the document, so moving a
 * pointer writes nothing to the contract and creates no event.
 *
 * Your cursor is sent at most every {@link SEND_MS}, the last position of a
 * burst included. The node forgets an entry not refreshed for 7 s, so a
 * cursor that stands still is refreshed every {@link HEARTBEAT_MS}, until it
 * has been idle {@link IDLE_MS} (or the tab is hidden): then it is taken back
 * and nothing more is sent until it moves.
 */
export const SEND_MS = 250;
export const HEARTBEAT_MS = 4_000;
export const IDLE_MS = 10_000;
const RETRY_MS = 3_000;

interface Slice {
  x: number;
  y: number;
}

function encode(value: Slice): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** A presence entry's state (hex of the bytes published) as a cursor, or `null`. */
export function decodeCursor(hex: string | null): Slice | null {
  if (!hex || hex.length % 2) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const v = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Slice> | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: Number(v.x), y: Number(v.y) } : null;
  } catch {
    return null;
  }
}

/** One cursor per account (the newest of its devices), others only. */
export function cursorsOf(entries: Iterable<PresenceEntry>, self: string, seen: Map<string, number>): CursorState[] {
  const byAccount = new Map<string, CursorState>();
  for (const e of entries) {
    if (e.account === self) continue;
    const slice = decodeCursor(e.state);
    if (!slice) continue;
    const updatedAt = seen.get(`${e.account}/${e.device}`) ?? Date.now();
    const prev = byAccount.get(e.account);
    if (!prev || prev.updatedAt <= updatedAt) byAccount.set(e.account, { identity: e.account, ...slice, updatedAt });
  }
  return [...byAccount.values()];
}

export function useCursorPresence(
  client: Pick<CalimeroClient, "apps" | "presenceStream"> | null,
  app: string | null,
  self: string,
): { cursors: CursorState[]; moveCursor: (x: number, y: number) => void } {
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const current = useRef<Slice | null>(null);
  const sent = useRef<Slice | null>(null);
  const lastSent = useRef(0);
  const lastMove = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const publish = useCallback(
    (value: Slice | null) => {
      if (!client || !app) return;
      seq.current += 1;
      lastSent.current = Date.now();
      sent.current = value;
      client.apps
        .presencePublish({ app, seq: seq.current, state: presenceState(value === null ? null : encode(value)) })
        .catch(() => {
          /* presence is advisory: the next move or heartbeat sends it again */
        });
    },
    [client, app],
  );

  const moveCursor = useCallback(
    (x: number, y: number) => {
      current.current = { x: Math.round(x), y: Math.round(y) };
      lastMove.current = Date.now();
      if (trailing.current) return;
      const wait = SEND_MS - (Date.now() - lastSent.current);
      if (wait <= 0) {
        publish(current.current);
        return;
      }
      trailing.current = setTimeout(() => {
        trailing.current = null;
        if (current.current) publish(current.current);
      }, wait);
    },
    [publish],
  );

  // Refresh a standing cursor; take it back once idle or hidden, and on leave.
  useEffect(() => {
    if (!client || !app) return undefined;
    const retract = () => {
      if (sent.current !== null) publish(null);
      current.current = null;
    };
    const timer = setInterval(() => {
      if (!current.current) return;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (hidden || Date.now() - lastMove.current > IDLE_MS) retract();
      else if (Date.now() - lastSent.current >= HEARTBEAT_MS) publish(current.current);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      if (trailing.current) {
        clearTimeout(trailing.current);
        trailing.current = null;
      }
      retract();
    };
  }, [client, app, publish]);

  // Everyone else's cursors.
  useEffect(() => {
    setCursors([]);
    if (!client || !app) return undefined;
    const ctrl = new AbortController();
    const entries = new Map<string, PresenceEntry>();
    const seen = new Map<string, number>();
    const flush = () => setCursors(cursorsOf(entries.values(), self, seen));
    const put = (e: PresenceEntry) => {
      const key = `${e.account}/${e.device}`;
      if (e.state === null) {
        entries.delete(key);
        seen.delete(key);
        return;
      }
      if (entries.get(key)?.state !== e.state) seen.set(key, Date.now());
      entries.set(key, e);
    };
    void (async () => {
      while (!ctrl.signal.aborted) {
        try {
          for await (const event of client.presenceStream(app, ctrl.signal)) {
            if (event.kind === "snapshot") {
              entries.clear();
              for (const e of (event.data as PresenceEntry[]) ?? []) put(e);
            } else {
              put(event.data as PresenceEntry);
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
  }, [client, app, self]);

  return { cursors, moveCursor };
}
