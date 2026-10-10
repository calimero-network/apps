import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { addDays, draftTotals, isDate, toLineInputs } from '../../utils/books';
import { describeError } from '../../utils/errors';
import LineEditor, { blankLine, editableFrom, type EditableLine } from '../../components/LineEditor';
import ContactModal from '../../components/ContactModal';
import { Button, ErrorText, Input, Label, Page, PageHead, Panel, Select, TextArea } from '../../components/ui';
import { useAppCtx } from './appContext';

const NEW_CONTACT = '__new__';

/**
 * Create or edit a DRAFT invoice or bill. Approving posts it to the ledger;
 * from then on it can only be paid or voided, so the editor refuses anything
 * that is not a draft and sends you to its page instead.
 */
export default function InvoiceEditorPage({ kind }: { kind: 'sales' | 'bill' }): React.ReactElement | null {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, today } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings, accounts, taxRates, contacts } = data;
  const cur = settings.currency;
  const base = `${APP_ROUTE}/${kind === 'sales' ? 'sales' : 'purchases'}`;
  const noun = kind === 'sales' ? 'invoice' : 'bill';
  const existing = id ? data.invoices.find((i) => i.id === id) : undefined;

  const defaultAccount = kind === 'sales' ? 'acc-sales' : 'acc-general';
  const defaultTax = accounts.find((a) => a.id === defaultAccount)?.default_tax_rate_id ?? 'tax-none';

  const [contactId, setContactId] = useState(params.get('contact') ?? '');
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, settings.payment_terms_days));
  const [dueTouched, setDueTouched] = useState(false);
  const [reference, setReference] = useState('');
  const [mode, setMode] = useState('exclusive');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLine[]>(() => [blankLine(defaultAccount, defaultTax)]);
  const [showContact, setShowContact] = useState(false);
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(!id);

  // Load the draft once the books have it.
  useEffect(() => {
    if (!id || hydrated || !existing) return;
    setContactId(existing.contact_id);
    setIssueDate(existing.issue_date);
    setDueDate(existing.due_date);
    setDueTouched(true);
    setReference(existing.reference);
    setMode(existing.amounts_are);
    setNotes(existing.notes);
    setLines(existing.lines.length ? editableFrom(existing.lines, cur) : [blankLine(defaultAccount, defaultTax)]);
    setHydrated(true);
  }, [id, hydrated, existing, cur, defaultAccount, defaultTax]);

  // Until someone picks a due date, it follows the issue date by the terms.
  useEffect(() => {
    if (!dueTouched && isDate(issueDate)) setDueDate(addDays(issueDate, settings.payment_terms_days));
  }, [issueDate, dueTouched, settings.payment_terms_days]);

  const rateOf = (rid: string) => taxRates.find((r) => r.id === rid)?.rate_bp ?? 0;
  const totals = useMemo(() => draftTotals(lines, mode, rateOf), [lines, mode, taxRates]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id && existing && existing.status !== 'draft') {
    return <Navigate to={`${base}/${id}`} replace />;
  }
  if (id && !existing) {
    return <Page><p>{data.loaded ? `That ${noun} is not in these books.` : 'Loading…'}</p></Page>;
  }

  const validate = (): string | null => {
    if (!contactId) return `Choose who the ${noun} is ${kind === 'sales' ? 'to' : 'from'}.`;
    if (!isDate(issueDate) || !isDate(dueDate)) return 'Enter valid dates.';
    if (dueDate < issueDate) return 'The due date is before the date.';
    const inputs = toLineInputs(lines);
    if (inputs.some((l) => !l.account_id)) return 'Every line needs an account.';
    return null;
  };

  const save = async (approve: boolean) => {
    const problem = validate() ?? (approve && totals.total <= 0 ? `An approved ${noun} must total more than zero.` : null);
    if (problem) { setError(problem); return; }
    setBusy(approve ? 'approve' : 'save');
    setError(null);
    const fields = {
      contact_id: contactId,
      reference,
      issue_date: issueDate,
      due_date: dueDate,
      amounts_are: mode,
      lines: toLineInputs(lines),
      notes,
    };
    try {
      const docId = await data.act(async (c) => {
        let target = id;
        if (target) await c.updateInvoice({ invoice_id: target, ...fields });
        else target = await c.createInvoice({ kind, ...fields });
        if (approve) await c.approveInvoice({ invoice_id: target });
        return target;
      });
      toast.show({ variant: 'success', description: approve ? `${noun[0].toUpperCase()}${noun.slice(1)} approved` : 'Draft saved' });
      navigate(`${base}/${docId}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page data-testid="invoice-editor">
      <PageHead>
        <h1>{id ? `Edit draft ${noun}` : `New ${noun}`}</h1>
      </PageHead>
      <Panel>
        <Head>
          <Label className="contact">
            {kind === 'sales' ? 'To' : 'From'}
            <Select
              value={contactId}
              data-testid="invoice-contact"
              onChange={(e) => {
                if (e.target.value === NEW_CONTACT) setShowContact(true);
                else setContactId(e.target.value);
              }}
            >
              <option value="">Choose a contact…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW_CONTACT}>+ New contact…</option>
            </Select>
          </Label>
          <Label>
            Date
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} data-testid="invoice-date" />
          </Label>
          <Label>
            Due date
            <Input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setDueTouched(true); }} data-testid="invoice-due" />
          </Label>
          <Label>
            {kind === 'sales' ? 'Reference' : 'Supplier invoice number'}
            <Input value={reference} onChange={(e) => setReference(e.target.value)} data-testid="invoice-reference" placeholder={kind === 'sales' ? 'PO number' : 'e.g. SUP-1042'} />
          </Label>
          <Label>
            Amounts are
            <Select value={mode} onChange={(e) => setMode(e.target.value)} data-testid="invoice-mode">
              <option value="exclusive">{settings.tax_label} exclusive</option>
              <option value="inclusive">{settings.tax_label} inclusive</option>
              <option value="none">No {settings.tax_label}</option>
            </Select>
          </Label>
        </Head>
      </Panel>

      <Panel>
        <LineEditor
          lines={lines}
          onChange={setLines}
          accounts={accounts}
          taxRates={taxRates}
          mode={mode}
          currency={cur}
          taxLabel={settings.tax_label}
        />
      </Panel>

      <Panel>
        <Label>
          {kind === 'sales' ? 'Terms and notes (printed on the invoice)' : 'Notes'}
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="invoice-notes" />
        </Label>
      </Panel>

      {error && <ErrorText data-testid="invoice-error">{error}</ErrorText>}
      <Footer>
        <Button type="button" onClick={() => navigate(id ? `${base}/${id}` : base)} disabled={!!busy}>Cancel</Button>
        <Button type="button" onClick={() => save(false)} disabled={!!busy} data-testid="invoice-save-draft">
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </Button>
        <Button type="button" $variant="primary" onClick={() => save(true)} disabled={!!busy} data-testid="invoice-approve">
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
      </Footer>

      {showContact && (
        <ContactModal act={data.act} onClose={() => setShowContact(false)} onSaved={(cid) => setContactId(cid)} />
      )}
    </Page>
  );
}

const Head = styled.div`
  display: grid; gap: 12px; grid-template-columns: 2fr repeat(4, 1fr);
  @media (max-width: 1100px) { grid-template-columns: 1fr 1fr; .contact { grid-column: 1 / -1; } }
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; position: sticky; bottom: 0;
  background: ${t.color.bg}; padding: 10px 0;
`;
