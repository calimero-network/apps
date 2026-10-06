import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import CommentRow from "../components/CommentRow";
import SessionMenu from "../components/SessionMenu";
import {
  AuthorAvatar,
  Byline,
  ShareButton,
  VoteColumn,
} from "../components/PostCard";
import {
  Avatar,
  Menu,
  NavItem,
  Shell,
  SideCard,
  TechDetails,
} from "../components/chrome";
import {
  ArrowLeftIcon,
  HomeIcon,
  MessageIcon,
  TrashIcon,
} from "../components/icons";
import type { PostView } from "../generated/ForumClient";
import {
  fullDate,
  timeAgo,
  useComments,
  useForumClient,
  useSelfAccount,
} from "../lib/forum";
import { useNickname } from "../lib/nickname";
import {
  getActiveNamespaceId,
  getForumName,
  getContextId,
} from "../lib/session";

/** Focus the reply box from the rail / action bar. Presentation only. */
function focusReply() {
  const el = document.getElementById("reply-box");
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.focus();
  }
}

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
    <Shell
      nav={
        <NavItem
          icon={<HomeIcon size={24} />}
          label="Home"
          onClick={() => navigate("/f")}
        />
      }
      cta={
        <button
          type="button"
          className="ui-btn ui-btn-primary x-ctaBtn"
          onClick={focusReply}
          aria-label="Write a reply"
        >
          <span className="x-ctaIcon">
            <MessageIcon size={22} />
          </span>
          <span className="x-ctaLabel">Reply</span>
        </button>
      }
      account={<SessionMenu name={nickname.name} />}
      header={
        <div className="x-headRow">
          <Link
            className="x-headBack back"
            to="/f"
            aria-label="Back to the feed"
            title="Back to the feed"
          >
            <ArrowLeftIcon size={20} />
          </Link>
          <div className="x-headText">
            <span className="x-headTitle">Post</span>
            <span className="x-headSub">in {forumName || "Forum"}</span>
          </div>
        </div>
      }
      aside={
        <SideCard title="About this forum">
          <p className="x-sideText">
            <strong>{forumName || "This forum"}</strong> lives on the members'
            own nodes — replies replicate peer to peer, with no server in
            between.
          </p>
          <TechDetails
            rows={[
              { label: "Post ID", value: post?.id },
              { label: "Context ID", value: contextId },
              { label: "Space ID", value: getActiveNamespaceId() },
            ]}
          />
        </SideCard>
      }
    >
      {error && <div className="error">{error}</div>}

      {!post && !error && <div className="skeleton" />}

      {post && (
        <>
          <article className="card thread">
            <div className="threadHead">
              <AuthorAvatar
                account={post.author}
                authorName={post.author_name}
                size={48}
              />
              <div className="threadWho">
                <Byline
                  account={post.author}
                  authorName={post.author_name}
                  selfAccount={selfAccount}
                />
              </div>
              {mine && (
                <Menu label="Post actions">
                  {(close) => (
                    <button
                      type="button"
                      role="menuitem"
                      className="ui-menuItem"
                      data-danger="true"
                      data-testid="delete-post"
                      onClick={() => {
                        close();
                        void deletePost();
                      }}
                    >
                      <TrashIcon size={17} />
                      Delete
                    </button>
                  )}
                </Menu>
              )}
            </div>
            <h1 className="title">{post.title}</h1>
            <p className="excerpt">{post.body}</p>
            <div className="threadStamp">
              <span>{fullDate(post.created_at)}</span>
              <span aria-hidden="true">·</span>
              <span>{timeAgo(post.created_at)}</span>
              {post.edited_at > post.created_at && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>edited</span>
                </>
              )}
            </div>
            <div className="threadStats">
              <span>
                <strong>{post.comment_count}</strong>
                {post.comment_count === 1 ? "Comment" : "Comments"}
              </span>
              <span>
                <strong>{post.score}</strong>Score
              </span>
            </div>
            <div className="actions">
              <button
                type="button"
                className="act reply"
                onClick={focusReply}
                title="Reply"
                aria-label="Reply"
              >
                <span className="actIcon">
                  <MessageIcon size={19} />
                </span>
              </button>
              <VoteColumn
                score={post.score}
                myVote={post.my_vote}
                onVote={(v) => void vote(v)}
              />
              <ShareButton postId={post.id} />
            </div>
          </article>

          <div className="composer">
            <Avatar
              label={nickname.name || "You"}
              seed={nickname.name || "you"}
            />
            <div className="composerMain">
              <textarea
                id="reply-box"
                rows={2}
                placeholder="Post your reply"
                aria-label="Add a comment"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="composerBar">
                {/* Who this comment will be signed as, said where it is written. */}
                <p
                  className="composerAs"
                  data-testid="comment-as"
                  data-unset={nickname.name ? undefined : "true"}
                >
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
                <span className="grow" />
                <button
                  className="primary"
                  disabled={busy || !draft.trim()}
                  onClick={() => void comment()}
                >
                  {busy ? "Sending…" : "Comment"}
                </button>
              </div>
            </div>
          </div>

          <div className="commentList">
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
          </div>

          {!loading && items.length === 0 && (
            <div className="empty">
              <MessageIcon size={24} />
              No comments yet.
            </div>
          )}

          {/* Comments paginate on a button rather than on scroll: the page
              already has an infinite feed behind it, and a thread reads
              forwards, so "load more" is the honest control here. */}
          {hasMore && (
            <div className="end repliesEnd">
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
    </Shell>
  );
}
