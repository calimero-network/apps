import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMaybeSignedIn } from "../sessionContext";
import { ForumClient, type CommentView, type PostView } from "./forumApi";
import { getContextId } from "./session";

/** The forum open in this browser: an app instance id (v1's context id). */
export function useForumContext(): { contextId: string | null; loading: boolean } {
  const [contextId, setContextId] = useState<string | null>(getContextId);
  // `setActiveForum` writes synchronously and the pages navigate straight after,
  // so a re-read on mount is enough.
  useEffect(() => {
    setContextId(getContextId());
  }, []);
  return { contextId, loading: false };
}

/** The signed-in ACCOUNT: who the contract records as the author. */
export function useSelfAccount(): string | null {
  return useMaybeSignedIn()?.accountId ?? null;
}

/** The open forum's typed client (answers in the shapes the screens use). */
export function useForumClient(): ForumClient | null {
  const signedIn = useMaybeSignedIn();
  const { contextId } = useForumContext();
  const client = signedIn?.client;
  const after = signedIn?.after;
  return useMemo(
    () => (client && contextId ? new ForumClient(client, contextId, after) : null),
    [client, contextId, after],
  );
}

/**
 * Calls `onChange` (at most every 250 ms) for each event of the open forum, so
 * a peer's post or reply shows without a refresh. Events carry ids only; the
 * screens re-read what they show.
 */
export function useForumEvents(onChange: (kind: string) => void): void {
  const signedIn = useMaybeSignedIn();
  const { contextId } = useForumContext();
  const client = signedIn?.client;
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!client || !contextId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        for await (const event of client.events(contextId, 0, abort.signal)) {
          clearTimeout(timer);
          timer = setTimeout(() => latest.current(event.kind), 250);
        }
      } catch {
        // Stream closed (sign-out, forum left, network): the next action re-reads.
      }
    })();
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [client, contextId]);
}

export type Sort = "new" | "top";

/**
 * The feed, one page at a time.
 *
 * Cursor-based, because the contract pages by keyset: an offset shifts the
 * moment a peer's post replicates in, so scrolling would skip and repeat rows.
 * `hasMore` follows `next_cursor` rather than the page length — a page can be
 * short and still have more behind it once deleted rows are filtered out.
 */
export function useFeed(client: ForumClient | null, sort: Sort) {
  const [items, setItems] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a scroll event firing a second fetch while one is in
  // flight, which would append the same page twice.
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (!client || inFlight.current || !hasMore) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await client.listPosts({ sort, cursor, limit: 20 });
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.next_cursor ?? null);
      setHasMore(page.next_cursor != null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [client, sort, cursor, hasMore]);

  const reset = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setError(null);
  }, []);

  /**
   * Read the first page again, replacing what is shown. For a feed whose first
   * read came back empty, or failed, before the node had the forum's state:
   * `reset` alone does not re-run that read when nothing it keys on changes.
   */
  const reload = useCallback(async () => {
    if (!client || inFlight.current) return;
    inFlight.current = true;
    try {
      const page = await client.listPosts({ sort, cursor: null, limit: 20 });
      setItems(page.items);
      setCursor(page.next_cursor ?? null);
      setHasMore(page.next_cursor != null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }, [client, sort]);

  // Changing the sort restarts the feed: a cursor from one ordering means
  // nothing in the other.
  useEffect(() => {
    reset();
  }, [sort, reset]);

  useEffect(() => {
    if (client && items.length === 0 && hasMore && !loading) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, items.length, hasMore]);

  return { items, loadMore, hasMore, loading, error, reset, reload, setItems };
}

/** Comments on one post, same paging contract as the feed. */
export function useComments(
  client: ForumClient | null,
  postId: string | undefined,
) {
  const [items, setItems] = useState<CommentView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (!client || !postId || inFlight.current || !hasMore) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await client.listComments({
        post_id: postId,
        cursor,
        limit: 20,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.items.filter((c) => !seen.has(c.id))];
      });
      setCursor(page.next_cursor ?? null);
      setHasMore(page.next_cursor != null);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [client, postId, cursor, hasMore]);

  const reload = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(true);
  }, []);

  useEffect(() => {
    if (client && postId && items.length === 0 && hasMore && !loading)
      void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, postId, items.length, hasMore]);

  return { items, loadMore, hasMore, loading, reload, setItems };
}

/**
 * The contract stamps posts and comments in MILLISECONDS. v1 stamped
 * nanoseconds; anything past 10^14 cannot be a millisecond time, so it is
 * scaled down (harmless for the component contract's own stamps).
 */
export function toMs(t: number): number {
  return t > 1e14 ? Math.floor(t / 1e6) : t;
}

/** The full local date and time of a contract timestamp. */
export function fullDate(t: number): string {
  return new Date(toMs(t)).toLocaleString();
}

/** "3h ago" — short, and stable enough not to need a ticking clock. */
export function timeAgo(t: number, now: number = Date.now()): string {
  const ms = toMs(t);
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** @deprecated Use `authorLabel` from lib/nickname — it prefers the chosen name
 *  and flags an id fallback instead of passing an id off as one. */
export { shortAccount as shortAuthor } from "./nickname";
