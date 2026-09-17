import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import CommentRow from "../components/CommentRow";
import SessionMenu from "../components/SessionMenu";
import { Byline, VoteColumn } from "../components/PostCard";
import type { PostView } from "../generated/ForumClient";
import {
  timeAgo,
  useComments,
  useForumClient,
  useSelfAccount,
} from "../lib/forum";
import { useNickname } from "../lib/nickname";
import { getForumName, getContextId } from "../lib/session";

export default function PostPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const client = useForumClient();
  const selfAccount = useSelfAccount();
  const nickname = useNickname(client);
  const [post, setPost] = useState<PostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items, loadMore, hasMore, loading, reload, setItems } = useComments(
    client,
    postId,
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const contextId = getContextId();
  const forumName = contextId ? getForumName(contextId) : "";
  const mine = !!selfAccount && !!post && post.author === selfAccount;

  useEffect(() => {
    if (!client || !postId) return;
    let cancelled = false;
    client
      .getPost({ post_id: postId })
      .then((p) => !cancelled && setPost(p))
      .catch(
        (e: unknown) =>
          !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
    };
  }, [client, postId]);

  const vote = async (value: number) => {
    if (!client || !post) return;
    setPost({
      ...post,
      score: post.score - post.my_vote + value,
      my_vote: value,
    });
    await client.vote({ post_id: post.id, value }).catch(() => undefined);
  };

  const voteComment = async (commentId: string, value: number) => {
    if (!client) return;
    // Optimistic, same as posts: the arrow answers immediately and the score is
    // corrected from the contract's own tally on the next read.
    setItems((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, score: c.score - c.my_vote + value, my_vote: value }
          : c,
      ),
    );
    try {
      await client.voteComment({ comment_id: commentId, value });
    } catch {
      reload();
    }
  };

  const comment = async () => {
    if (!client || !postId) return;
    setBusy(true);
    try {
      await client.createComment({ post_id: postId, body: draft.trim() });
      setDraft("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deletePost = async () => {
    if (!client || !post) return;
    if (!confirm("Delete this post? Its comments go with it.")) return;
    try {
      await client.deletePost({ post_id: post.id });
      // Back to the feed: staying here would render a thread the contract now
      // refuses to load, which reads as a failure rather than as the delete
      // that just succeeded.
      navigate("/f");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="top">
        <span className="brand">{forumName || "Forum"}</span>
        <div className="grow" />
        <SessionMenu />
      </div>

      <Link className="back" to="/f">
        ← Back to the feed
      </Link>

      {error && <div className="error">{error}</div>}

      {!post && !error && <div className="skeleton" />}

      {post && (
        <>
          <article className="card">
            <VoteColumn
              score={post.score}
              myVote={post.my_vote}
              onVote={(v) => void vote(v)}
            />
            <div className="body">
              <h1 className="title">{post.title}</h1>
              <div className="meta">
                <Byline
                  account={post.author}
                  authorName={post.author_name}
                  selfAccount={selfAccount}
                />
                <span>·</span>
                <span>{timeAgo(post.created_at)}</span>
                {post.edited_at > post.created_at && (
                  <>
                    <span>·</span>
                    <span>edited</span>
                  </>
                )}
                {mine && (
                  <>
                    <span>·</span>
                    <button
                      className="linkBtn danger"
                      data-testid="delete-post"
                      onClick={() => void deletePost()}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              <p className="excerpt">{post.body}</p>
            </div>
          </article>

          <div className="composer">
            {/* Who this comment will be signed as, said where it is written. */}
            <p className="composerAs" data-testid="comment-as">
              {nickname.name ? (
                <>
                  You are commenting as <strong>{nickname.name}</strong>
                </>
              ) : (
                <>
                  You have not picked a name — this will be signed with an
                  account id
                </>
              )}
            </p>
            <textarea
              rows={3}
              placeholder="Add a comment"
              aria-label="Add a comment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className="primary"
              disabled={busy || !draft.trim()}
              onClick={() => void comment()}
            >
              {busy ? "Sending…" : "Comment"}
            </button>
          </div>

          {items.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              selfAccount={selfAccount}
              onVote={(v) => void voteComment(c.id, v)}
              onEdit={async (body) => {
                if (!client) throw new Error("not connected to a node");
                await client.editComment({ comment_id: c.id, body });
                reload();
              }}
              onDelete={() => {
                if (!client) return;
                void client
                  .deleteComment({ comment_id: c.id })
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  )
                  .finally(() => reload());
              }}
            />
          ))}

          {!loading && items.length === 0 && (
            <div className="empty">No comments yet.</div>
          )}

          {/* Comments paginate on a button rather than on scroll: the page
              already has an infinite feed behind it, and a thread reads
              forwards, so "load more" is the honest control here. */}
          {hasMore && (
            <div className="end">
              <button
                className="ghost"
                onClick={() => void loadMore()}
                disabled={loading}
              >
                {loading ? "Loading…" : "Load more comments"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
