import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t, STATUSES, PRIORITIES } from '../../theme';
import { APP_ROUTE } from '../../config';
import { describeError } from '../../utils/errors';
import type { IssueDetail, CommentView } from '../../hooks/useItems';
import { relativeTime, truncateKey } from '../../utils/display';
import StatusDot from '../../components/StatusDot';
import PriorityGlyph from '../../components/PriorityGlyph';
import AvatarGlyph from '../../components/AvatarGlyph';
import LabelChip from '../../components/LabelChip';
import { IconBack, IconAgent, IconCopy } from '../../components/icons';
import { useAppCtx } from './appContext';

// "now" already reads as present tense; only older stamps take the " ago" suffix.
const ago = (v: number): string => {
  const r = relativeTime(v);
  return r === 'now' ? 'now' : `${r} ago`;
};

/** Full-page issue view: four section blocks + activity feed, properties rail. */
export default function IssueDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const { data, currentUser } = useAppCtx();
  const toast = useToast();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [assignee, setAssignee] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [commentBody, setCommentBody] = useState('');

  // Reload the issue + comment thread on mount and on every board refresh so
  // remote edits appear live (mirrors the previous drawer behaviour).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await data.getIssue(id);
        if (!cancelled) setDetail(d);
      } catch { /* keep last known detail on a transient failure */ }
    })();
    return () => { cancelled = true; };
  }, [id, data.issues, data.getIssue]);

  const issue = detail?.issue ?? data.issues.find((i) => i.id === id) ?? null;
  const comments = detail?.comments ?? [];

  useEffect(() => { setAssignee(issue?.assignee ?? ''); }, [issue?.assignee]);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { toast.show({ variant: 'error', description: describeError(err) }); }
  };

  if (!issue) {
    return (
      <Missing>
        <Link to={APP_ROUTE} className="back"><IconBack /> All Issues</Link>
        <p>Issue not found.</p>
      </Missing>
    );
  }

  const commitAssignee = () => {
    const next = assignee.trim();
    if (next === (issue.assignee ?? '')) return;
    void run(() => data.setAssignee(issue.id, next || null));
  };
  const submitLabel = () => {
    const l = newLabel.trim();
    if (!l) return;
    void run(async () => { await data.addLabel(issue.id, l); setNewLabel(''); });
  };
  const submitComment = () => {
    const body = commentBody.trim();
    if (!body) return;
    void run(async () => { await data.addComment(issue.id, body); setCommentBody(''); });
  };

  return (
    <Wrap>
      <MainCol>
        <button className="back" onClick={() => navigate(APP_ROUTE)}><IconBack /> All Issues</button>

        <div className="idrow">
          <span className="id">{truncateKey(issue.id)}</span>
          <StatusDot status={issue.status} />
          <span className="status-name">{issue.status}</span>
        </div>
        <h1 className="title">{issue.title}</h1>

        <Section title="Summary">
          {/* TODO(phase1-wiring): backend has one `description`; it renders here until
              Task 4/5 splits it into the four fields below. */}
          <p>{issue.description || 'No summary provided.'}</p>
        </Section>
        <Section title="Impact">
          <p className="muted">Not provided yet.{/* TODO(phase1-wiring) */}</p>
        </Section>
        <Section title="Repro">
          <p className="muted">Not provided yet.{/* TODO(phase1-wiring) */}</p>
        </Section>
        <Section title="Resolution criteria">
          <p className="muted">Not provided yet.{/* TODO(phase1-wiring) */}</p>
        </Section>

        <div className="divider" />

        <div className="eyebrow activity-title">Activity</div>
        <div className="activity">
          <div className="act-item">
            <AvatarGlyph seed={issue.created_by} size="sm" keyFallback />
            <div className="act-body">
              <div className="act-meta"><b>{truncateKey(issue.created_by)}</b> created this issue <span className="act-time">· {ago(issue.created_at)}</span></div>
            </div>
          </div>

          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              mine={c.author === currentUser}
              onEdit={(body) => run(() => data.editComment(c.id, body))}
              onDelete={() => run(() => data.deleteComment(c.id))}
            />
          ))}

          <div className="composer">
            <AvatarGlyph seed={currentUser || 'me'} size="sm" />
            <input
              data-testid="field-body"
              placeholder="Leave a comment…"
              aria-label="Leave a comment"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitComment(); } }}
            />
            <button className="send" data-testid="action-add_comment" disabled={!commentBody.trim()} onClick={submitComment}>Comment</button>
          </div>
        </div>
      </MainCol>

      <Props>
        <div className="prop-row">
          <span className="label">Status</span>
          <span className="val">
            <StatusDot status={issue.status} />
            <Select
              data-testid="action-set_status"
              value={issue.status}
              onChange={(e) => run(() => data.setStatus(issue.id, e.target.value))}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </span>
        </div>
        <div className="prop-row">
          <span className="label">Priority</span>
          <span className="val">
            <PriorityGlyph priority={issue.priority} boxSize={14} />
            <Select
              data-testid="action-set_priority"
              value={issue.priority}
              onChange={(e) => run(() => data.setPriority(issue.id, e.target.value))}
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </span>
        </div>
        <div className="prop-row">
          <span className="label">Assignee</span>
          <span className="val assignee">
            <input
              data-testid="field-assignee"
              placeholder="Unassigned"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              onBlur={commitAssignee}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <button data-testid="action-set_assignee" type="button" onClick={commitAssignee}>Save</button>
          </span>
        </div>
        <div className="prop-row labels-row">
          <span className="label">Labels</span>
          <span className="val labels">
            {issue.labels.map((l) => (
              <LabelChip key={l} label={l} onRemove={() => run(() => data.removeLabel(issue.id, l))} />
            ))}
            <input
              data-testid="field-label"
              placeholder="Add label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitLabel(); } }}
            />
            <button data-testid="action-add_label" type="button" onClick={submitLabel}>Add</button>
          </span>
        </div>

        <div className="divider" />

        <div className="prop-row">
          <span className="label">Created by</span>
          <span className="val">
            <AvatarGlyph seed={issue.created_by} size="sm" keyFallback />
            <span className="mono">{truncateKey(issue.created_by)}</span>
          </span>
        </div>
        <div className="prop-row">
          <span className="label">Created</span>
          <span className="val dim">{ago(issue.created_at)}</span>
        </div>

        <AgentCard>
          <span className="eyebrow"><span className="ico"><IconAgent /></span>Local agent</span>
          {/* TODO(task-7): enable once the fix-prompt generator lands. */}
          <button className="copy" disabled title="Coming soon"><IconCopy /> Copy fix prompt</button>
          <div className="hint">paste into your Claude Code session</div>
        </AgentCard>
      </Props>
    </Wrap>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <span className="eyebrow">{title}</span>
      {children}
    </div>
  );
}

