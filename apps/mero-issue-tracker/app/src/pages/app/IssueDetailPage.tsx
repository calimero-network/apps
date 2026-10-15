import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t, STATUSES, PRIORITIES, STATUS_COLOR } from '../../theme';
import { APP_ROUTE } from '../../config';
import { describeError } from '../../utils/errors';
import type { IssueDetail, CommentView } from '../../hooks/useItems';
import { relativeTime, shortIssueId } from '../../utils/display';
import { buildFixPrompt } from '../../utils/fixPrompt';
import StatusDot from '../../components/StatusDot';
import PriorityGlyph from '../../components/PriorityGlyph';
import AvatarGlyph from '../../components/AvatarGlyph';
import LabelChip from '../../components/LabelChip';
import { SelectMenu } from '../../components/Dropdown';
import { IconBack, IconAgent, IconCopy } from '../../components/icons';
import { Overlay, Dialog, Close, Actions, SecondaryBtn } from '../../components/modalKit';
import { Panel } from '../../components/ui';
import { useAppCtx } from './appContext';

// "now" already reads as present tense; only older stamps take the " ago" suffix.
const ago = (v: number): string => {
  const r = relativeTime(v);
  return r === 'now' ? 'now' : `${r} ago`;
};

/** Full-page issue view: a header card, the four section blocks, the
 *  activity feed, and a properties rail. On a wide screen the rail sits on the
 *  right and stays put while the issue scrolls; on a phone it comes straight
 *  after the header, so status and assignee are one thumb away. */
