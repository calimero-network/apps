import { useState } from "react";
import { useNavigate } from "react-router-dom";

import Composer from "../components/Composer";
import InfiniteScroll from "../components/InfiniteScroll";
import PostCard from "../components/PostCard";
import SessionMenu from "../components/SessionMenu";
import NicknameBar from "../components/NicknameBar";
import { NavItem, Shell, SideCard, TechDetails } from "../components/chrome";
import {
  FeatherIcon,
  HashIcon,
  HomeIcon,
  LayersIcon,
  MessageIcon,
} from "../components/icons";
import type { Sort } from "../lib/forum";
import { useFeed, useForumClient, useSelfAccount } from "../lib/forum";
import { useNickname } from "../lib/nickname";
import {
  getActiveNamespaceId,
  getForumName,
  getContextId,
} from "../lib/session";

/** Focus the composer from the rail's call to action. Presentation only. */
function focusComposer() {
  const el = document.getElementById("composer-start");
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.focus();
  }
}

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
  const namespaceId = getActiveNamespaceId();

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
    <Shell
      nav={
        <>
          <NavItem icon={<HomeIcon size={24} />} label="Home" active />
          {/* Back to the forum's own space. A forum stored before spaces
              existed has no namespace recorded, and then the only honest
              destination is the space picker rather than a URL built out of
              nothing. */}
          <NavItem
            icon={<LayersIcon size={24} />}
            label="All forums"
            onClick={() => {
              const ns = getActiveNamespaceId();
              navigate(ns ? `/spaces/${ns}` : "/spaces");
            }}
          />
        </>
      }
      cta={
        <button
          type="button"
          className="ui-btn ui-btn-primary x-ctaBtn"
          onClick={focusComposer}
          aria-label="New post"
        >
          <span className="x-ctaIcon">
            <FeatherIcon size={22} />
          </span>
          <span className="x-ctaLabel">New post</span>
        </button>
      }
      account={<SessionMenu name={nickname.name} />}
      header={
        <>
          <div className="x-headRow">
            <div className="x-headText">
              <h1 className="x-headTitle">{forumName || "Forum"}</h1>
              <span className="x-headSub">
                <HashIcon size={13} />
                Forum
              </span>
            </div>
          </div>
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
        </>
      }
      aside={
        <>
          <SideCard title="Your name">
            <NicknameBar nickname={nickname} />
          </SideCard>
          <SideCard title="About this forum">
            <p className="x-sideText">
              <strong>{forumName || "This forum"}</strong> lives on the members'
              own nodes — posts replicate peer to peer, with no server in
              between.
            </p>
            <TechDetails
              rows={[
                { label: "Context ID", value: contextId },
                { label: "Space ID", value: namespaceId },
              ]}
            />
          </SideCard>
        </>
      }
    >
      <Composer
        as={nickname.name}
        onSubmit={async (title, body) => {
          if (!client) throw new Error("not connected to a node");
          await client.createPost({ title, body });
          reset();
        }}
      />

      {error && <div className="error">{error}</div>}

      <div className="feedList">
        {items.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            selfAccount={selfAccount}
            onVote={(v) => void vote(post.id, v)}
            onDelete={() => void remove(post.id)}
          />
        ))}
      </div>

      {!loading && items.length === 0 && !hasMore && (
        <div className="empty">
          <MessageIcon size={28} />
          <strong>No discussions yet</strong>
          Nothing here yet. Start the first discussion.
        </div>
      )}

      <InfiniteScroll
        onLoadMore={() => void loadMore()}
        hasMore={hasMore}
        loading={loading}
      />
    </Shell>
  );
}
