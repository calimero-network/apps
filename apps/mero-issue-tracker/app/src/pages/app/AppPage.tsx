import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { C } from '../../theme';
import { APP_DISPLAY_NAME } from '../../config';
import { useWorkspace } from '../../hooks/useWorkspace';
import { describeError } from '../../utils/errors';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';

/**
 * BoardView — the issue tracker's main screen (SHELL PASS: presentational only).
 *
 * Columns for Open / In progress / Blocked / Done with issue cards, live
 * per-column counts, a create-issue form, and status/assignee/label filters.
 * Clicking a card opens the IssueDetail drawer (priority/assignee/status +
 * labels + comment thread).
 *
 * The data hook (generated IssuetrackerClient) is wired in a LATER pass — for
 * now the board renders from an empty placeholder list and all mutation
 * handlers are no-ops. The workspace gating (create/join) and Invite/Join
 * wiring are real and must keep their testids.
 */

const STATUSES = ['Open', 'In progress', 'Blocked', 'Done'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIORITY_COLOR: Record<Priority, string> = {
  low: C.mutedSoft,
  medium: 'var(--color-primary)',
  high: 'var(--color-accent)',
  urgent: '#dc2626',
};

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string | null;
  labels: string[];
  created_by: string;
  created_at: number;
}

export interface Comment {
  id: string;
  issue_id: string;
  author: string;
  body: string;
  created_at: number;
  edited_at: number | null;
}

export default function AppPage() {
  const { logout } = useMero();
  const ws = useWorkspace();

  // Placeholder data — the IssuetrackerClient hook is wired in a later pass.
  const issues: Issue[] = useMemo(() => [], []);

  // Create-issue form.
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [labels, setLabels] = useState('');

  // Filters (bind to list_issues params).
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterLabel, setFilterLabel] = useState('');

  // Detail drawer + collaboration modals.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const visible = useMemo(
    () =>
      issues.filter(
        (i) =>
          (!filterAssignee || (i.assignee ?? '') === filterAssignee) &&
          (!filterLabel || i.labels.includes(filterLabel)),
      ),
    [issues, filterAssignee, filterLabel],
  );

  const columns = filterStatus ? [filterStatus] : [...STATUSES];
  const selected = issues.find((i) => i.id === selectedId) ?? null;

  const submitIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    // Wiring pass: call create_issue({ title, description, priority, labels }) here.
    setTitle('');
    setDescription('');
    setPriority('medium');
    setLabels('');
  };

  // No workspace yet (fresh web session): offer create-or-join.
  if (!ws.ready && !ws.loading) {
    return (
      <Empty>
        <Card>
          <h2>Welcome to {APP_DISPLAY_NAME}</h2>
          <p>Create a shared board to start triaging issues, or join one you were invited to.</p>
          <Row>
            <Primary data-testid="create-workspace-btn" onClick={() => ws.bootstrap()}>Create board</Primary>
            <Secondary data-testid="open-join-btn" onClick={() => setShowJoin(true)}>Join with invitation</Secondary>
          </Row>
          {ws.error && <ErrLine>{describeError(ws.error)}</ErrLine>}
        </Card>
        {showJoin && (
          <JoinModal
            onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
            onClose={() => setShowJoin(false)}
          />
        )}
      </Empty>
    );
  }

  return (
    <Page data-testid="workspace-ready">
      <Bar>
        <h1>{APP_DISPLAY_NAME}</h1>
        <div className="actions">
          <Secondary data-testid="open-invite-btn" onClick={() => setShowInvite(true)}>Invite</Secondary>
          <Secondary data-testid="open-join-btn" onClick={() => setShowJoin(true)}>Join</Secondary>
          <Secondary onClick={logout}>Sign out</Secondary>
        </div>
      </Bar>

      {/* create issue */}
      <Form onSubmit={submitIssue}>
        <input
          data-testid="field-title"
          placeholder="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          data-testid="field-description"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <select
          data-testid="field-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          data-testid="field-labels"
          placeholder="Labels (comma-separated)"
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
        />
        <Primary data-testid="action-create_issue" type="submit" disabled={!title.trim()}>Create issue</Primary>
      </Form>

      {/* filters */}
      <Filters>
        <select data-testid="filter-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          data-testid="filter-assignee"
          placeholder="Filter by assignee"
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
        />
        <input
          data-testid="filter-label"
          placeholder="Filter by label"
          value={filterLabel}
          onChange={(e) => setFilterLabel(e.target.value)}
        />
      </Filters>

      {/* board */}
      <Board>
        {columns.map((status) => {
          const cards = visible.filter((i) => i.status === status);
          return (
            <Column key={status}>
              <ColHead>
                <span>{status}</span>
                <b data-testid={`count-${status}`}>{cards.length}</b>
              </ColHead>
              <ColBody>
                {cards.length === 0 && <ColHint>No issues</ColHint>}
                {cards.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    data-testid="item-issue"
                    data-issue-id={issue.id}
                    onClick={() => setSelectedId(issue.id)}
                  >
                    <div className="top">
                      <span className="dot" style={{ background: PRIORITY_COLOR[(issue.priority as Priority)] ?? C.mutedSoft }} />
                      <strong>{issue.title}</strong>
                    </div>
                    {issue.labels.length > 0 && (
                      <div className="labels">
                        {issue.labels.map((l) => (
                          <em key={l}>{l}</em>
                        ))}
                      </div>
                    )}
                    <div className="meta">
                      <span>{issue.priority}</span>
                      {issue.assignee && <span>· {issue.assignee}</span>}
                    </div>
                  </IssueCard>
                ))}
              </ColBody>
            </Column>
          );
        })}
      </Board>

      {selected && (
        <IssueDetail issue={selected} onClose={() => setSelectedId(null)} />
      )}

      {showInvite && (
        <InviteModal onInvite={ws.invite} onClose={() => setShowInvite(false)} />
      )}
      {showJoin && (
        <JoinModal
          onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
          onClose={() => setShowJoin(false)}
        />
      )}
    </Page>
  );
}

