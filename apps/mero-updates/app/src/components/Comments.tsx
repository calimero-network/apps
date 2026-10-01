import { useState } from "react";

import type { CommentView } from "../generated/UpdatesClient";
import { personLabel, timeAgo, useLive, useSelfAccount, useUpdatesClient } from "../lib/updates";
import { Avatar } from "./bits";

/**
 * The reply thread under an update or question.
 *
 * Replies are one level deep — a reply to a reply attaches to the same
 * top-level comment (the contract enforces it) — because an investor thread
 * is a conversation with the company, not a debate tree.
 */
export default function Comments({
  postId,
  isTeam,
  placeholder,
}: {
  postId: string;
  isTeam: boolean;
  placeholder: string;
}) {
  const client = useUpdatesClient();
  const self = useSelfAccount();
  const { data, reload, setData } = useLive((c) => c.listComments({ post_id: postId }), [postId]);
  const comments = data ?? [];
  const top = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  const post = async (body: string, parentId: string | null) => {
    if (!client) throw new Error("not connected to a node");
    await client.addComment({ post_id: postId, parent_id: parentId, body });
    reload();
  };

  const remove = async (c: CommentView) => {
    if (!client) return;
    setData(comments.filter((x) => x.id !== c.id));
    try {
      await client.deleteComment({ comment_id: c.id });
    } finally {
      reload();
    }
  };

  return (
    <section className="thread" aria-label="Replies">
      <h2 className="sectionLabel">
        {comments.length === 0 ? "Replies" : `${comments.length} repl${comments.length === 1 ? "y" : "ies"}`}
      </h2>
      <ReplyBox placeholder={placeholder} onSubmit={(b) => post(b, null)} testId="reply-box" />
      {top.map((c) => (
        <div key={c.id} className="commentGroup">
          <CommentItem
            comment={c}
            canDelete={c.author === self || isTeam}
            onDelete={() => void remove(c)}
            onReply={(b) => post(b, c.id)}
          />
          {repliesOf(c.id).map((r) => (
            <div key={r.id} className="reply">
              <CommentItem
                comment={r}
                canDelete={r.author === self || isTeam}
                onDelete={() => void remove(r)}
                onReply={(b) => post(b, c.id)}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function CommentItem({
  comment,
  canDelete,
  onDelete,
  onReply,
}: {
  comment: CommentView;
  canDelete: boolean;
  onDelete: () => void;
  onReply: (body: string) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  return (
    <div className="comment" data-testid="comment">
      <Avatar name={comment.author_name} account={comment.author} team={comment.author_is_team} />
      <div className="commentBody">
        <div className="meta">
          <span className="author">{personLabel(comment.author_name, comment.author)}</span>
          {comment.author_is_team && <span className="teamTag">Team</span>}
          <span>{timeAgo(comment.created_at)}</span>
          {comment.edited_at > comment.created_at + 1000 && <span>edited</span>}
        </div>
        <p>{comment.body}</p>
        <div className="row small">
          <button className="linkBtn" onClick={() => setReplying((v) => !v)}>
            Reply
          </button>
          {canDelete && (
            <button className="linkBtn danger" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
        {replying && (
          <ReplyBox
            placeholder="Write a reply…"
            autoFocus
            onSubmit={async (b) => {
              await onReply(b);
              setReplying(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function ReplyBox({
  placeholder,
  onSubmit,
  autoFocus,
  testId,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  autoFocus?: boolean;
  testId?: string;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body.trim());
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="replyBox" data-testid={testId}>
      <textarea
        rows={2}
        placeholder={placeholder}
        value={body}
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <div className="row end">
        {error && <span className="errorText">{error}</span>}
        <span className="hint">⌘/Ctrl + Enter</span>
        <button className="primary small" disabled={busy || !body.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
