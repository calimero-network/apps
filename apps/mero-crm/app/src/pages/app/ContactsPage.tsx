import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { Overlay, Dialog, Close, Actions, ErrorLine } from '../../components/modalKit';
import { Button, Empty, Input, Label, Money, Page, Row, Table } from '../../components/ui';
import { contactMatches } from '../../utils/crm';
import { describeError } from '../../utils/errors';
import type { ContactView } from '../../hooks/useCrm';
import { useAppCtx } from './appContext';

type Draft = { name: string; email: string; phone: string; organization: string; job_title: string };
const BLANK: Draft = { name: '', email: '', phone: '', organization: '', job_title: '' };

/** The address book: the people behind the deals, with what each is worth. */
export default function ContactsPage(): React.ReactElement {
  const { data, searchQuery, currentUser, openNewDeal } = useAppCtx();
  const toast = useToast();
  const [editing, setEditing] = useState<ContactView | 'new' | null>(null);
  const { currency } = data.settings;

  const rows = useMemo(() => data.contacts.filter((c) => contactMatches(c, searchQuery)), [data.contacts, searchQuery]);

  const save = async (draft: Draft) => {
    if (editing === 'new') {
      await data.act((c) => c.createContact(draft));
      toast.show({ variant: 'success', description: `Added ${draft.name}` });
    } else if (editing) {
      await data.act((c) => c.updateContact({ contact_id: editing.id, ...draft }));
    }
  };

  const remove = async (c: ContactView) => {
    if (!window.confirm(`Delete ${c.name}? Their deals stay, without a contact person.`)) return;
    try {
      await data.act((x) => x.deleteContact({ contact_id: c.id }));
      setEditing(null);
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  };

  return (
    <Page>
      <Row>
        <span style={{ fontSize: 12.5, color: t.color.text2 }}>{rows.length} people</span>
        <Button $variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')} data-testid="new-contact-btn">+ Person</Button>
      </Row>
      {rows.length === 0 ? (
        <Empty>
          <strong>{searchQuery.trim() ? `Nobody matches “${searchQuery.trim()}”` : 'No people yet'}</strong>
          Add the people you sell to, then link them to deals.
        </Empty>
      ) : (
        <Table data-testid="contacts-table">
          <thead>
            <tr>
              <th>Name</th><th>Organization</th><th>Email</th><th>Phone</th>
              <th className="num">Open deals</th><th className="num">Won</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} data-testid="contact-row" onClick={() => setEditing(c)}>
                <td><div className="title">{c.name}</div>{c.job_title && <div className="muted">{c.job_title}</div>}</td>
                <td>{c.organization || <span className="muted">—</span>}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>{c.email}</a> : <span className="muted">—</span>}</td>
                <td>{c.phone || <span className="muted">—</span>}</td>
                <td className="num">{c.open_deals}</td>
                <td className="num">{c.won_value ? <Money value={c.won_value} currency={currency} /> : <span className="muted">—</span>}</td>
                <td className="num">
                  <Button $small onClick={(e) => { e.stopPropagation(); openNewDeal({ contactId: c.id }); }}>+ Deal</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <ContactDialog
          initial={editing === 'new' ? BLANK : editing}
          isNew={editing === 'new'}
          canDelete={editing !== 'new' && editing.created_by === currentUser}
          onSave={save}
          onDelete={editing !== 'new' ? () => remove(editing) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

function ContactDialog({
  initial, isNew, canDelete, onSave, onDelete, onClose,
}: {
  initial: Draft;
  isNew: boolean;
  canDelete: boolean;
  onSave: (d: Draft) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>({
    name: initial.name, email: initial.email, phone: initial.phone, organization: initial.organization, job_title: initial.job_title,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const submit = async () => {
    if (!d.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { await onSave(d); onClose(); } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };
  const field = (key: keyof Draft, label: string, placeholder = '') => (
    <Label>
      {label}
      <Input
        value={d[key]}
        placeholder={placeholder}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        data-testid={`contact-${key}`}
        autoFocus={key === 'name'}
      />
    </Label>
  );
  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isNew ? 'New person' : 'Edit person'}>
        <Close onClick={onClose} aria-label="Close">×</Close>
        <h3>{isNew ? 'New person' : initial.name}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {field('name', 'Name', 'Full name')}
          {field('organization', 'Organization', 'Company')}
          {field('job_title', 'Job title', 'e.g. Head of Operations')}
          {field('email', 'Email', 'name@company.com')}
          {field('phone', 'Phone', '+1 555 0100')}
        </div>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          {canDelete && onDelete && <Button $variant="danger" style={{ marginRight: 'auto' }} onClick={onDelete}>Delete</Button>}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button $variant="primary" onClick={() => void submit()} disabled={!d.name.trim() || busy} data-testid="contact-save">
            {busy ? 'Saving…' : isNew ? 'Add person' : 'Save'}
          </Button>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
