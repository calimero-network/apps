import React, { useState } from 'react';
import styled from 'styled-components';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { documentLabel, documentStatus, formatAmount, formatDay, formatMoney } from '../../utils/books';
import { describeError } from '../../utils/errors';
import ContactModal from '../../components/ContactModal';
import { Button, Empty, Grid, Page, PageHead, Panel, Stat, StatusBadge, Table } from '../../components/ui';
import { useAppCtx } from './appContext';

/** One contact: their details, balances each way, and every document with them. */
export default function ContactDetailPage(): React.ReactElement {
  const { id = '' } = useParams();
  const { data, today } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const contact = data.contacts.find((c) => c.id === id);
  const cur = data.settings.currency;

  if (!contact) {
    return (
      <Page>
        <p>{data.loaded ? 'That contact is not in these books.' : 'Loading…'} <Link to={`${APP_ROUTE}/contacts`}>All contacts</Link></p>
      </Page>
    );
  }

  const docs = data.invoices.filter((i) => i.contact_id === id);
  const overdue = docs
    .filter((d) => d.kind === 'sales' && documentStatus(d, today) === 'overdue')
    .reduce((s, d) => s + d.amount_due, 0);
  const spent = data.bankTransactions.filter((b) => b.contact_id === id && !b.voided);

  return (
    <Page data-testid="contact-detail">
      <PageHead>
        <div>
          <h1 data-testid="contact-title">{contact.name}</h1>
          <div className="sub">{[contact.email, contact.phone].filter(Boolean).join(' · ') || 'No contact details yet'}</div>
        </div>
        <div className="actions">
          <Button onClick={() => setEditing(true)} data-testid="contact-edit">Edit</Button>
          <Button onClick={() => navigate(`${APP_ROUTE}/purchases/new?contact=${id}`)}>New bill</Button>
          <Button $variant="primary" onClick={() => navigate(`${APP_ROUTE}/sales/new?contact=${id}`)} data-testid="contact-new-invoice">
            New invoice
          </Button>
        </div>
      </PageHead>

      <Grid $min={200}>
        <Stat><div className="k">Owes you</div><div className="v" data-testid="contact-receivable">{formatMoney(contact.receivable, cur)}</div></Stat>
        <Stat><div className="k">Overdue</div><div className="v" style={{ color: overdue ? t.color.urgent : undefined }}>{formatMoney(overdue, cur)}</div></Stat>
        <Stat><div className="k">You owe</div><div className="v">{formatMoney(contact.payable, cur)}</div></Stat>
      </Grid>

      {(contact.address || contact.tax_number) && (
        <Panel>
          <h3>Details</h3>
          <Details>
            {contact.address && <div><span>Address</span><p>{contact.address}</p></div>}
            {contact.tax_number && <div><span>{data.settings.tax_label} number</span><p>{contact.tax_number}</p></div>}
          </Details>
        </Panel>
      )}

      <Panel>
        <h3>Invoices and bills</h3>
        {docs.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><th>Type</th><th>Number</th><th>Date</th><th>Due</th><th className="num">Total</th><th className="num">Due</th><th>Status</th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="click" onClick={() => navigate(`${APP_ROUTE}/${d.kind === 'sales' ? 'sales' : 'purchases'}/${d.id}`)}>
                  <td>{d.kind === 'sales' ? 'Invoice' : 'Bill'}</td>
                  <td className="strong">{documentLabel(d)}</td>
                  <td>{formatDay(d.issue_date)}</td>
                  <td>{formatDay(d.due_date)}</td>
                  <td className="num">{formatAmount(d.total, cur)}</td>
                  <td className="num">{formatAmount(d.amount_due, cur)}</td>
                  <td><StatusBadge status={documentStatus(d, today)} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {spent.length > 0 && (
        <Panel>
          <h3>Spend and receive money</h3>
          <Table>
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {spent.map((b) => (
                <tr key={b.id}>
                  <td>{formatDay(b.date)}</td>
                  <td>{b.kind === 'spend' ? 'Spent' : 'Received'}</td>
                  <td>{b.reference || b.lines[0]?.description || '—'}</td>
                  <td className="num">{formatAmount(b.total, cur)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {docs.length === 0 && spent.length === 0 && (
        <div>
          <Button
            $variant="danger"
            data-testid="contact-delete"
            onClick={async () => {
              if (!window.confirm(`Delete ${contact.name}?`)) return;
              try {
                await data.act((c) => c.deleteContact({ contact_id: id }));
                navigate(`${APP_ROUTE}/contacts`);
              } catch (err) {
                toast.show({ variant: 'error', description: describeError(err) });
              }
            }}
          >Delete contact</Button>
        </div>
      )}

      {editing && <ContactModal contact={contact} act={data.act} onClose={() => setEditing(false)} />}
    </Page>
  );
}

const Details = styled.div`
  display: flex; gap: 40px; flex-wrap: wrap; font-size: 13px;
  span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${t.color.text3}; font-weight: 700; }
  p { margin: 4px 0 0; white-space: pre-line; }
`;
