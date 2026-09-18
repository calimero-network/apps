import { useState } from "react";
import { useNavigate } from "react-router-dom";

import Composer from "../components/Composer";
import InfiniteScroll from "../components/InfiniteScroll";
import PostCard from "../components/PostCard";
import SessionMenu from "../components/SessionMenu";
import NicknameBar from "../components/NicknameBar";
import type { Sort } from "../lib/forum";
import { useFeed, useForumClient, useSelfAccount } from "../lib/forum";
import { useNickname } from "../lib/nickname";
import {
  getActiveNamespaceId,
  getForumName,
  getContextId,
} from "../lib/session";

export default function FeedPage() {
  const navigate = useNavigate();
  const client = useForumClient();
  const selfAccount = useSelfAccount();
  const nickname = useNickname(client);
  const [sort, setSort] = useState<Sort>("new");
  const { items, loadMore, hasMore, loading, error, reset, setItems } = useFeed(
    client,
    sort,
  );

  const contextId = getContextId();
  const forumName = contextId ? getForumName(contextId) : "";

  const vote = async (postId: string, value: number) => {
    if (!client) return;
    // Optimistic: the arrow responds immediately and the score is corrected
    // from the contract's own tally on the next read.
    setItems((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, score: p.score - p.my_vote + value, my_vote: value }
          : p,
      ),
    );
    try {
      await client.vote({ post_id: postId, value });
    } catch {
      reset();
    }
  };

  const remove = async (postId: string) => {
    if (!client) return;
    // Removed from the list before the call returns, then re-read. The contract
    // gates this on authorship, so a refused delete comes back as an error and
    // the reset restores the row rather than leaving a hole.
    setItems((prev) => prev.filter((p) => p.id !== postId));
    try {
      await client.deletePost({ post_id: postId });
    } finally {
      reset();
    }
  };

  return (
    <>
      <div className="top">
        {/* Back to the forum's own space. A forum stored before spaces existed
            has no namespace recorded, and then the only honest destination is
            the space picker rather than a URL built out of nothing. */}
        <button
          className="back"
          onClick={() => {
            const ns = getActiveNamespaceId();
            navigate(ns ? `/spaces/${ns}` : "/spaces");
          }}
        >
          ← All forums
        </button>
        <span className="brand">{forumName || "Forum"}</span>
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
        {/* Was `<ConnectButton/>`, which renders the whole connection state —
            provider, node, a connect/disconnect toggle — for someone who is
            already connected and inside a forum. The only thing they can
            actually want from it up here is the way out. */}
        <SessionMenu />
      </div>

      <NicknameBar nickname={nickname} />

      <Composer
        as={nickname.name}
        onSubmit={async (title, body) => {
          if (!client) throw new Error("not connected to a node");
          await client.createPost({ title, body });
          reset();
        }}
      />

      {error && <div className="error">{error}</div>}

      {items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          selfAccount={selfAccount}
          onVote={(v) => void vote(post.id, v)}
          onDelete={() => void remove(post.id)}
        />
      ))}

      {!loading && items.length === 0 && !hasMore && (
        <div className="empty">
          Nothing here yet. Start the first discussion.
        </div>
      )}

      <InfiniteScroll
        onLoadMore={() => void loadMore()}
        hasMore={hasMore}
        loading={loading}
      />
    </>
  );
}
