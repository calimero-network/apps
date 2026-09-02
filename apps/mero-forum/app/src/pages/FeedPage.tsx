import { useState } from "react";
import { ConnectButton, useMero } from "@calimero-network/mero-react";

import Composer from "../components/Composer";
import InfiniteScroll from "../components/InfiniteScroll";
import PostCard from "../components/PostCard";
import type { Sort } from "../lib/forum";
import { useFeed, useForumClient } from "../lib/forum";

export default function FeedPage() {
  // ⚠️ This app shipped with NO way to log in: no ConnectButton, no LoginModal,
  // no `connectToNode`, not even an `isAuthenticated` read. `useForumClient()`
  // returns null until a node is connected, so the composer threw "not
  // connected to a node" on submit and the feed stayed permanently empty — with
  // nothing on the page offering to fix it.
  const { isAuthenticated } = useMero();
  const client = useForumClient();
  const [sort, setSort] = useState<Sort>("new");
  const { items, loadMore, hasMore, loading, error, reset, setItems } = useFeed(client, sort);

  const vote = async (postId: string, value: number) => {
    if (!client) return;
    // Optimistic: the arrow responds immediately and the score is corrected
    // from the contract's own tally on the next read.
    setItems((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, score: p.score - p.my_vote + value, my_vote: value } : p,
      ),
    );
    try {
      await client.vote({ post_id: postId, value });
    } catch {
      reset();
    }
  };

  return (
    <>
      <div className="top">
        <span className="brand">
          mero<span>forum</span>
        </span>
        <div className="grow" />
        <div className="tabs" role="tablist" aria-label="Sort">
          {(["new", "top"] as const).map((s) => (
            <button
              key={s}
              role="tab"
              className="tab"
              aria-selected={sort === s}
              onClick={() => setSort(s)}
            >
              {s === "new" ? "New" : "Top"}
            </button>
          ))}
        </div>
        <ConnectButton label="Connect a node" />
      </div>

      {/* The chrome below stays mounted unauthenticated on purpose — the browser
          e2e asserts the page degrades gracefully when every read fails rather
          than blanking. What was missing was any way OUT of that state, and any
          explanation of it: the composer could only throw and the feed could
          only be empty. */}
      {!isAuthenticated && (
        <div className="notice">
          Connect the node you run to read and post — a forum lives in a context
          on your own node, so there is nothing to show until then.
        </div>
      )}

      <Composer
        onSubmit={async (title, body) => {
          if (!client) throw new Error("not connected to a node");
          await client.createPost({ title, body });
          reset();
        }}
      />

      {error && <div className="error">{error}</div>}

      {items.map((post) => (
        <PostCard key={post.id} post={post} onVote={(v) => void vote(post.id, v)} />
      ))}

      {!loading && items.length === 0 && !hasMore && isAuthenticated && (
        <div className="empty">Nothing here yet. Start the first discussion.</div>
      )}

      <InfiniteScroll onLoadMore={() => void loadMore()} hasMore={hasMore} loading={loading} />
    </>
  );
}