/* ── Issue detail drawer (SHELL: markup + testids; handlers wired later) ──── */
function IssueDetail({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const comments: Comment[] = [];
  const [assignee, setAssignee] = useState(issue.assignee ?? '');
  const [newLabel, setNewLabel] = useState('');
  const [commentBody, setCommentBody] = useState('');

  return (
    <Overlay onClick={onClose}>
      <Drawer onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <DClose onClick={onClose} aria-label="Close">×</DClose>
        <h2>{issue.title}</h2>

        <ControlRow>
          <label>
            Status
            <select data-testid="action-set_status" defaultValue={issue.status}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select data-testid="action-set_priority" defaultValue={issue.priority}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        </ControlRow>

        <Desc>{issue.description || 'No description.'}</Desc>

        <Field>
          <label>Assignee</label>
          <div className="inline">
            <input
              data-testid="field-assignee"
              placeholder="Unassigned"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            />
            <Secondary data-testid="action-set_assignee" type="button">Save</Secondary>
          </div>
        </Field>

        <Field>
          <label>Labels</label>
          <div className="labels">
            {issue.labels.map((l) => (
              <em key={l}>
                {l}
                <button data-testid="action-remove_label" aria-label={`Remove ${l}`}>×</button>
              </em>
            ))}
            {issue.labels.length === 0 && <span className="hint">No labels</span>}
          </div>
          <div className="inline">
            <input
              data-testid="field-label"
              placeholder="Add a label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <Secondary data-testid="action-add_label" type="button">Add</Secondary>
          </div>
        </Field>

        <Field>
          <label>Discussion</label>
          <Thread>
            {comments.length === 0 && <span className="hint">No comments yet.</span>}
            {comments.map((c) => (
              <div className="comment" key={c.id} data-testid="item-comment">
                <div className="chead">
                  <strong>{c.author}</strong>
                  <div className="cactions">
                    <button data-testid="action-edit_comment">Edit</button>
                    <button data-testid="action-delete_comment">Delete</button>
                  </div>
                </div>
                <p>{c.body}</p>
              </div>
            ))}
          </Thread>
          <div className="inline">
            <textarea
              data-testid="field-body"
              placeholder="Add a comment…"
              rows={2}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
            />
            <Primary data-testid="action-add_comment" type="button" disabled={!commentBody.trim()}>Comment</Primary>
          </div>
        </Field>
      </Drawer>
    </Overlay>
  );
}

/* ════════════════════════ styles ════════════════════════ */
const Page = styled.div`
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 20px 64px;
  width: 100%;
`;
const Bar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
  h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; }
  .actions { display: flex; gap: 8px; }
`;
const Form = styled.form`
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
  input, select {
    padding: 10px 12px; font-size: 14px;
    color: ${C.ink}; background: ${C.paper2};
    border: 1px solid ${C.line}; border-radius: 10px; outline: none;
    &:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.18); }
  }
  input { flex: 1; min-width: 150px; }
`;
const Filters = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 22px;
  flex-wrap: wrap;
  input, select {
    padding: 8px 11px; font-size: 13px;
    color: ${C.ink}; background: ${C.paper};
    border: 1px solid ${C.line}; border-radius: 9px; outline: none;
    &:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
  }
`;
const Board = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  align-items: start;
  @media (max-width: 860px) { grid-template-columns: 1fr 1fr; }
  @media (max-width: 520px) { grid-template-columns: 1fr; }
`;
const Column = styled.div`
  background: ${C.paper2};
  border: 1px solid ${C.line};
  border-radius: 14px;
  padding: 12px;
  min-width: 0;
