import { useEffect, useRef } from "react";
import { CalimeroError, type CalimeroClient } from "@calimero-network/mero-js";

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

/**
 * Follow the calendar's events (`client.events`): `onEvent` for each one the
 * node sends this account, `onReconnect` once the stream is followed again
 * after it dropped (what was missed in between is re-read there). Replaces
 * v1's SSE subscription to the context.
 *
 * The node answers the committed events first, then live ones; a reconnect
 * resumes after the last one seen (its `id` is its index). Callers coalesce
 * bursts (the history at open is one): every event only means "read again".
 *
 * When the node refuses the stream because the account lost access to the
 * calendar (removed from the team, the calendar deleted), it is not followed
 * again: `onLost` runs once, for the page to close the calendar.
 */
export function useAppEvents(
  client: Pick<CalimeroClient, "events"> | null,
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
          if (dropped) onReconnectRef.current?.();
          for await (const event of client.events(app, from, abort.signal)) {
            const index = Number(event.id);
            if (Number.isFinite(index)) from = index + 1;
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