export default function IssueDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const { data, currentUser, members, aliases, repoUrl } = useAppCtx();
  const toast = useToast();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [assignee, setAssignee] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addingLabel, setAddingLabel] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
  const createdByHasAlias = issue ? aliases.hasAlias(issue.created_by) : false;
  const createdByLabel = issue ? aliases.resolve(issue.created_by) : '';
  // Seed the composer avatar with the SAME resolved identity the comment list
  // uses, not the raw public key (which produced a mismatched glyph/colour).
  const meHasAlias = currentUser ? aliases.hasAlias(currentUser) : false;
  const meLabel = currentUser ? aliases.resolve(currentUser) : '';

  useEffect(() => { setAssignee(issue?.assignee ?? ''); }, [issue?.assignee]);

  const run = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { toast.show({ variant: 'error', description: describeError(err) }); }
  };

  if (!issue) {
    return (
      <Missing>
        <Link to={APP_ROUTE} className="back"><IconBack /> All Issues</Link>
        <p>Issue not found.</p>
        <span>It may have been deleted, or it has not reached this node yet.</span>
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
  const copyFixPrompt = () => {
    void run(async () => {
      await navigator.clipboard.writeText(buildFixPrompt(issue, repoUrl));
      toast.show({ variant: 'success', description: 'Prompt copied' });
    });
  };
  // Only the creator may delete (server enforces it too); mirrors the comment gate.
  const isCreator = !!currentUser && issue.created_by === currentUser;
  const runDelete = async () => {
    setDeleting(true);
    try {
      await data.deleteIssue(issue.id);
      setConfirmDelete(false);
      navigate(APP_ROUTE);
      toast.show({ variant: 'success', description: 'Issue deleted' });
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Wrap>
      <Layout>
      <Head>
        <button className="back" data-testid="action-back" onClick={() => navigate(APP_ROUTE)}><IconBack /> All Issues</button>
        <Panel className="head-card">
          <div className="idrow">
            <span className="id" title={issue.id}>{shortIssueId(issue.id)}</span>
            <span className="status-pill" style={{ '--status': STATUS_COLOR[issue.status] } as React.CSSProperties}>
              <StatusDot status={issue.status} />
              <span className="status-name">{issue.status}</span>
            </span>
            <span className="prio-pill"><PriorityGlyph priority={issue.priority} boxSize={14} />{issue.priority}</span>
          </div>
          <h1 className="title">{issue.title}</h1>
          <div className="byline">
            <AvatarGlyph
              seed={createdByHasAlias ? createdByLabel : issue.created_by}
              size="sm"
              keyFallback={!createdByHasAlias}
            />
            <span><b className={createdByHasAlias ? '' : 'mono'}>{createdByLabel}</b> opened this {ago(issue.created_at) === 'now' ? 'just now' : ago(issue.created_at)}</span>
          </div>
        </Panel>
      </Head>

      <Body>
        <Panel className="sections">
          <Section title="Summary" n={1}>
            <p data-testid="field-summary">{issue.summary}</p>
          </Section>
          <Section title="Impact" n={2}>
            <p data-testid="field-impact">{issue.impact}</p>
          </Section>
          <Section title="Repro" n={3}>
            <p className="repro" data-testid="field-repro">{issue.repro}</p>
          </Section>
          <Section title="Resolution criteria" n={4}>
            <p data-testid="field-resolution_criteria">{issue.resolution_criteria}</p>
          </Section>
        </Panel>

        <Panel className="activity-card">
          <div className="activity-title">Activity <span className="n">{comments.length + 1}</span></div>
          <div className="activity">
            <div className="act-item">
              <AvatarGlyph
                seed={createdByHasAlias ? createdByLabel : issue.created_by}
                size="md"
                keyFallback={!createdByHasAlias}
              />
              <div className="act-body">
                <div className="act-meta"><b>{createdByLabel}</b> created this issue <span className="act-time">· {ago(issue.created_at)}</span></div>
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
          </div>

          <div className="composer">
            <AvatarGlyph
              seed={meHasAlias ? meLabel : (currentUser || 'me')}
              size="md"
              keyFallback={!!currentUser && !meHasAlias}
            />
            <div className="compose-box">
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
        </Panel>
      </Body>

      <Props>
        <div className="props-title">Properties</div>
        <div className="prop-row">
          <span className="label">Status</span>
          <SelectMenu
            className="ctl"
            testId="action-set_status"
            ariaLabel="Status"
            value={issue.status}
            options={STATUSES}
            onChange={(v) => run(() => data.setStatus(issue.id, v))}
            renderValue={(v) => <><StatusDot status={v} />{v}</>}
            renderOption={(o) => <><StatusDot status={String(o)} />{String(o)}</>}
          />
        </div>
        <div className="prop-row">
          <span className="label">Priority</span>
          <SelectMenu
            className="ctl cap"
            testId="action-set_priority"
            ariaLabel="Priority"
            value={issue.priority}
            options={PRIORITIES}
            onChange={(v) => run(() => data.setPriority(issue.id, v))}
            renderValue={(v) => <><PriorityGlyph priority={v} boxSize={14} />{v}</>}
            renderOption={(o) => <><PriorityGlyph priority={String(o)} boxSize={14} />{String(o)}</>}
          />
        </div>
        <div className="prop-row">
          <span className="label">Assignee</span>
          <span className="val assignee">
            <input
              data-testid="field-assignee"
              placeholder="Unassigned"
              list="assignee-suggestions"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              onBlur={commitAssignee}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            {/* Native combobox: suggests members by alias, but a free-text value still saves. */}
            <datalist id="assignee-suggestions">
              {members.map((key) => <option key={key} value={aliases.resolve(key)} />)}
            </datalist>
            <button data-testid="action-set_assignee" type="button" onClick={commitAssignee}>Save</button>
          </span>
        </div>
        <div className="prop-row labels-row">
          <span className="label">Labels</span>
          <span className="val labels">
            {issue.labels.map((l) => (
              <LabelChip key={l} label={l} onRemove={() => run(() => data.removeLabel(issue.id, l))} />
            ))}
            {addingLabel ? (
              <input
                className="label-input"
                data-testid="field-label"
                placeholder="Label name…"
                aria-label="Label name"
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitLabel(); }
                  else if (e.key === 'Escape') { setNewLabel(''); setAddingLabel(false); }
                }}
                onBlur={() => { if (!newLabel.trim()) setAddingLabel(false); }}
              />
            ) : (
              <button className="add-label" data-testid="action-add_label" type="button" onClick={() => setAddingLabel(true)}>+ Add</button>
            )}
          </span>
        </div>

        <div className="divider" />

        <div className="prop-row">
          <span className="label">Created by</span>
          <span className="val">
            <AvatarGlyph
              seed={createdByHasAlias ? createdByLabel : issue.created_by}
              size="sm"
              keyFallback={!createdByHasAlias}
            />
            <span className={createdByHasAlias ? '' : 'mono'}>{createdByLabel}</span>
          </span>
        </div>
        <div className="prop-row">
          <span className="label">Created</span>
          <span className="val dim">{ago(issue.created_at)}</span>
        </div>

        <AgentCard className="glass-suggested">
          <span className="eyebrow"><span className="ico"><IconAgent /></span>Local agent</span>
          <p>A ready-to-paste prompt with all four sections, for a coding agent to fix this.</p>
          <button className="copy" data-testid="action-copy_fix_prompt" onClick={copyFixPrompt}><IconCopy /> Copy fix prompt</button>
          <div className="hint">paste into your Claude Code session</div>
        </AgentCard>

        {isCreator && (
          <DeleteAction>
            <button type="button" data-testid="action-delete_issue" onClick={() => setConfirmDelete(true)}>Delete issue</button>
          </DeleteAction>
        )}
      </Props>
      </Layout>

      {confirmDelete && (
        <Overlay onClick={() => !deleting && setConfirmDelete(false)}>
          <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="issue-delete-title">
            <Close onClick={() => !deleting && setConfirmDelete(false)} aria-label="Close">×</Close>
            <h3 id="issue-delete-title">Delete issue</h3>
            <p className="sub">Delete "{issue.title}"? This also removes its comments and cannot be undone.</p>
            <Actions>
              <SecondaryBtn onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</SecondaryBtn>
              <DangerBtn data-testid="confirm-delete_issue" onClick={runDelete} disabled={deleting}>Delete</DangerBtn>
            </Actions>
          </Dialog>
        </Overlay>
      )}
    </Wrap>
  );
}

