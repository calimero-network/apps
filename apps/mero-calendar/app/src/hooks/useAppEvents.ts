import { useEffect, useRef } from "react";
import { CalimeroError, type CalimeroClient } from "@calimero-network/mero-js";
import type { ClientRoutes } from "@calimero-apps/connect";

/** How long to wait before following the stream again after it ended or failed. */
const RECONNECT_MS = 2_000;

/** What a change re-reads: the calendar's events, its members, or both. */
export interface Changed {
  events: boolean;
  members: boolean;
}

/**
 * What an event of `kind` changed (the contract's `Event`): a calendar event's
 * create, edit or delete re-reads the events, a member's join or rename the
 * members. Anything else (a reconnect, a kind this build does not know)
 * re-reads both.
 */
export function changedBy(kind: string | null): Changed {
  if (kind?.startsWith("CalendarEvent")) return { events: true, members: false };
  if (kind?.startsWith("Member")) return { events: false, members: true };
  return { events: true, members: true };
}

/** Whether the node refused the stream because this account may no longer read the calendar. */
export function accessLost(error: unknown): boolean {
  return error instanceof CalimeroError && (error.status === 403 || error.status === 404);
}

/** The log index an event id (`"<index>:<seq>"`) names. */
export function indexOf(id: string): number | null {
  const n = Number.parseInt(id.split(":")[0] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

/** A small view whose answer carries the calendar's log head (`index`). */
const HEAD_VIEW = "getMembers";

/**
 * Follow the calendar's events (`client.events`): `onEvent` for each one the
 * node sends this account, `onReconnect` once the stream is followed again
 * after it dropped (what was missed in between is re-read there). Replaces
 * v1's SSE subscription to the context.
 *
 * The stream starts after the log's head (a view's `index`), so it carries
 * what happens from now on: the page has read the calendar itself, and
 * replaying the whole log on every open would re-read it again. A reconnect
 * resumes after the last event seen. Callers coalesce bursts: every event
 * only means "read again".
 *
 * When the node refuses the stream because the account lost access to the
 * calendar (removed from the team, the calendar deleted), it is not followed
 * again: `onLost` runs once, for the page to close the calendar.
 */
export function useAppEvents(
  client: (Pick<CalimeroClient, "events"> & ClientRoutes<{ apps: "view" }>) | null,
  app: string | null,
  onEvent: (kind: string, data: unknown) => void,
  onReconnect?: () => void,
  onLost?: () => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;

  useEffect(() => {
    if (!client || !app) return;
    const abort = new AbortController();
    let from: number | undefined;
    let dropped = false;

    (async () => {
      while (!abort.signal.aborted) {
        try {
          if (from === undefined) {
            const head = await client.apps.view({ app, method: HEAD_VIEW, args: {} }, { signal: abort.signal });
            from = (head.index ?? -1) + 1;
          }
          if (dropped) onReconnectRef.current?.();
          for await (const event of client.events(app, from, abort.signal)) {
            const index = indexOf(event.id);
            if (index !== null) from = index + 1;
            onEventRef.current(event.kind, event.data);
          }
        } catch (err) {
          if (abort.signal.aborted) return;
          if (accessLost(err)) {
            onLostRef.current?.();
            return;
          }
          console.warn("[MeroCalendar] event stream dropped (will reconnect):", err);
        }
        dropped = true;
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    })();

    return () => abort.abort();
  }, [client, app]);
}
