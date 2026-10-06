import { useState } from "react";

import { AuthorAvatar, Byline, VoteColumn } from "./PostCard";
import { EditIcon, TrashIcon } from "./icons";
import type { CommentView } from "../generated/ForumClient";
import { timeAgo } from "../lib/forum";

/**
 * One comment, with everything its author is allowed to do to it.
 *
 * Edit and delete are shown only to the author, because the contract gates both
 * on authorship — offering them to anyone else produces a refusal they can do
 * nothing about. `selfAccount` is the ACCOUNT, matching `Comment.author`: the
 * context identity is a different 64-hex string and comparing the wrong one
 * hides your own controls from you.
 */
export default function CommentRow({
  comment,
  selfAccount,
  onVote,
  onEdit,
  onDelete,
}: {
  comment: CommentView;
  selfAccount: string | null;
  onVote: (value: number) => void;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => void;
}) {
  const mine = !!selfAccount && comment.author === selfAccount;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await onEdit(body);
      setEditing(false);
    } catch (e) {
      // Kept OPEN on failure: closing would discard the edit along with the
      // error, and the text the person wrote is the only copy.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="comment" data-testid="comment">
      <div className="commentRail">
        <AuthorAvatar
          account={comment.author}
          authorName={comment.author_name}
        />
      </div>
      <div className="commentBody">
        <div className="byRow">
          <Byline
            account={comment.author}
            authorName={comment.author_name}
            selfAccount={selfAccount}
          />
          <span className="dot" aria-hidden="true">
            ·
          </span>
          <span
            className="timeMeta"
            title={new Date(comment.created_at).toLocaleString()}
          >
            {timeAgo(comment.created_at)}
          </span>
          {comment.edited_at > comment.created_at && (
            <>
              <span className="dot" aria-hidden="true">
                ·
              </span>
              <span>edited</span>
            </>
          )}
        </div>

        {editing ? (
          <div className="commentEdit">
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Edit comment"
              data-testid="edit-comment-input"
            />
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(comment.body);
                  setError(null);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !draft.trim()}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p>{comment.body}</p>
        )}

        {!editing && (
          <div className="actions">
            <VoteColumn
              score={comment.score}
              myVote={comment.my_vote}
              onVote={onVote}
            />
            {mine ? (
              <>
                <button
                  type="button"
                  className="act"
                  data-testid="edit-comment"
                  title="Edit"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(true);
                  }}
                >
                  <span className="actIcon">
                    <EditIcon size={16} />
                  </span>
                  Edit
                </button>
                <button
                  type="button"
                  className="act danger"
                  data-testid="delete-comment"
                  title="Delete"
                  onClick={onDelete}
                >
                  <span className="actIcon">
                    <TrashIcon size={16} />
                  </span>
                  Delete
                </button>
              </>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
