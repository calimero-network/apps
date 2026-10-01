import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { Overlay } from './modalKit';
import { Button, Input, Label, Select } from './ui';
import type { ContactView, StageView } from '../hooks/useCrm';
import { fromDateInput, parseMoney, toDateInput, DAY_MS } from '../utils/crm';

export interface NewDealInput {
  title: string;
  value: number;
  organization: string;
  contactId: string | null;
  /** Set when the person is new: created first, then linked. */
  newContact: { name: string; email: string } | null;
  stageId: string;
  owner: string | null;
  expectedClose: number | null;
  source: string;
}

interface Props {
  stages: StageView[];
  contacts: ContactView[];
  owners: string[];
  defaultOwner: string;
  defaultStageId?: string;
  defaultContactId?: string;
  currency: string;
  onCreate: (input: NewDealInput) => Promise<void>;
  onClose: () => void;
}

const NEW = '__new__';
const SOURCES = ['Inbound', 'Outbound', 'Referral', 'Event', 'Partner', 'Existing customer'];

/**
 * The one form a salesperson fills in most, so it asks for as little as
 * possible: a title and (optionally) value. Everything else has a sensible
 * default — the first stage, you as owner, a close date a month out.
 */
export default function NewDealModal({
  stages, contacts, owners, defaultOwner, defaultStageId, defaultContactId, currency, onCreate, onClose,
}: Props): React.ReactElement {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [organization, setOrganization] = useState(
    () => contacts.find((c) => c.id === defaultContactId)?.organization ?? '',
  );
  const [contactId, setContactId] = useState(defaultContactId ?? '');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [stageId, setStageId] = useState(defaultStageId ?? stages[0]?.id ?? '');
  const [owner, setOwner] = useState(defaultOwner);
  const [close, setClose] = useState(() => toDateInput(Date.now() + 30 * DAY_MS));
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const parsedValue = parseMoney(value);
  const valid = !!title.trim() && parsedValue !== null && !!stageId && (contactId !== NEW || !!newName.trim());

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        value: parsedValue ?? 0,
        organization: organization.trim(),
        contactId: contactId && contactId !== NEW ? contactId : null,
        newContact: contactId === NEW ? { name: newName.trim(), email: newEmail.trim() } : null,
        stageId,
        owner: owner || null,
        expectedClose: fromDateInput(close),
        source,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Modal
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New deal"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
      >
        <header>
          <h3>New deal</h3>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="body">
          <Input
            className="title"
            data-testid="deal-title-input"
            placeholder="What are you selling, to whom? e.g. Acme — 50 seats"
            aria-label="Deal title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
          <div className="grid">
            <Label>
              Value ({currency})
              <Input
                data-testid="deal-value-input"
                inputMode="decimal"
                placeholder="e.g. 12k"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={parsedValue === null}
              />
            </Label>
            <Label>
              Organization
              <Input data-testid="deal-org-input" placeholder="Company" value={organization} onChange={(e) => setOrganization(e.target.value)} />
            </Label>
            <Label>
              Contact person
              <Select
                data-testid="deal-contact-select"
                value={contactId}
                onChange={(e) => {
                  setContactId(e.target.value);
                  const c = contacts.find((x) => x.id === e.target.value);
                  if (c?.organization && !organization) setOrganization(c.organization);
                }}
              >
                <option value="">— None —</option>
                <option value={NEW}>+ New person…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.organization ? ` · ${c.organization}` : ''}</option>
                ))}
              </Select>
            </Label>
            <Label>
              Stage
              <Select data-testid="deal-stage-select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.probability}%</option>)}
              </Select>
            </Label>
            {contactId === NEW && (
              <>
                <Label>
                  Name
                  <Input data-testid="deal-new-contact-name" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </Label>
                <Label>
                  Email
                  <Input data-testid="deal-new-contact-email" placeholder="name@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                </Label>
              </>
            )}
            <Label>
              Owner
              <Select data-testid="deal-owner-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">— Unassigned —</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Label>
            <Label>
              Expected close
              <Input type="date" data-testid="deal-close-input" value={close} onChange={(e) => setClose(e.target.value)} />
            </Label>
            <Label>
              Source
              <Select data-testid="deal-source-select" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">— Unknown —</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Label>
          </div>
          {error && <p className="err">{error}</p>}
        </div>
        <footer>
          <span className="hint">⌘/Ctrl + Enter to save</span>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button $variant="primary" data-testid="deal-create-submit" onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? 'Saving…' : 'Add deal'}
          </Button>
        </footer>
      </Modal>
    </Overlay>
  );
}

const Modal = styled.div`
  width: 100%; max-width: 560px; background: ${t.color.panel};
  border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusModal};
  box-shadow: 0 20px 60px rgba(0,0,0,0.55); color: ${t.color.text}; font-family: ${t.font.sans};
  header {
    display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid ${t.color.border};
    h3 { font-size: 14px; font-weight: 600; margin: 0; }
    .close { margin-left: auto; background: none; border: none; color: ${t.color.text3}; font-size: 20px; cursor: pointer; }
  }
  .body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
  .title { font-size: 15px; padding: 10px 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
  .err { color: ${t.color.urgent}; font-size: 12.5px; margin: 0; }
  footer {
    display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid ${t.color.border};
    .hint { margin-right: auto; font-size: 11px; color: ${t.color.text3}; }
  }
`;
