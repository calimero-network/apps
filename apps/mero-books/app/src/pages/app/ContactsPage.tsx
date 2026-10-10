import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { APP_ROUTE } from '../../config';
import { formatAmount, matchesSearch } from '../../utils/books';
import ContactModal from '../../components/ContactModal';
import { Button, Empty, Page, PageHead, Table, TableWrap, Tabs } from '../../components/ui';
import { useAppCtx } from './appContext';

type Filter = 'all' | 'customers' | 'suppliers';

/** Everyone the organisation does business with, and where each balance stands. */
export default function ContactsPage(): React.ReactElement {
  const { data, searchQuery } = useAppCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const cur = data.settings.currency;

  // `+ New → Contact` lands here with ?new=1.
  useEffect(() => {
    if (params.get('new')) {
      setCreating(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const shown = data.contacts
    .filter((c) => matchesSearch([c.name, c.email, c.phone, c.tax_number], searchQuery))
    .filter((c) => filter === 'all' || (filter === 'customers' ? c.invoice_count > 0 : c.bill_count > 0));
  const owedToYou = shown.reduce((s, c) => s + c.receivable, 0);
  const youOwe = shown.reduce((s, c) => s + c.payable, 0);

  return (
    <Page data-testid="contacts">
      <PageHead>
        <div>
          <h1>Contacts</h1>
          <div className="sub">
            Owed to you <strong>{formatAmount(owedToYou, cur)}</strong> · You owe <strong>{formatAmount(youOwe, cur)}</strong>
          </div>
        </div>
        <div className="actions">
          <Button $variant="primary" onClick={() => setCreating(true)} data-testid="contact-new">New contact</Button>
        </div>
      </PageHead>
      <Tabs>
        {(['all', 'customers', 'suppliers'] as Filter[]).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </Tabs>
      <TableWrap>
        {shown.length === 0 ? (
          <Empty><strong>No contacts</strong>Add the customers you invoice and the suppliers who bill you.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th className="num">Invoices</th>
                <th className="num">Bills</th>
                <th className="num">Owes you</th>
                <th className="num">You owe</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="click" data-testid="contact-row" onClick={() => navigate(`${APP_ROUTE}/contacts/${c.id}`)}>
                  <td className="strong">{c.name}</td>
                  <td className="muted">{c.email || '—'}</td>
                  <td className="num">{c.invoice_count}</td>
                  <td className="num">{c.bill_count}</td>
                  <td className="num">{c.receivable ? formatAmount(c.receivable, cur) : <span className="muted">—</span>}</td>
                  <td className="num">{c.payable ? formatAmount(c.payable, cur) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableWrap>
      {creating && <ContactModal act={data.act} onClose={() => setCreating(false)} />}
    </Page>
  );
}
