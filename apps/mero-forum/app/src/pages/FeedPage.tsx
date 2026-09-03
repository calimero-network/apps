import { useState } from "react";
import { ConnectButton } from "@calimero-network/mero-react";

import Composer from "../components/Composer";
import InfiniteScroll from "../components/InfiniteScroll";
import PostCard from "../components/PostCard";
import type { Sort } from "../lib/forum";
import { useFeed, useForumClient } from "../lib/forum";

export default function FeedPage() {
  // Reachable only through `RequireForum` (App.tsx), which has already
  // established that a node is connected AND that this app owns a context. So
  // `client` being null here is a transient identity resolve, not the
  // permanent no-node state this page used to render into — that state now has
  // its own screens (LoginPage, SetupPage) instead of an empty feed and a
  // composer whose only outcome was a throw.
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

      {!loading && items.length === 0 && !hasMore && (
        <div className="empty">Nothing here yet. Start the first discussion.</div>
      )}

      <InfiniteScroll onLoadMore={() => void loadMore()} hasMore={hasMore} loading={loading} />
    </>
  );
}