function Section({ title, n, children }: { title: string; n: number; children: React.ReactNode }) {
  return (
    <div className="section">
      <span className="eyebrow"><span className="num" aria-hidden="true">{n}</span>{title}</span>
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
  const { aliases } = useAppCtx();
  const authorHasAlias = aliases.hasAlias(comment.author);
  const authorLabel = aliases.resolve(comment.author);
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
      <AvatarGlyph
        seed={authorHasAlias ? authorLabel : comment.author}
        size="md"
        keyFallback={!authorHasAlias}
      />
      <div className="act-body">
        <div className="act-meta">
          <b>{authorLabel}</b>
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

/* The scroll column. No backdrop-filter, filter or transform here or on
   Layout: the delete confirm below is position: fixed and must cover the
   window, not this column. The frosted panels are its siblings' children. */
const Wrap = styled.div`
  flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto;
  padding: 16px 16px 56px;
  @media (max-width: 720px) { padding: 12px 10px 40px; }
`;
const Layout = styled.div`
  max-width: 1180px; margin: 0 auto;
  display: grid; grid-template-columns: minmax(0, 1fr) 312px; gap: 16px;
  grid-template-areas: "head props" "body props";
  align-items: start;
  @media (max-width: 1100px) { grid-template-columns: minmax(0, 1fr) 280px; }
  @media (max-width: 940px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "head" "props" "body";
    gap: 12px;
  }
`;
const eyebrow = `
  font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase;
  color: ${t.color.text3}; font-weight: 700;
`;
const Head = styled.div`
  grid-area: head; min-width: 0; display: flex; flex-direction: column; gap: 10px;
  .back {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
    font-family: inherit; font-size: 12.5px; font-weight: 600; color: ${t.color.text2};
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: ${t.radiusPill};
    min-height: 32px; padding: 0 13px 0 10px; cursor: pointer; box-shadow: ${t.shadowCard};
    &:hover { color: ${t.color.text}; border-color: ${t.color.borderStrong}; }
  }
  .head-card { padding: 22px 24px 20px; }
  .idrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .id {
    font-family: ${t.font.mono}; font-size: 11.5px; color: ${t.color.text2};
    padding: 3px 9px; border-radius: ${t.radiusPill}; background: ${t.color.raised2};
  }
  .status-pill {
    display: inline-flex; align-items: center; gap: 7px; padding: 3px 11px 3px 9px; border-radius: ${t.radiusPill};
    font-size: 12px; font-weight: 650; color: ${t.color.text};
    background: color-mix(in srgb, var(--status) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--status) 28%, transparent);
  }
  .prio-pill {
    display: inline-flex; align-items: center; gap: 7px; padding: 3px 11px 3px 9px; border-radius: ${t.radiusPill};
    font-size: 12px; font-weight: 600; color: ${t.color.text2}; text-transform: capitalize;
    background: ${t.color.raised2};
  }
  .title {
    font-size: 24px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.25; margin: 0 0 14px;
    overflow-wrap: anywhere;
  }
  .byline { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: ${t.color.text2}; }
  .byline b { color: ${t.color.text}; font-weight: 650; }
  .byline b.mono { font-family: ${t.font.mono}; font-size: 11.5px; font-weight: 500; }
  @media (max-width: 720px) {
    .head-card { padding: 18px 16px 16px; }
    .title { font-size: 20px; }
  }
`;
const Body = styled.div`
  grid-area: body; min-width: 0; display: flex; flex-direction: column; gap: 16px;
  .sections { padding: 8px 24px; }
  .section { padding: 18px 0; border-bottom: 1px solid ${t.color.border}; }
  .section:last-child { border-bottom: none; }
  .section .eyebrow { ${eyebrow} display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
  .section .num {
    width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center;
    font-size: 11px; letter-spacing: 0; color: ${t.color.accentText}; background: ${t.color.accentDim};
  }
  .section p {
    margin: 0; color: ${t.color.text}; font-size: 14px; line-height: 1.6; white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .section p.repro {
    font-family: ${t.font.mono}; font-size: 12.5px; line-height: 1.65;
    background: ${t.color.logBg}; border-radius: ${t.radius}; padding: 12px 14px;
  }
  .activity-card { padding: 20px 24px 22px; }
  .activity-title {
    display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
    font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
  }
  .activity-title .n {
    min-width: 22px; height: 20px; padding: 0 7px; border-radius: ${t.radiusPill};
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 650; color: ${t.color.text2}; background: ${t.color.raised2};
  }
  /* A thread: one rail down the avatars ties the items together. */
  .activity { position: relative; display: flex; flex-direction: column; gap: 18px; }
  .activity::before {
    content: ""; position: absolute; left: 12px; top: 6px; bottom: 6px; width: 2px;
    background: ${t.color.border}; border-radius: 2px;
  }
  .act-item { position: relative; display: flex; gap: 12px; align-items: flex-start; }
  .act-body { min-width: 0; flex: 1 1 auto; padding-top: 3px; }
  .act-meta { font-size: 12.5px; color: ${t.color.text2}; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .act-meta b { color: ${t.color.text}; font-weight: 650; }
  .act-time { color: ${t.color.text3}; }
  .cactions { display: inline-flex; gap: 2px; margin-left: auto; }
  .cactions button {
    background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600;
    color: ${t.color.text3}; padding: 3px 9px; border-radius: ${t.radiusPill};
    &:hover { color: ${t.color.text}; background: ${t.color.hover}; }
  }
  .act-comment {
    margin-top: 8px; background: ${t.color.panel}; box-shadow: ${t.shadowCard};
    border-radius: 4px 16px 16px 16px; padding: 11px 14px; font-size: 13.5px; color: ${t.color.text}; line-height: 1.55;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .act-comment .edited { color: ${t.color.text3}; font-size: 11.5px; }
  .cedit {
    margin-top: 8px; width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 13.5px;
    color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.accentBorder};
    border-radius: 14px; outline: none; font-family: inherit; resize: vertical; box-shadow: 0 0 0 3px ${t.focus};
  }
  .composer {
    margin-top: 20px; padding-top: 18px; border-top: 1px solid ${t.color.border};
    display: flex; align-items: center; gap: 12px;
  }
  .compose-box {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px;
    background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusPill};
    padding: 4px 4px 4px 16px; transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
    &:focus-within { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
  }
  .compose-box input {
    flex: 1 1 auto; min-width: 0; background: none; border: none; outline: none; color: ${t.color.text};
    font-family: inherit; font-size: 13.5px; min-height: 34px;
    &::placeholder { color: ${t.color.text3}; }
  }
  .compose-box .send {
    flex: 0 0 auto; border-radius: ${t.radiusPill}; border: 1px solid transparent; background: ${t.color.accent};
    color: ${t.color.onAccent}; font-family: inherit; font-weight: 650; font-size: 13px; min-height: 34px; padding: 0 16px; cursor: pointer;
    &:hover:not(:disabled) { background: ${t.color.accentHover}; }
    &:disabled { opacity: 0.4; cursor: default; }
  }
  @media (max-width: 720px) {
    gap: 12px;
    .sections { padding: 4px 16px; }
    .activity-card { padding: 16px; }
    .composer { gap: 8px; }
    .composer > span:first-child { display: none; }
  }
`;
/* The rail: above the panels after it (z-index), so the Status / Priority
   menus that open downwards are not painted under them. */
const Props = styled(Panel).attrs({ as: 'aside' })`
  grid-area: props; position: sticky; top: 0; z-index: 2;
  padding: 16px 14px; display: flex; flex-direction: column; gap: 2px;
  .props-title { ${eyebrow} padding: 2px 8px 10px; }
  .prop-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: ${t.radius}; min-height: 40px; }
  .prop-row.labels-row { align-items: flex-start; }
  .prop-row.labels-row .label { padding-top: 5px; }
  .label { font-size: 12.5px; color: ${t.color.text3}; font-weight: 500; width: 78px; flex: 0 0 auto; }
  .val { font-size: 13px; color: ${t.color.text}; display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
  .val.dim { color: ${t.color.text2}; }
  .val .mono { font-size: 11px; color: ${t.color.text2}; font-family: ${t.font.mono}; }
  /* Shared control column: selects + assignee input line up at one width. */
  .ctl { flex: 1 1 auto; min-width: 0; }
  .ctl > button { min-height: 34px; border-radius: ${t.radiusSm}; padding: 0 10px; font-size: 13px; }
  .ctl [role='listbox'] { right: 0; }
  .cap .tv, .cap [role="option"] { text-transform: capitalize; }
  .val.assignee { gap: 6px; }
  .val.assignee input {
    flex: 1 1 auto; min-width: 0; min-height: 34px; background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radiusSm}; padding: 0 10px; color: ${t.color.text}; font-family: inherit; font-size: 13px; outline: none;
    transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
  }
  .val.assignee button {
    flex: 0 0 auto; min-height: 34px; background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusPill};
    color: ${t.color.text}; font-family: inherit; font-weight: 600; font-size: 12px; padding: 0 12px; cursor: pointer;
    &:hover { background: ${t.color.hover}; }
  }
  .val.labels { flex-wrap: wrap; gap: 6px; }
  .val.labels .label-input {
    background: ${t.color.raised}; border: 1px solid ${t.color.accentBorder}; border-radius: ${t.radiusPill};
    padding: 4px 10px; color: ${t.color.text}; font-family: inherit; font-size: 12px; outline: none; width: 110px;
    box-shadow: 0 0 0 3px ${t.focus};
  }
  .val.labels .add-label {
    display: inline-flex; align-items: center; background: none; border: 1px dashed ${t.color.borderStrong};
    border-radius: ${t.radiusPill}; color: ${t.color.text2}; font-family: inherit; font-size: 12px; font-weight: 600; padding: 3px 10px; cursor: pointer;
    &:hover { color: ${t.color.text}; border-color: ${t.color.text3}; }
  }
  .divider { height: 1px; background: ${t.color.border}; margin: 10px 6px; }
  @media (max-width: 940px) { position: static; }
`;
/* The assistant-prepared look (glass.css \`glass-suggested\`): a gradient
   outline that says "this was made for you, nothing happens until you act". */
const AgentCard = styled.div`
  margin-top: 12px; padding: 14px;
  .eyebrow { ${eyebrow} display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
  .eyebrow .ico { color: ${t.color.accentText}; display: inline-flex; }
  p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.5; color: ${t.color.text2}; }
  .copy {
    width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    border-radius: ${t.radiusPill}; border: 1px solid transparent; background: ${t.color.accent};
    color: ${t.color.onAccent}; font-family: inherit; font-size: 13px; font-weight: 650; min-height: 38px; cursor: pointer;
    box-shadow: 0 10px 24px -12px rgba(14, 18, 34, 0.6);
    &:hover { background: ${t.color.accentHover}; }
  }
  .hint { margin-top: 8px; font-size: 11.5px; color: ${t.color.text3}; text-align: center; }
`;
const Missing = styled.div`
  margin: 32px auto; max-width: 460px; width: calc(100% - 32px); text-align: center;
  padding: 40px 24px; color: ${t.color.text2}; line-height: 1.55;
  background: ${t.color.glass}; border: 1px dashed ${t.color.borderStrong}; border-radius: ${t.radiusLg};
  .back { display: inline-flex; align-items: center; gap: 6px; color: ${t.color.text2}; font-weight: 600; font-size: 12.5px; margin-bottom: 18px; }
  p { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: ${t.color.text}; }
  span { font-size: 13px; color: ${t.color.text3}; }
`;
/* Quiet destructive control at the foot of the rail, behind a hairline. */
const DeleteAction = styled.div`
  margin-top: 12px; padding-top: 12px; border-top: 1px solid ${t.color.border};
  button {
    width: 100%; border-radius: ${t.radiusPill}; border: 1px solid ${t.color.dangerBorder};
    background: transparent; color: ${t.color.danger}; font-family: inherit; font-size: 13px; font-weight: 600;
    min-height: 36px; cursor: pointer; transition: background 150ms ease-out, border-color 150ms ease-out;
    &:hover { background: ${t.color.badBg}; border-color: ${t.color.danger}; }
  }
`;
const DangerBtn = styled.button`
  min-width: 120px; display: inline-flex; align-items: center; justify-content: center;
  min-height: 40px; padding: 0 20px; font-family: inherit; font-size: 13.5px; font-weight: 650;
  border-radius: ${t.radiusPill}; cursor: pointer;
  color: #fff; background: #c22a4a; border: 1px solid transparent;
  box-shadow: 0 10px 24px -12px rgba(162, 25, 75, 0.7);
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #a51f3c; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
