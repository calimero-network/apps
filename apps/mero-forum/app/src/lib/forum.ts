import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";

import { useForumWorkspace } from "./workspace";
import { ForumClient } from "../generated/ForumClient";
import type { CommentView, PostView } from "../generated/ForumClient";

/**
 * The forum this node is a member of. One context == one forum.
 *
 * ⚠️ Delegates to `useForumWorkspace`, which scopes discovery to THIS
 * application. This function used to be `getContexts().contexts[0]` — the first
 * context on the node, whatever app it belonged to. On a node running more than
 * one Calimero app that is somebody else's context, and every forum call
 * against it came back `FunctionCallError`, because the method does not exist
 * on that contract. It also had no way to create one, so a fresh node was a
 * permanently empty feed.
 */
export function useForumContext(): { contextId: string | null; loading: boolean } {
  const { contextId, loading } = useForumWorkspace();
  return { contextId, loading };
}

/**
 * A typed client, or null until the node AND this node's identity in the
 * context have resolved.
 *
 * ⚠️ The executor is the identity this node OWNS in the context, not the
 * account id. Both are 64 hex characters since rc.27, so passing the wrong one
 * type-checks, sends, and comes back rejected as an unauthorized signer.
 */
export function useForumClient(): ForumClient | null {
  const { mero } = useMero();
  const { contextId } = useForumContext();
  const [executor, setExecutor] = useState<string | null>(null);

  useEffect(() => {
    if (!mero || !contextId) {
      setExecutor(null);
      return;
    }
    let cancelled = false;
    mero.admin
      .getContextIdentitiesOwned(contextId)
      .then(({ identities }) => {
        if (!cancelled && identities.length > 0) setExecutor(identities[0]);
      })
      .catch(() => !cancelled && setExecutor(null));
    return () => {
      cancelled = true;
    };
  }, [mero, contextId]);

  return useMemo(
    () => (mero && contextId && executor ? new ForumClient(mero, contextId, executor) : null),
    [mero, contextId, executor],
  );
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

  // Changing the sort restarts the feed: a cursor from one ordering means
  // nothing in the other.
  useEffect(() => {
    reset();
  }, [sort, reset]);

  useEffect(() => {
    if (client && items.length === 0 && hasMore && !loading) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, items.length, hasMore]);

  return { items, loadMore, hasMore, loading, error, reset, setItems };
}

/** Comments on one post, same paging contract as the feed. */
export function useComments(client: ForumClient | null, postId: string | undefined) {
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
      const page = await client.listComments({ post_id: postId, cursor, limit: 20 });
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
    if (client && postId && items.length === 0 && hasMore && !loading) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, postId, items.length, hasMore]);

  return { items, loadMore, hasMore, loading, reload };
}

/** "3h ago" — short, and stable enough not to need a ticking clock. */
export function timeAgo(ms: number, now: number = Date.now()): string {
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

/** An account id is 64 hex characters; show enough to tell people apart. */
export function shortAuthor(account: string): string {
  return account.length > 10 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}
