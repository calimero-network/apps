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
 * At most {@link MAX_STREAMS} event streams are open at once, for the first apps
 * in the list (the screens put the open conversation first). A browser keeps
 * six connections to a node over HTTP/1.1, as a local node is reached, and an
 * open stream holds one: past that, every other call waits behind them. The
 * rest are checked every {@link POLL_MS} while the tab is visible, and a new
 * message there is reported as a `MessageSent` without a payload.
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
/**
 * Open event streams at most. With the workspace's presence stream and the open
 * conversation's, at least two of a browser's six connections to a node stay
 * free for calls.
 */
export const MAX_STREAMS = 2;
/** How often a conversation without a stream is checked for new messages. */
export const POLL_MS = 15_000;

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

/** The app's log head: the index of its newest entry. */
async function headOf(client: ClientRoutes<{ apps: "view" }>, app: string): Promise<number> {
  return (await client.apps.view({ app, method: "getMessageCount", args: {} })).index;
}

/**
 * Streams the first {@link MAX_STREAMS} apps in `apps` while signed in, and
 * checks the rest every {@link POLL_MS} (one call at a time, only while the
 * tab is visible); restarts a stream only when its app joins the first ones.
 */
export function useAppEvents(apps: string[], onEvent: (e: AppEvent) => void): void {
  const { isAuthenticated } = useCalimero();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const streams = useRef(new Map<string, AbortController>());
  const polled = useRef<string[]>([]);
  const heads = useRef(new Map<string, number>());

  useEffect(() => {
    const live = streams.current;
    const all = isAuthenticated ? [...new Set(apps.filter(Boolean))] : [];
    const wanted = new Set(all.slice(0, MAX_STREAMS));
    polled.current = all.slice(MAX_STREAMS);
    for (const [app, ctrl] of live) {
      if (!wanted.has(app)) {
        ctrl.abort();
        live.delete(app);
      }
    }
    for (const app of wanted) {
      heads.current.delete(app);
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
    if (!isAuthenticated) return;
    let busy = false;
    const tick = async () => {
      if (busy || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      busy = true;
      try {
        const client = getClient();
        for (const app of polled.current) {
          const head = await headOf(client, app).catch(() => null);
          if (head === null) continue;
          const seen = heads.current.get(app);
          heads.current.set(app, head);
          if (seen !== undefined && head > seen) onEventRef.current({ app, kind: "MessageSent" });
        }
      } catch {
        /* signed out or no client yet: the next tick tries again */
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(timer);
  }, [isAuthenticated]);

  useEffect(() => {
    const live = streams.current;
    return () => {
      for (const ctrl of live.values()) ctrl.abort();
      live.clear();
    };
  }, []);
}
