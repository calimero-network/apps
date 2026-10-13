import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useToast } from '@calimero-network/mero-ui';
import type { ListView } from '../generated/BoardClient';
import { tokens as t } from '../theme';
import { useCard } from '../hooks/useCard';
import type { UseAliasesReturn } from '../hooks/useAliases';
import type { Workspace } from '../hooks/useBoards';
import { describeError } from '../utils/errors';
import { formatDate, fromDateInput, relativeTime, toDateInput } from '../utils/display';
import { Overlay, Dialog, Close } from './modalKit';
import LabelChip from './LabelChip';
import InlineForm from './InlineForm';
import CommentItem from './CommentItem';

export interface CardModalProps {
  cardId: string;
  ws: Workspace;
  aliases: UseAliasesReturn;
  currentUser: string;
  members: string[];
  lists: ListView[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

/** The card detail dialog: title, description, assignee, due, labels, checklist, comments. */
export default function CardModal({ cardId, ws, aliases, currentUser, members, lists, onClose, onChanged }: CardModalProps): React.ReactElement {
  const card = useCard(ws, cardId);
  const toast = useToast();
  const d = card.detail;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [addingLabel, setAddingLabel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed each draft only when its server value changes, so a live refresh
  // caused by some other field (or another member) does not wipe what is typed.
  const srvTitle = d?.card.title;
  const srvDescription = d?.card.description;
  const srvAssignee = d?.card.assignee;
  const srvDue = d?.card.due_at;
  useEffect(() => { if (srvTitle !== undefined) setTitle(srvTitle); }, [srvTitle]);
  useEffect(() => { if (srvDescription !== undefined) setDescription(srvDescription); }, [srvDescription]);
  useEffect(() => { if (srvAssignee !== undefined) setAssignee(srvAssignee ?? ''); }, [srvAssignee]);
  useEffect(() => { if (srvDue !== undefined) setDue(toDateInput(srvDue)); }, [srvDue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** A button action: failures surface as a toast. Resolves true on success. */
  const run = async (p: Promise<unknown>): Promise<boolean> => {
    try {
      await p;
      await onChanged();
      return true;
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
      return false;
    }
  };
  /** A form submit: failures propagate so InlineForm shows them inline and keeps the text. */
  const submit = async (p: Promise<unknown>): Promise<void> => {
    await p;
    await onChanged();
  };

  const listName = d ? lists.find((l) => l.id === d.card.list_id)?.name ?? '' : '';
  const mine = d?.card.created_by === currentUser;

  return (
    <Backdrop onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Panel data-testid="card-modal" role="dialog" aria-modal="true" aria-label={d?.card.title || 'Card'}>
        <Close type="button" data-testid="action-close" onClick={onClose} aria-label="Close">×</Close>
        {!d ? (
          <p className="muted">{card.error ? describeError(card.error) : 'Loading…'}</p>
        ) : (
          <>
            <Row>
              <input className="title" data-testid="field-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
              {title.trim() !== '' && title.trim() !== d.card.title && (
                <button type="button" className="primary" data-testid="action-set_title" onClick={() => void run(card.setTitle(title.trim()))}>Save</button>
              )}
            </Row>
            <p className="muted">
              in <b>{listName || '—'}</b> · created {relativeTime(d.card.created_at)} by {aliases.resolve(d.card.created_by)}
              {d.card.archived && ' · archived'}
            </p>

            <Section>
              <h3>Description</h3>
              <textarea data-testid="field-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add details…" />
              {description !== d.card.description && (
                <div><button type="button" className="primary" data-testid="action-set_description" onClick={() => void run(card.setDescription(description))}>Save</button></div>
              )}
            </Section>

            <Grid>
              <Section>
                <h3>Assignee</h3>
                <input data-testid="field-assignee" list="card-assignee-members" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="account id" />
                <datalist id="card-assignee-members">{members.map((m) => <option key={m} value={m}>{aliases.resolve(m)}</option>)}</datalist>
                {d.card.assignee && <span className="muted">{aliases.resolve(d.card.assignee)}</span>}
                {(assignee.trim() || null) !== d.card.assignee && (
                  <div><button type="button" className="primary" data-testid="action-set_assignee" onClick={() => void run(card.setAssignee(assignee.trim() || null))}>Save</button></div>
                )}
              </Section>
              <Section>
                <h3>Due</h3>
                <input type="date" data-testid="field-due" value={due} onChange={(e) => setDue(e.target.value)} />
                {d.card.due_at !== null && <span className="muted">{formatDate(d.card.due_at)}</span>}
                {due !== toDateInput(d.card.due_at) && (
                  <div><button type="button" className="primary" data-testid="action-set_due" onClick={() => void run(card.setDue(fromDateInput(due)))}>Save</button></div>
                )}
              </Section>
            </Grid>

            <Section>
              <h3>Labels</h3>
              <div className="chips">
                {d.card.labels.map((l) => (
                  <span key={l} className="chip">
                    <LabelChip label={l} />
                    <button type="button" className="x" data-testid="action-remove_label" data-label={l} aria-label={`Remove ${l}`} onClick={() => void run(card.removeLabel(l))}>×</button>
                  </span>
                ))}
                {!addingLabel && (
                  <button type="button" className="ghost" data-testid="action-add_label" onClick={() => setAddingLabel(true)}>+ Add</button>
                )}
              </div>
              {addingLabel && (
                <InlineForm placeholder="label" submitLabel="Add" testId="label" inputTestId="field-label"
                  onSubmit={async (l) => { await submit(card.addLabel(l)); setAddingLabel(false); }}
                  onCancel={() => setAddingLabel(false)} />
              )}
            </Section>

            <Section>
              <h3>Checklist {d.card.checklist_total > 0 && <span className="muted">{d.card.checklist_done}/{d.card.checklist_total}</span>}</h3>
              <ul className="checklist">
                {d.checklist.map((i) => (
                  <li key={i.id} data-testid="item-checklist" data-item-id={i.id} className={i.done ? 'done' : ''}>
                    <input type="checkbox" data-testid="checklist-toggle" checked={i.done} aria-label={i.text}
                      onChange={(e) => void run(card.setItemDone(i.id, e.target.checked))} />
                    <span className="text">{i.text}</span>
                    <button type="button" className="x" data-testid="checklist-remove" aria-label="Remove item" onClick={() => void run(card.removeItem(i.id))}>×</button>
                  </li>
                ))}
              </ul>
              <InlineForm placeholder="Add an item" submitLabel="Add" testId="checklist" inputTestId="field-checklist" submitTestId="action-add_checklist_item"
                autoFocus={false} onSubmit={(text) => submit(card.addChecklistItem(text))} />
            </Section>

            <Section>
              <h3>Comments</h3>
              <div className="comments">
                {d.comments.map((c) => (
                  <CommentItem key={c.id} comment={c} mine={c.author === currentUser} authorLabel={aliases.resolve(c.author)}
                    onEdit={async (body) => { if (!(await run(card.editComment(c.id, body)))) throw new Error('edit failed'); }} onDelete={() => run(card.deleteComment(c.id))} />
                ))}
              </div>
              <InlineForm placeholder="Write a comment" submitLabel="Comment" testId="comment" inputTestId="field-body" submitTestId="action-add_comment"
                autoFocus={false} onSubmit={(body) => submit(card.addComment(body))} />
            </Section>

            <Footer>
              <button type="button" data-testid="action-archive_card" onClick={() => void run(card.setArchived(!d.card.archived))}>
                {d.card.archived ? 'Unarchive' : 'Archive'}
              </button>
              {mine && !confirmDelete && (
                <button type="button" className="danger" data-testid="action-delete_card" onClick={() => setConfirmDelete(true)}>Delete card</button>
              )}
              {mine && confirmDelete && (
                <>
                  <span className="muted">Delete this card for everyone?</span>
                  <button type="button" className="danger" data-testid="confirm-delete_card"
                    onClick={async () => { if (await run(card.deleteCard())) onClose(); }}>Delete</button>
                  <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </>
              )}
            </Footer>
          </>
        )}
      </Panel>
    </Backdrop>
  );
}

const Backdrop = styled(Overlay)`
  align-items: flex-start; overflow-y: auto; padding: 48px 20px;
`;
const Panel = styled(Dialog)`
  max-width: 680px; max-height: calc(100vh - 96px); overflow-y: auto; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 6px;
  .muted { font-size: 12.5px; color: ${t.color.text3}; margin: 0; }
  .muted b { color: ${t.color.text2}; font-weight: 600; }
  input:not([type='checkbox']), textarea {
    width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px;
    color: ${t.color.text}; background: ${t.color.raised};
    border: 1px solid ${t.color.border}; border-radius: ${t.radius}; padding: 8px 10px; outline: none;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; }
  }
  textarea { resize: vertical; line-height: 1.5; }
  button { font-family: inherit; }
  button.primary {
    background: ${t.color.accent}; color: ${t.color.onAccent}; border: 0; border-radius: ${t.radius};
    padding: 6px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  button.ghost { background: transparent; color: ${t.color.text2}; border: 1px dashed ${t.color.border}; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
  button.ghost:hover { color: ${t.color.text}; border-color: ${t.color.accentBorder}; }
  button.x { background: none; border: 0; color: ${t.color.text3}; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 4px; }
  button.x:hover { color: ${t.color.danger}; }
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 8px; padding-right: 36px;
  input.title { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; background: transparent; border-color: transparent; padding: 6px 8px; }
  input.title:hover { border-color: ${t.color.border}; }
`;
const Section = styled.section`
  display: flex; flex-direction: column; gap: 8px; margin-top: 14px; min-width: 0;
  h3 { margin: 0; font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; display: flex; gap: 8px; align-items: baseline; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { display: inline-flex; align-items: center; }
  .checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .checklist li { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 2px; border-radius: ${t.radiusSm}; }
  .checklist li:hover { background: ${t.color.raised}; }
  .checklist li .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .checklist li.done .text { color: ${t.color.text3}; text-decoration: line-through; }
  .checklist input[type='checkbox'] { accent-color: ${t.color.accent}; }
  .comments { display: flex; flex-direction: column; gap: 14px; }
`;
const Grid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;
const Footer = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 20px; padding-top: 16px; border-top: 1px solid ${t.color.border};
  button {
    background: ${t.color.raised}; color: ${t.color.text}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  button.danger { color: ${t.color.danger}; border-color: ${t.color.dangerBorder}; background: transparent; }
  button.danger:hover { background: rgba(229,105,95,0.08); }
`;