/* ── One comment: authorship-gated edit / delete ─────────────────────────── */
function CommentItem({
  comment, mine, onEdit, onDelete,
}: {
  comment: CommentView;
  mine: boolean;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  useEffect(() => { setDraft(comment.body); }, [comment.body]);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === comment.body) { setEditing(false); return; }
    await onEdit(next);
    setEditing(false);
  };

  return (
    <div className="act-item" data-testid="item-comment" data-comment-id={comment.id}>
      <AvatarGlyph seed={comment.author} size="sm" keyFallback />
      <div className="act-body">
        <div className="act-meta">
          <b>{truncateKey(comment.author)}</b>
          <span className="act-time"> · {ago(comment.created_at)}</span>
          {mine && (
            <span className="cactions">
              {editing ? (
                <>
                  <button data-testid="action-edit_comment" onClick={save}>Save</button>
                  <button onClick={() => { setEditing(false); setDraft(comment.body); }}>Cancel</button>
                </>
              ) : (
                <>
                  <button onClick={() => setEditing(true)}>Edit</button>
                  <button data-testid="action-delete_comment" onClick={onDelete}>Delete</button>
                </>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <textarea className="cedit" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <div className="act-comment">{comment.body}{comment.edited_at != null && <span className="edited"> (edited)</span>}</div>
        )}
      </div>
    </div>
  );
}

const Wrap = styled.div`
  display: grid; grid-template-columns: 1fr 260px; gap: 0;
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  @media (max-width: 940px) { grid-template-columns: 1fr; }
`;
const MainCol = styled.div`
  padding: 28px 40px 60px; max-width: 760px; width: 100%; margin: 0 auto; min-width: 0;
  .back {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
    color: ${t.color.text3}; background: none; border: none; padding: 0; margin-bottom: 20px; cursor: pointer;
    &:hover { color: ${t.color.text}; }
  }
  .idrow { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .idrow .id { font-family: ${t.font.mono}; font-size: 12px; color: ${t.color.text3}; }
  .idrow .status-name { font-size: 12px; color: ${t.color.text2}; }
  .title { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; margin: 0 0 26px; }
  .section { margin-bottom: 24px; }
  .section .eyebrow {
    display: block; margin-bottom: 8px; font-size: 11px; letter-spacing: 0.07em;
    text-transform: uppercase; color: ${t.color.text3}; font-weight: 600;
  }
  .section p { margin: 0; color: ${t.color.text}; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; }
  .section p.muted { color: ${t.color.text3}; }
  .divider { height: 1px; background: ${t.color.border}; margin: 30px 0 22px; }
  .activity-title { margin-bottom: 18px; font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; }
  .activity { display: flex; flex-direction: column; gap: 16px; }
  .act-item { display: flex; gap: 10px; align-items: flex-start; }
  .act-body { min-width: 0; flex: 1 1 auto; }
  .act-meta { font-size: 12.5px; color: ${t.color.text2}; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .act-meta b { color: ${t.color.text}; font-weight: 600; }
  .act-time { color: ${t.color.text3}; }
  .cactions { display: inline-flex; gap: 8px; margin-left: 8px; }
  .cactions button { background: none; border: none; cursor: pointer; font-size: 11.5px; font-weight: 600; color: ${t.color.text3}; &:hover { color: ${t.color.text}; } }
  .act-comment {
    margin-top: 7px; background: ${t.color.panel}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; padding: 10px 12px; font-size: 13px; color: ${t.color.text}; line-height: 1.55;
  }
  .act-comment .edited { color: ${t.color.text3}; font-size: 11.5px; }
  .cedit {
    margin-top: 7px; width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px;
    color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; outline: none; font-family: inherit; resize: vertical;
    &:focus { border-color: ${t.color.borderStrong}; }
  }
  .composer { margin-top: 4px; display: flex; align-items: center; gap: 10px; }
  .composer input {
    flex: 1 1 auto; background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; padding: 9px 12px; color: ${t.color.text};
    font-family: inherit; font-size: 13px; outline: none; transition: border-color 150ms ease-out;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.borderStrong}; }
  }
  .composer .send {
    border-radius: ${t.radius}; border: 1px solid transparent; background: ${t.color.accent};
    color: ${t.color.onAccent}; font-weight: 600; font-size: 12.5px; padding: 8px 12px; cursor: pointer;
    &:hover:not(:disabled) { background: #b6ff5e; }
    &:disabled { opacity: 0.5; cursor: default; }
  }
`;
const Props = styled.aside`
  border-left: 1px solid ${t.color.border}; padding: 22px 18px; background: ${t.color.panel};
  display: flex; flex-direction: column; gap: 2px;
  .prop-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: ${t.radius}; min-height: 34px; }
  .prop-row.labels-row { align-items: flex-start; }
  .label { font-size: 12px; color: ${t.color.text3}; width: 78px; flex: 0 0 auto; }
  .val { font-size: 12.5px; color: ${t.color.text}; display: flex; align-items: center; gap: 7px; flex: 1 1 auto; min-width: 0; }
  .val.dim { color: ${t.color.text2}; }
  .val .mono { font-size: 11px; color: ${t.color.text2}; font-family: ${t.font.mono}; }
  .val.assignee { gap: 6px; }
  .val.assignee input {
    flex: 1 1 auto; min-width: 0; background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radiusSm}; padding: 5px 7px; color: ${t.color.text}; font-family: inherit; font-size: 12px; outline: none;
    &:focus { border-color: ${t.color.borderStrong}; }
  }
  .val.assignee button, .val.labels button {
    background: ${t.color.raised2}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusSm};
    color: ${t.color.text2}; font-size: 11px; padding: 4px 7px; cursor: pointer; &:hover { color: ${t.color.text}; }
  }
  .val.labels { flex-wrap: wrap; gap: 5px; }
  .val.labels input {
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusSm};
    padding: 4px 7px; color: ${t.color.text}; font-family: inherit; font-size: 11.5px; outline: none; width: 90px;
    &:focus { border-color: ${t.color.borderStrong}; }
  }
  .divider { height: 1px; background: ${t.color.border}; margin: 14px 0; }
`;
const Select = styled.select`
  flex: 1 1 auto; min-width: 0; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radiusSm}; padding: 5px 7px; color: ${t.color.text};
  font-family: inherit; font-size: 12.5px; outline: none; cursor: pointer;
  &:focus { border-color: ${t.color.borderStrong}; }
`;
const AgentCard = styled.div`
  margin-top: 8px; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  border-radius: ${t.radius}; padding: 13px;
  .eyebrow {
    display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
    font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600;
  }
  .eyebrow .ico { color: ${t.color.accent}; display: inline-flex; }
  .copy {
    width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    border-radius: ${t.radius}; border: 1px solid ${t.color.border}; background: ${t.color.raised};
    color: ${t.color.text}; font-size: 12.5px; font-weight: 500; padding: 6px 11px;
    opacity: 0.55; cursor: default;
  }
  .hint { margin-top: 8px; font-family: ${t.font.mono}; font-size: 10.5px; color: ${t.color.text3}; text-align: center; }
`;
const Missing = styled.div`
  padding: 40px; color: ${t.color.text2};
  .back { display: inline-flex; align-items: center; gap: 6px; color: ${t.color.text3}; margin-bottom: 20px; }
`;
