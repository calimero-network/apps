import { useCallback, useEffect, useRef, useState } from "react";
import type { SegmentView } from "./sylenceApi";
import { mergeSegments, PAGE, rangeToRead } from "./lib/transcript";
import type { Workspace } from "./useWorkspace";

/**
 * A meeting's transcript, read a page at a time (`transcript`'s `fromSeq` and
 * `next`), and kept live: a `TranscriptChanged` for this meeting re-reads just
 * the numbers it names (`rangeToRead`) and merges them in.
 */
export function useTranscript(workspace: Pick<Workspace, "client" | "subscribe">, meetingId: string) {
  const { client, subscribe } = workspace;
  const [segments, setSegments] = useState<SegmentView[]>([]);
  /** The next page's first number; `null` once the last page is in. */
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRef = useRef<number | null>(0);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    const from = nextRef.current;
    if (!client || from === null || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await client.transcript({ meetingId, fromSeq: from, limit: PAGE });
      setSegments((s) => mergeSegments(s, page.segments));
      nextRef.current = page.next;
      setNext(page.next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [client, meetingId]);

  useEffect(() => {
    nextRef.current = 0;
    setNext(0);
    setSegments([]);
    void loadMore();
  }, [loadMore]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.kind !== "TranscriptChanged" || event.data.meetingId !== meetingId || !client) return;
        const range = rangeToRead(event.data, nextRef.current);
        if (!range) return;
        void client
          .transcript({ meetingId, ...range })
          .then((page) => setSegments((s) => mergeSegments(s, page.segments)))
          .catch(() => undefined);
      }),
    [subscribe, client, meetingId],
  );

  /** Put a segment the screen just changed in place, without a re-read. */
  const replace = useCallback((segment: SegmentView) => setSegments((s) => mergeSegments(s, [segment])), []);

  return { segments, next, loading, error, loadMore, replace };
}
