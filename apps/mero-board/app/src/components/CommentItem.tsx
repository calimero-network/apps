import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { CommentView } from '../generated/BoardClient';
import { tokens as t } from '../theme';
import { relativeTime, truncateKey } from '../utils/display';
import AvatarGlyph from './AvatarGlyph';

interface Props {
  comment: CommentView;
  mine: boolean;
  authorLabel: string;
  onEdit: (body: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

// "now" already reads as present tense; only older stamps take the " ago" suffix.
const ago = (v: number): string => {
  const r = relativeTime(v);
  return r === 'now' ? 'now' : `${r} ago`;
};

/** One comment: authorship-gated edit / delete (lifted from the tracker). */
export default function CommentItem({ comment, mine, authorLabel, onEdit, onDelete }: Props): React.ReactElement {
  // Without an alias the label is the truncated key; seed the avatar on the alias otherwise.
  const hasAlias = authorLabel !== truncateKey(comment.author);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  useEffect(() => { setDraft(comment.body); }, [comment.body]);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === comment.body) { setEditing(false); return; }
    try {
      await onEdit(next);
      setEditing(false);
    } catch {
      // The caller reports the failure; keep the draft open so nothing is lost.
    }
  };

  return (
    <Item data-testid="item-comment" data-comment-id={comment.id}>
      <AvatarGlyph seed={hasAlias ? authorLabel : comment.author} size="sm" keyFallback={!hasAlias} />
      <div className="body">
        <div className="meta">
          <b>{authorLabel}</b>
          <span className="time"> · {ago(comment.created_at)}</span>
          {mine && (
            <span className="actions">
              {editing ? (
                <>
                  <button type="button" data-testid="action-edit_comment" onClick={() => void save()}>Save</button>
                  <button type="button" onClick={() => { setEditing(false); setDraft(comment.body); }}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setEditing(true)}>Edit</button>
                  <button type="button" data-testid="action-delete_comment" onClick={() => void onDelete()}>Delete</button>
                </>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <textarea className="edit" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <div className="text">{comment.body}{comment.edited_at != null && <span className="edited"> (edited)</span>}</div>
        )}
      </div>
    </Item>
  );
}

const Item = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
  .body { min-width: 0; flex: 1 1 auto; }
  .meta { font-size: 12.5px; color: ${t.color.text2}; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .meta b { color: ${t.color.text}; font-weight: 600; }
  .time { color: ${t.color.text3}; }
  .actions { display: inline-flex; gap: 8px; margin-left: 8px; }
  .actions button {
    background: none; border: none; cursor: pointer; font-size: 11.5px; font-weight: 600; color: ${t.color.text3};
    &:hover { color: ${t.color.text}; }
  }
  .text {
    margin-top: 7px; background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; padding: 10px 12px; font-size: 13px; color: ${t.color.text}; line-height: 1.55;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .edited { color: ${t.color.text3}; font-size: 11.5px; }
  .edit {
    margin-top: 7px; width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px;
    color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; outline: none; font-family: inherit; resize: vertical;
    &:focus { border-color: ${t.color.borderStrong}; }
  }
`;
