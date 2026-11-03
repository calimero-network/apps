import { useEffect, useRef } from "react";
import { peekApi } from "../api/client";

/** How long to wait before opening the stream again after it dropped. */
const RETRY_MS = 2000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * Live events for one board: the app instance's committed events
 * (`client.events`), each handed to `onEvent` as `{ events: [{ kind, data }] }`,
 * the shape `utils/boardEvents` folds.
 *
 * The stream starts after the entry a view of the board answered at, so it
 * replays nothing the page's own first read already has. A stream that drops
 * (the cluster restarted, the laptop slept) is opened again; every event from
 * the gap is lost, so `onReconnect` asks the page to re-read the board.
 */
export function useSse(
  contextId: string | null,
  onEvent: (payload: unknown) => void,
  onReconnect?: () => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const api = peekApi();
  const client = api?.client ?? null;

  useEffect(() => {
    if (!contextId || !client) return;
    const ctl = new AbortController();
    let first = true;

    void (async () => {
      while (!ctl.signal.aborted) {
        try {
          // Where the board is now: the stream starts after it.
          const { index } = await client.view(contextId, "getBoard", {});
          if (!first) onReconnectRef.current?.();
          first = false;
          for await (const ev of client.events(contextId, index + 1, ctl.signal)) {
            onEventRef.current({ events: [{ kind: ev.kind, data: ev.data }] });
          }
        } catch (err) {
          if (ctl.signal.aborted) return;
          console.warn("[MeroDesign] event stream dropped (will reconnect):", (err as Error)?.message ?? err);
        }
        await sleep(RETRY_MS, ctl.signal);
      }
    })();

    return () => ctl.abort();
  }, [contextId, client]);
}
