import React, { useState } from 'react';
import styled from 'styled-components';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useQuery } from '../../hooks/useBooks';
import {
  amountToInput, documentLabel, documentStatus, formatAmount, formatDay, formatMoney, formatQuantity,
  formatRate, parseAmount,
} from '../../utils/books';
import { relativeTime } from '../../utils/display';
import { describeError } from '../../utils/errors';
import {
  Button, ErrorText, FieldGrid, Input, Label, Modal, Page, Panel, Row, Select, StatusBadge, Table, TextArea,
} from '../../components/ui';
import type { InvoiceView } from '../../generated/BooksClient';
import { useAppCtx } from './appContext';

/**
 * One invoice or bill: the document as it prints, what has been paid against
 * it, and its audit trail. A draft can be edited, approved or deleted; an
 * approved document can be paid or voided, never edited.
 */
export default function InvoiceDetailPage({ kind }: { kind: 'sales' | 'bill' }): React.ReactElement {
  const { id = '' } = useParams();
  const { data, today, aliases } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const base = `${APP_ROUTE}/${kind === 'sales' ? 'sales' : 'purchases'}`;
  const { data: detail, error } = useQuery(data, (c) => c.getInvoice({ invoice_id: id }), [id]);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState('');
  const { settings } = data;
  const cur = settings.currency;
  const noun = kind === 'sales' ? 'invoice' : 'bill';

  if (error && !detail) {
    return (
      <Page>
        <p>That {noun} is not in these books. <Link to={base}>Back to the list</Link></p>
      </Page>
    );
  }
  if (!detail) return <Page><p>Loading…</p></Page>;

  const inv = detail.invoice;
  const status = documentStatus(inv, today);
  const contact = data.contacts.find((c) => c.id === inv.contact_id);
  const accountName = (aid: string) => {
    const a = data.accounts.find((x) => x.id === aid);
    return a ? `${a.code} · ${a.name}` : aid;
  };
  const who = (account: string) => (account ? aliases.resolve(account) : 'someone');

  const run = async (label: string, fn: Parameters<typeof data.act>[0]) => {
    try {
      await data.act(fn);
      toast.show({ variant: 'success', description: label });
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  };

  const voidIt = async (recordId: string, what: string) => {
    const reason = window.prompt(`Void this ${what}? Give a reason (it is kept in the history).`);
    if (reason === null) return;
    await run(`${what[0].toUpperCase()}${what.slice(1)} voided`, (c) => c.voidRecord({ record_id: recordId, reason }));
  };

  const livePayments = detail.payments.filter((p) => !p.voided);

  return (
    <Page data-testid="invoice-detail">
      <Actions className="no-print">
        <StatusBadge status={status} />
        {inv.conflicted && (
          <span className="warn" title="Two members filed an approval for this document; the earliest is used.">
            Conflicting approvals
          </span>
        )}
        <div className="spacer" />
        {inv.status === 'draft' && (
          <>
            <Button onClick={() => navigate(`${base}/${inv.id}/edit`)} data-testid="invoice-edit">Edit</Button>
            <Button
              $variant="danger"
              data-testid="invoice-delete"
              onClick={async () => {
                if (!window.confirm(`Delete this draft ${noun}?`)) return;
                try {
                  await data.act((c) => c.deleteInvoice({ invoice_id: inv.id }));
                  navigate(base);
                } catch (err) {
                  toast.show({ variant: 'error', description: describeError(err) });
                }
              }}
            >Delete</Button>
            <Button $variant="primary" data-testid="invoice-approve-detail"
              onClick={() => run(`${noun[0].toUpperCase()}${noun.slice(1)} approved`, (c) => c.approveInvoice({ invoice_id: inv.id }))}>
              Approve
            </Button>
          </>
        )}
        {(status === 'awaiting_payment' || status === 'overdue') && (
          <Button $variant="success" onClick={() => setPaying(true)} data-testid="record-payment">
            {kind === 'sales' ? 'Record payment received' : 'Record payment made'}
          </Button>
        )}
        {inv.status !== 'draft' && inv.status !== 'void' && (
          <Button
            $variant="danger"
            data-testid="invoice-void"
            disabled={livePayments.length > 0}
            title={livePayments.length > 0 ? 'Void its payments first' : undefined}
            onClick={() => voidIt(inv.id, noun)}
          >Void</Button>
        )}
        <Button
          data-testid="invoice-copy"
          onClick={async () => {
            try {
              const copy = await data.act((c) => c.createInvoice({
                kind,
                contact_id: inv.contact_id,
                reference: inv.reference,
                issue_date: today,
                due_date: today > inv.due_date ? today : inv.due_date,
                amounts_are: inv.amounts_are,
                lines: inv.lines.map((l) => ({
                  description: l.description, quantity: l.quantity, unit_price: l.unit_price,
                  account_id: l.account_id, tax_rate_id: l.tax_rate_id,
                })),
                notes: inv.notes,
              }));
              navigate(`${base}/${copy}/edit`);
            } catch (err) {
              toast.show({ variant: 'error', description: describeError(err) });
            }
          }}
        >Copy</Button>
        {kind === 'sales' && contact?.email && (
          <Button as="a" href={mailtoFor(inv, contact.email, settings.organisation_name, cur)}>Email</Button>
        )}
        <Button onClick={() => window.print()}>Print / PDF</Button>
      </Actions>

      <Doc data-testid="invoice-document">
        <header>
          <div>
            <div className="org">{settings.organisation_name || 'Your organisation'}</div>
            {settings.tax_number && <div className="muted">{settings.tax_label} no. {settings.tax_number}</div>}
          </div>
          <div className="title">
            <div className="kind">{kind === 'sales' ? (inv.status === 'draft' ? 'Draft invoice' : 'Tax invoice') : 'Bill'}</div>
            <div className="number" data-testid="invoice-number">{documentLabel(inv)}</div>
          </div>
        </header>
        <div className="meta">
          <div>
            <div className="lbl">{kind === 'sales' ? 'Bill to' : 'From'}</div>
            <div className="strong">
              {contact ? <Link to={`${APP_ROUTE}/contacts/${contact.id}`}>{inv.contact_name}</Link> : inv.contact_name}
            </div>
            {contact?.address && <div className="addr">{contact.address}</div>}
            {contact?.tax_number && <div className="muted">{settings.tax_label} no. {contact.tax_number}</div>}
          </div>
          <dl>
            <dt>Date</dt><dd>{formatDay(inv.issue_date)}</dd>
            <dt>Due</dt><dd className={status === 'overdue' ? 'neg' : ''}>{formatDay(inv.due_date)}</dd>
            {inv.reference && (<><dt>Reference</dt><dd>{inv.reference}</dd></>)}
          </dl>
        </div>

        <Table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="no-print">Account</th>
              {inv.amounts_are !== 'none' && <th className="num">{settings.tax_label}</th>}
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description || <span className="muted">—</span>}</td>
                <td className="num">{formatQuantity(l.quantity)}</td>
                <td className="num">{formatAmount(l.unit_price, cur)}</td>
                <td className="muted no-print">{accountName(l.account_id)}</td>
                {inv.amounts_are !== 'none' && <td className="num muted">{formatRate(l.tax_bp)}</td>}
                <td className="num">{formatAmount(l.net + (inv.amounts_are === 'inclusive' ? l.tax : 0), cur)}</td>
              </tr>
            ))}
          </tbody>
        </Table>

        <Totals>
          <dt>Subtotal</dt><dd>{formatAmount(inv.subtotal, cur)}</dd>
          {inv.amounts_are !== 'none' && (
            <><dt>{inv.amounts_are === 'inclusive' ? `Includes ${settings.tax_label}` : `Total ${settings.tax_label}`}</dt><dd>{formatAmount(inv.tax_total, cur)}</dd></>
          )}
          <dt className="grand">Total {cur}</dt><dd className="grand" data-testid="invoice-total">{formatAmount(inv.total, cur)}</dd>
          {inv.paid > 0 && (<><dt>Less amount paid</dt><dd>{formatAmount(inv.paid, cur)}</dd></>)}
          {inv.status !== 'draft' && inv.status !== 'void' && (
            <><dt className="due">Amount due</dt><dd className="due" data-testid="invoice-amount-due">{formatMoney(inv.amount_due, cur)}</dd></>
          )}
        </Totals>
        {inv.notes && <p className="notes">{inv.notes}</p>}
        {inv.status === 'void' && <div className="voidmark">VOID{inv.void_reason ? ` — ${inv.void_reason}` : ''}</div>}
      </Doc>

      {detail.payments.length > 0 && (
        <Panel className="no-print">
          <h3>Payments</h3>
          <Table>
            <thead>
              <tr><th>Date</th><th>Account</th><th>Reference</th><th>Recorded by</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {detail.payments.map((p) => (
                <tr key={p.id} className={p.voided ? 'voided' : ''} data-testid="payment-row">
                  <td>{formatDay(p.date)}</td>
                  <td>{accountName(p.bank_account_id)}</td>
                  <td>{p.reference || <span className="muted">—</span>}</td>
                  <td className="muted">{who(p.recorded_by)}</td>
                  <td className="num">{formatAmount(p.amount, cur)}</td>
                  <td className="num">
                    {!p.voided && <Button $small $variant="danger" onClick={() => voidIt(p.id, 'payment')}>Remove</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <Panel className="no-print">
        <h3>History and notes</h3>
        <History>
          {detail.history.map((h) => (
            <li key={`${h.id}-${h.author}`} className={h.action === 'note' ? 'note' : ''}>
              <span className="who">{who(h.author)}</span>
              <span className="what">{h.action === 'note' ? h.detail : `${h.detail}`}</span>
              <span className="when" title={new Date(h.at).toLocaleString()}>{relativeTime(h.at)}</span>
            </li>
          ))}
        </History>
        <Row $gap={8}>
          <TextArea rows={1} value={note} placeholder="Add a note…" onChange={(e) => setNote(e.target.value)} data-testid="note-input" />
          <Button
            disabled={!note.trim()}
            data-testid="note-add"
            onClick={async () => { await run('Note added', (c) => c.addNote({ record_id: inv.id, body: note })); setNote(''); }}
          >Add note</Button>
        </Row>
      </Panel>

      {paying && (
        <PaymentModal invoice={inv} onClose={() => setPaying(false)} />
      )}
    </Page>
  );
}

function mailtoFor(inv: InvoiceView, email: string, org: string, cur: string): string {
  const subject = `Invoice ${documentLabel(inv)} from ${org || 'us'}`;
  const body = [
    `Hi ${inv.contact_name},`,
    '',
    `Here is invoice ${documentLabel(inv)} for ${formatMoney(inv.total, cur)}, due ${formatDay(inv.due_date)}.`,
    inv.amount_due > 0 && inv.amount_due !== inv.total ? `Amount still due: ${formatMoney(inv.amount_due, cur)}.` : null,
    '',
    'Thank you for your business.',
    org,
  ].filter((l): l is string => l !== null).join('\n');
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function PaymentModal({ invoice, onClose }: { invoice: InvoiceView; onClose: () => void }) {
  const { data, today } = useAppCtx();
  const toast = useToast();
  const cur = data.settings.currency;
  const banks = data.accounts.filter((a) => a.account_type === 'bank' && !a.archived);
  const [bank, setBank] = useState(banks[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [amountText, setAmountText] = useState(amountToInput(invoice.amount_due, cur));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const amount = parseAmount(amountText, cur);
    if (!amount || amount <= 0) { setError('Enter the amount paid.'); return; }
    if (amount > invoice.amount_due) { setError(`That is more than the ${formatMoney(invoice.amount_due, cur)} due.`); return; }
    if (!bank) { setError('Choose the bank account.'); return; }
    setBusy(true);
    setError(null);
    try {
      await data.act((c) => c.recordPayment({ invoice_id: invoice.id, bank_account_id: bank, date, amount, reference }));
      toast.show({ variant: 'success', description: 'Payment recorded' });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={invoice.kind === 'sales' ? 'Record a payment received' : 'Record a payment made'}
      sub={`${documentLabel(invoice)} · ${invoice.contact_name} · ${formatMoney(invoice.amount_due, cur)} due`}
      onClose={onClose}
      testId="payment-modal"
    >
      <FieldGrid>
        <Label>
          Amount
          <Input value={amountText} onChange={(e) => setAmountText(e.target.value)} data-testid="payment-amount" />
        </Label>
        <Label>
          Date paid
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="payment-date" />
        </Label>
      </FieldGrid>
      <Label>
        {invoice.kind === 'sales' ? 'Paid into' : 'Paid from'}
        <Select value={bank} onChange={(e) => setBank(e.target.value)} data-testid="payment-bank">
          {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </Select>
      </Label>
      <Label>
        Reference
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
      </Label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="actions">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button $variant="success" onClick={submit} disabled={busy} data-testid="payment-save">
          {busy ? 'Recording…' : 'Record payment'}
        </Button>
      </div>
    </Modal>
  );
}

const Actions = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  .spacer { flex: 1; }
  .warn { color: ${t.color.high}; font-size: 12.5px; font-weight: 600; }
`;
const Doc = styled.article`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px;
  padding: 32px 36px; position: relative; overflow: hidden;
  header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
  .org { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  .title { text-align: right; }
  .kind { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: ${t.color.text3}; font-weight: 700; }
  .number { font-size: 22px; font-weight: 700; }
  .meta { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 22px; flex-wrap: wrap; }
  .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: ${t.color.text3}; font-weight: 700; margin-bottom: 4px; }
  .strong { font-weight: 700; a { color: ${t.color.accent}; } }
  .addr { white-space: pre-line; color: ${t.color.text2}; margin-top: 2px; }
  .muted { color: ${t.color.text3}; font-size: 12.5px; }
  .neg { color: ${t.color.urgent}; }
  dl { display: grid; grid-template-columns: auto auto; gap: 4px 18px; margin: 0; font-size: 13px; }
  dt { color: ${t.color.text3}; text-align: right; }
  dd { margin: 0; font-weight: 600; }
  .notes { white-space: pre-line; color: ${t.color.text2}; margin: 22px 0 0; font-size: 12.5px; border-top: 1px solid ${t.color.border}; padding-top: 14px; }
  .voidmark {
    position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg);
    font-size: 54px; font-weight: 800; color: rgba(217,45,32,0.16); white-space: nowrap; pointer-events: none;
  }
  @media (max-width: 720px) { padding: 18px; }
`;
const Totals = styled.dl`
  display: grid !important; grid-template-columns: 1fr auto; gap: 6px 28px !important;
  max-width: 340px; margin: 16px 0 0 auto !important; font-size: 13.5px !important;
  dd { text-align: right; font-variant-numeric: tabular-nums; }
  .grand { font-size: 16px; font-weight: 700; color: ${t.color.text}; border-top: 2px solid ${t.color.borderStrong}; padding-top: 8px; }
  .due { font-size: 17px; font-weight: 800; color: ${t.color.text}; }
`;
const History = styled.ul`
  list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px;
  li { display: flex; gap: 10px; align-items: baseline; }
  .who { font-weight: 600; min-width: 110px; }
  .what { flex: 1; color: ${t.color.text2}; white-space: pre-line; }
  .note .what { color: ${t.color.text}; }
  .when { color: ${t.color.text3}; font-size: 12px; white-space: nowrap; }
`;
