/**
 * Live events of the conversations the screens subscribe to, one stream per
 * app instance (`CalimeroClient.events`). Replaces mero-react's
 * `useSubscription` over v1's node SSE.
 *
 * A stream starts after the app's current log index (what a view answers), so
 * it carries what happens from now on; the screens read history themselves. A
 * dropped stream reconnects from the entry after the last one it saw, and
 * reports the reconnect (`connectEvents`), on which the screens re-read what
 * is on screen.
 *
 * Each event's `data` is put back in v1's payload shape, which the handlers
 * decode (`bytesParser` + `JSON.parse`): `{ message_id }` for a sent message,
 * the bare message id for an edit or a reaction, the account for a profile or
 * role change.
 */
import { useEffect, useRef } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";

import { connectEvents, getClient, setOnline, useCalimero } from "./calimero";
import { type ClientRoutes } from "@calimero-apps/connect";

export interface AppEvent {
  /** The app instance (v1: context) it happened in. */
  app: string;
  kind: string;
  /** v1's payload, as a JSON string (what `bytesParser` passes through). */
  data?: string;
}

const RETRY_MS = 2_000;

/** v1's payload for a component event. */
export function v1Payload(kind: string, data: unknown): string | undefined {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "MessageSent":
    case "MessageSentThread":
      return JSON.stringify({ message_id: String(d.messageId ?? "") });
    case "MessageEdited":
    case "ReactionUpdated":
      return JSON.stringify(String(d.messageId ?? ""));
    case "ProfileUpdated":
    case "RoleUpdated":
      return JSON.stringify(String(d.account ?? ""));
    default:
      return undefined;
  }
}

/** The log index an event id (`"<index>:<seq>"`) names. */
export function indexOf(id: string): number | null {
  const n = Number.parseInt(id.split(":")[0] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Streams `app`'s events to `onEvent` until `signal` aborts, reconnecting
 * after a drop.
 */
export async function streamApp(
  client: Pick<CalimeroClient, "events"> & ClientRoutes<{ apps: "view" }>,
  app: string,
  onEvent: (e: AppEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let from: number | null = null;
  let connected = false;
  while (!signal.aborted) {
    try {
      if (from === null) {
        const head = await client.apps.view({ app, method: "getMessageCount", args: {} });
        from = head.index + 1;
      }
      const stream = client.events(app, from, signal);
      if (connected) connectEvents.emit(app);
      connected = true;
      setOnline(true);
      for await (const event of stream) {
        const at = indexOf(event.id);
        if (at !== null) from = at + 1;
        onEvent({ app, kind: event.kind, data: v1Payload(event.kind, event.data) });
      }
    } catch {
      if (signal.aborted) return;
      setOnline(false);
    }
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

/** Streams every app in `apps` while signed in; restarts a stream only when its app joins the list. */
export function useAppEvents(apps: string[], onEvent: (e: AppEvent) => void): void {
  const { isAuthenticated } = useCalimero();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const streams = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const live = streams.current;
    const wanted = new Set(isAuthenticated ? apps.filter(Boolean) : []);
    for (const [app, ctrl] of live) {
      if (!wanted.has(app)) {
        ctrl.abort();
        live.delete(app);
      }
    }
    for (const app of wanted) {
      if (live.has(app)) continue;
      let client: CalimeroClient;
      try {
        client = getClient();
      } catch {
        continue;
      }
      const ctrl = new AbortController();
      live.set(app, ctrl);
      void streamApp(client, app, (e) => onEventRef.current(e), ctrl.signal);
    }
  }, [apps, isAuthenticated]);

  useEffect(() => {
    const live = streams.current;
    return () => {
      for (const ctrl of live.values()) ctrl.abort();
      live.clear();
    };
  }, []);
}