`;
const ColHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 10px;
  span { font-size: 12px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: ${C.muted}; }
  b {
    font-size: 11px; font-weight: 700; color: #fff; background: var(--color-primary);
    border-radius: 999px; min-width: 20px; height: 18px; padding: 0 6px;
    display: grid; place-items: center;
  }
`;
const ColBody = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const ColHint = styled.p`font-size: 12.5px; color: ${C.mutedSoft}; padding: 6px 2px;`;
const IssueCard = styled.div`
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 11px;
  padding: 11px 12px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
  &:hover { border-color: var(--color-primary); transform: translateY(-1px); box-shadow: 0 10px 24px -18px rgba(14,20,15,0.5); }
  .top { display: flex; align-items: flex-start; gap: 8px; }
  .top .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
  .top strong { font-size: 13.5px; font-weight: 600; color: ${C.ink}; line-height: 1.35; }
  .labels { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .labels em {
    font-style: normal; font-size: 10.5px; font-weight: 600; color: var(--color-accent);
    background: rgba(249,115,22,0.12); border-radius: 6px; padding: 2px 7px;
  }
  .meta { display: flex; gap: 5px; margin-top: 8px; font-size: 11.5px; color: ${C.mutedSoft}; text-transform: capitalize; }
`;

/* detail drawer */
const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 100;
  display: flex; justify-content: flex-end;
  background: rgba(14,20,15,0.45); backdrop-filter: blur(4px);
`;
const Drawer = styled.div`
  position: relative; width: 100%; max-width: 480px; height: 100%; overflow-y: auto;
  background: ${C.paper}; border-left: 1px solid ${C.line};
  padding: 28px 26px 40px;
  h2 { font-size: 20px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin: 0 34px 18px 0; line-height: 1.3; }
`;
const DClose = styled.button`
  position: absolute; top: 16px; right: 16px; width: 32px; height: 32px;
  display: grid; place-items: center; font-size: 22px; line-height: 1;
  color: ${C.mutedSoft}; background: transparent; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
const ControlRow = styled.div`
  display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap;
  label { flex: 1; min-width: 130px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: ${C.muted}; }
  select {
    padding: 9px 11px; font-size: 13.5px; color: ${C.ink}; background: ${C.paper2};
    border: 1px solid ${C.line}; border-radius: 10px; outline: none;
    &:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.16); }
  }
`;
const Desc = styled.p`
  font-size: 14px; line-height: 1.6; color: ${C.ink}; white-space: pre-wrap;
  padding: 14px; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 12px; margin-bottom: 20px;
`;
const Field = styled.div`
  margin-bottom: 20px;
  & > label { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: ${C.muted}; margin-bottom: 9px; }
  .inline { display: flex; gap: 8px; align-items: flex-start; }
  .inline input, .inline textarea {
    flex: 1; min-width: 0; padding: 9px 11px; font-size: 13.5px; color: ${C.ink};
    background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 10px; outline: none;
    font-family: inherit; resize: vertical;
    &:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.16); }
  }
  .labels { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .labels em {
    display: inline-flex; align-items: center; gap: 4px; font-style: normal;
    font-size: 12px; font-weight: 600; color: var(--color-accent);
    background: rgba(249,115,22,0.12); border-radius: 7px; padding: 3px 8px;
    button { background: none; border: none; cursor: pointer; color: var(--color-accent); font-size: 15px; line-height: 1; padding: 0; }
  }
  .labels .hint, & .hint { font-size: 13px; color: ${C.mutedSoft}; }
`;
const Thread = styled.div`
  display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px;
  .comment { background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 11px; padding: 10px 12px; }
  .chead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
  .chead strong { font-size: 13px; color: ${C.ink}; }
  .cactions { display: flex; gap: 6px; }
  .cactions button { background: none; border: none; cursor: pointer; font-size: 12px; font-weight: 600; color: ${C.muted}; &:hover { color: var(--color-primary); } }
  .comment p { font-size: 13.5px; line-height: 1.5; color: ${C.ink}; }
`;

const ErrLine = styled.p`margin: 8px 0; font-size: 13px; color: ${C.danger};`;

const Empty = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const Card = styled.div`
  max-width: 420px; text-align: center;
  padding: 32px 28px; background: ${C.paper2};
  border: 1px solid ${C.line}; border-radius: 18px;
  h2 { font-size: 20px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin-bottom: 8px; }
  p { font-size: 14px; color: ${C.muted}; margin-bottom: 22px; line-height: 1.55; }
`;
const Row = styled.div`display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;`;

const Primary = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 10px 18px; font-size: 13.5px; font-weight: 600; border-radius: 10px; cursor: pointer;
  color: #fff; background: var(--color-primary); border: 1px solid var(--color-primary);
  transition: filter 0.18s, transform 0.15s;
  &:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
  &:disabled { opacity: 0.55; cursor: default; }
`;
const Secondary = styled.button`
  padding: 10px 16px; font-size: 13.5px; font-weight: 600; border-radius: 10px; cursor: pointer;
  color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line};
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: ${C.paper2}; border-color: var(--color-primary); }
`;
