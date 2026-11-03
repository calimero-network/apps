import { useEffect, useRef } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";

import { useSignedIn } from "../api/sessionContext";

/** How long to wait before following the stream again after it ended or failed. */
const RECONNECT_MS = 2_000;

/**
 * Follow the document's events (`client.events`): `onEvent` for each one,
 * `onReconnect` once the stream is followed again after it dropped (whatever
 * changed in between is re-read there). Replaces v1's SSE subscription to the
 * context; the name stays so the editor did not change.
 *
 * The node answers the committed events first, then live ones; a reconnect
 * resumes after the last one seen (its `id` is its log index). Callers coalesce
 * bursts (the history at open is one): every event only means "read again".
 */
export function useSse(
  contextId: string | null,
  onEvent: (payload: unknown) => void,
  onReconnect?: () => void,
) {
  const { client } = useSignedIn();
  useAppEvents(client, contextId, (_kind, data) => onEvent(data), onReconnect);
}

export function useAppEvents(
  client: Pick<CalimeroClient, "events"> | null,
  app: string | null,
  onEvent: (kind: string, data: unknown) => void,
  onReconnect?: () => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

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
          console.warn("[MeroPixArt] event stream dropped (will reconnect):", err);
        }
        dropped = true;
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    })();

    return () => abort.abort();
  }, [client, app]);
}
