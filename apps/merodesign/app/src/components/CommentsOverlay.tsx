import { useState } from "react";
import { v4 as uuid } from "uuid";
import { rpcCall } from "../api/rpc";
import { clampText, MAX_COMMENT_LEN, MAX_REPLY_LEN } from "../utils/sanitize";
import type { CanvasComment } from "../types";
import styles from "./CommentsOverlay.module.css";

const CommentIcon = ({ size = 18, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 2.5h12v8H9.5L7 13V10.5H2z"/>
  </svg>
);

interface Props {
  contextId: string;
  comments: CanvasComment[];
  myIdentity: string;
  addingComment: boolean;
  onCommentAdded: (c: CanvasComment) => void;
  onCommentDeleted: (id: string) => void;
  onReplyAdded: (commentId: string, reply: import("../types").CommentReply) => void;
  onReplyDeleted: (commentId: string, replyId: string) => void;
  onCancelAdd: () => void;
  viewport: { zoom: number; panX: number; panY: number };
  /** Viewers can read comments/replies but not post or delete them. */
  readOnly?: boolean;
}

export default function CommentsOverlay({
  contextId, comments, myIdentity, addingComment,
  onCommentAdded, onCommentDeleted, onReplyAdded, onReplyDeleted,
  onCancelAdd, viewport, readOnly = false,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const [addText, setAddText] = useState("");

  // Convert canvas coordinates to screen (overlay-relative) pixels
  function toScreen(cx: number, cy: number) {
    return {
      x: cx * viewport.zoom + viewport.panX,
      y: cy * viewport.zoom + viewport.panY,
    };
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!addingComment) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Convert screen → canvas space
    const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom;
    const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom;
    setPendingPos({ x: Math.round(canvasX), y: Math.round(canvasY) });
    e.stopPropagation();
  }

  async function submitComment() {
    if (readOnly || !pendingPos || !addText.trim()) return;
    const id = uuid();
    const c: CanvasComment = {
      id, x: pendingPos.x, y: pendingPos.y,
      content: clampText(addText, MAX_COMMENT_LEN), author: myIdentity,
      createdAt: Date.now(), replies: [],
    };
    onCommentAdded(c);
    await rpcCall(contextId, "add_comment", {
      id: c.id, x: c.x, y: c.y, content: c.content,
      author: c.author, created_at: c.createdAt,
    }).catch(() => {});
    setAddText("");
    setPendingPos(null);
    onCancelAdd();
  }

  async function submitReply(commentId: string) {
    if (readOnly || !replyText.trim()) return;
    const replyId = uuid();
    const reply = { id: replyId, content: clampText(replyText, MAX_REPLY_LEN), author: myIdentity, createdAt: Date.now() };
    onReplyAdded(commentId, reply);
    await rpcCall(contextId, "add_reply", {
      comment_id: commentId, reply_id: replyId,
      content: reply.content, author: reply.author, created_at: reply.createdAt,
    }).catch(() => {});
    setReplyText("");
  }

  async function deleteComment(commentId: string) {
    if (readOnly) return;
    onCommentDeleted(commentId);
    setOpenId(null);
    await rpcCall(contextId, "delete_comment", { id: commentId }).catch(() => {});
  }

  async function deleteReply(commentId: string, replyId: string) {
    if (readOnly) return;
    onReplyDeleted(commentId, replyId);
    await rpcCall(contextId, "delete_reply", { comment_id: commentId, reply_id: replyId }).catch(() => {});
  }

  function shortId(id: string) {
    return id.slice(0, 6) + "…" + id.slice(-4);
  }

  return (
    <div
      className={`${styles.overlay} ${addingComment ? styles.overlayAdding : ""}`}
      onClick={handleOverlayClick}
    >
      {/* Existing comment pins */}
      {comments.map((c) => {
        const pos = toScreen(c.x, c.y);
        return (
          <div
            key={c.id}
            className={styles.pin}
            style={{ left: pos.x, top: pos.y }}
            onClick={(e) => { e.stopPropagation(); setOpenId(openId === c.id ? null : c.id); }}
            title={c.content}
          >
            <CommentIcon size={20} color="#2563eb" />
            {c.replies.length > 0 && <span className={styles.pinBadge}>{c.replies.length}</span>}
          </div>
        );
      })}

      {/* Open comment popup */}
      {openId && (() => {
        const c = comments.find((x) => x.id === openId);
        if (!c) return null;
        const pos = toScreen(c.x, c.y);
        return (
          <div
            className={styles.popup}
            style={{ left: pos.x + 24, top: pos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.popupHeader}>
              <span className={styles.popupAuthor}>{shortId(c.author)}</span>
              <button className={styles.popupClose} onClick={() => setOpenId(null)}>✕</button>
            </div>
            <p className={styles.popupContent}>{c.content}</p>

            {c.replies.map((r) => (
              <div key={r.id} className={styles.reply}>
                <span className={styles.replyAuthor}>{shortId(r.author)}</span>
                <span className={styles.replyContent}>{r.content}</span>
                {!readOnly && r.author === myIdentity && (
                  <button className={styles.replyDelete} onClick={() => deleteReply(c.id, r.id)} title="Delete reply">×</button>
                )}
              </div>
            ))}

            {!readOnly && (
              <div className={styles.replyRow}>
                <input
                  className={styles.replyInput}
                  placeholder="Reply…"
                  value={replyText}
                  maxLength={MAX_REPLY_LEN}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitReply(c.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button className={styles.replyBtn} onClick={() => submitReply(c.id)}>↵</button>
              </div>
            )}

            {!readOnly && c.author === myIdentity && (
              <button className={styles.deleteCommentBtn} onClick={() => deleteComment(c.id)}>
                Delete comment
              </button>
            )}
          </div>
        );
      })()}

      {/* Pending comment placement */}
      {pendingPos && (() => {
        const pos = toScreen(pendingPos.x, pendingPos.y);
        return (
          <>
            <div
              className={`${styles.pin} ${styles.pinPending}`}
              style={{ left: pos.x, top: pos.y }}
            >
              <CommentIcon size={20} color="#2563eb" />
            </div>
            <div
              className={styles.popup}
              style={{ left: pos.x + 24, top: pos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className={styles.popupAuthor}>New comment</p>
              <textarea
                autoFocus
                className={styles.addTextarea}
                placeholder="Write a comment…"
                value={addText}
                maxLength={MAX_COMMENT_LEN}
                onChange={(e) => setAddText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className={styles.addBtns}>
                <button className={styles.addCancelBtn} onClick={() => { setPendingPos(null); setAddText(""); onCancelAdd(); }}>Cancel</button>
                <button className={styles.addSubmitBtn} onClick={submitComment} disabled={!addText.trim()}>Post</button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Click hint when in adding mode */}
      {addingComment && !pendingPos && (
        <div className={styles.addHint}>Click on the canvas to place a comment</div>
      )}
    </div>
  );
}
