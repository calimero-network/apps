import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { VoteColumn } from "../components/PostCard";
import type { PostView } from "../generated/ForumClient";
import { shortAuthor, timeAgo, useComments, useForumClient } from "../lib/forum";

export default function PostPage() {
  const { postId } = useParams<{ postId: string }>();
  const client = useForumClient();
  const [post, setPost] = useState<PostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items, loadMore, hasMore, loading, reload } = useComments(client, postId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client || !postId) return;
    let cancelled = false;
    client
      .getPost({ post_id: postId })
      .then((p) => !cancelled && setPost(p))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [client, postId]);

  const vote = async (value: number) => {
    if (!client || !post) return;
    setPost({ ...post, score: post.score - post.my_vote + value, my_vote: value });
    await client.vote({ post_id: post.id, value }).catch(() => undefined);
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

  return (
    <>
      <div className="top">
        <span className="brand">
          mero<span>forum</span>
        </span>
      </div>

      <Link className="back" to="/">
        ← Back to the feed
      </Link>

      {error && <div className="error">{error}</div>}

      {!post && !error && <div className="skeleton" />}

      {post && (
        <>
          <article className="card">
            <VoteColumn score={post.score} myVote={post.my_vote} onVote={(v) => void vote(v)} />
            <div className="body">
              <h1 className="title">{post.title}</h1>
              <div className="meta">
                <span>{shortAuthor(post.author)}</span>
                <span>·</span>
                <span>{timeAgo(post.created_at)}</span>
                {post.edited_at > post.created_at && (
                  <>
                    <span>·</span>
                    <span>edited</span>
                  </>
                )}
              </div>
              <p className="excerpt">{post.body}</p>
            </div>
          </article>

          <div className="composer">
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
            <div className="comment" key={c.id}>
              <div className="meta">
                <span>{shortAuthor(c.author)}</span>
                <span>·</span>
                <span>{timeAgo(c.created_at)}</span>
              </div>
              <p>{c.body}</p>
            </div>
          ))}

          {!loading && items.length === 0 && <div className="empty">No comments yet.</div>}

          {/* Comments paginate on a button rather than on scroll: the page
              already has an infinite feed behind it, and a thread reads
              forwards, so "load more" is the honest control here. */}
          {hasMore && (
            <div className="end">
              <button className="ghost" onClick={() => void loadMore()} disabled={loading}>
                {loading ? "Loading…" : "Load more comments"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
