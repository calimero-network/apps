import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import {
  documentLabel, documentStatus, formatAmount, formatDay, matchesSearch, STATUS_LABEL, type DocStatus,
} from '../../utils/books';
import { Button, Empty, Page, PageHead, StatusBadge, Table, TableWrap, Tabs } from '../../components/ui';
import { useAppCtx } from './appContext';

const FILTERS: Array<DocStatus | 'all'> = ['all', 'draft', 'awaiting_payment', 'overdue', 'paid', 'void'];

/** Sales invoices (`kind = sales`) or bills (`kind = bill`), filtered by status. */
export default function InvoicesPage({ kind }: { kind: 'sales' | 'bill' }): React.ReactElement {
  const { data, today, searchQuery } = useAppCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('status') as DocStatus | 'all' | null) ?? 'all';
  const base = `${APP_ROUTE}/${kind === 'sales' ? 'sales' : 'purchases'}`;
  const cur = data.settings.currency;
  const noun = kind === 'sales' ? 'invoice' : 'bill';

  const docs = useMemo(
    () => data.invoices
      .filter((i) => i.kind === kind)
      .map((i) => ({ ...i, docStatus: documentStatus(i, today) }))
      .filter((i) => matchesSearch([i.number, i.reference, i.contact_name], searchQuery)),
    [data.invoices, kind, today, searchQuery],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length };
    for (const d of docs) {
      c[d.docStatus] = (c[d.docStatus] ?? 0) + 1;
      // Overdue documents are also awaiting payment.
      if (d.docStatus === 'overdue') c.awaiting_payment = (c.awaiting_payment ?? 0) + 1;
    }
    return c;
  }, [docs]);
  const shown = docs.filter((d) =>
    filter === 'all' ? true
      : filter === 'awaiting_payment' ? d.docStatus === 'awaiting_payment' || d.docStatus === 'overdue'
      : d.docStatus === filter);
  const totalDue = shown.reduce((s, d) => s + d.amount_due, 0);

  return (
    <Page data-testid={`${kind}-list`}>
      <PageHead>
        <div>
          <h1>{kind === 'sales' ? 'Invoices' : 'Bills'}</h1>
          <div className="sub">
            {kind === 'sales' ? 'What customers owe you' : 'What you owe suppliers'}
            {totalDue > 0 && <> · <strong>{formatAmount(totalDue, cur)}</strong> {kind === 'sales' ? 'outstanding' : 'to pay'}</>}
          </div>
        </div>
        <div className="actions">
          <Button $variant="primary" data-testid={`new-${noun}-btn`} onClick={() => navigate(`${base}/new`)}>
            New {noun}
          </Button>
        </div>
      </PageHead>

      <Tabs role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-testid={`filter-${f}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (f === 'all') next.delete('status'); else next.set('status', f);
              setParams(next, { replace: true });
            }}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
            <span className="n">{counts[f] ?? 0}</span>
          </button>
        ))}
      </Tabs>

      <TableWrap>
        {shown.length === 0 ? (
          <Empty>
            <strong>No {noun}s here</strong>
            {filter === 'all' ? `Create your first ${noun} with the button above.` : 'Try another filter.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{kind === 'sales' ? 'Number' : 'Reference'}</th>
                <th>{kind === 'sales' ? 'To' : 'From'}</th>
                <th>Date</th>
                <th>Due</th>
                <th className="num">Paid</th>
                <th className="num">Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className={`click${d.docStatus === 'void' ? ' voided' : ''}`} data-testid="doc-row" onClick={() => navigate(`${base}/${d.id}`)}>
                  <td className="strong" data-testid="doc-number">{documentLabel(d)}</td>
                  <td>{d.contact_name || <span className="muted">—</span>}</td>
                  <td>{formatDay(d.issue_date)}</td>
                  <td className={d.docStatus === 'overdue' ? 'neg' : ''}>{formatDay(d.due_date)}</td>
                  <td className="num">{d.paid ? formatAmount(d.paid, cur) : <span className="muted">—</span>}</td>
                  <td className="num strong" data-testid="doc-due">{formatAmount(d.status === 'draft' ? d.total : d.amount_due, cur)}</td>
                  <td><StatusBadge status={d.docStatus} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableWrap>
      {kind === 'sales' && <Hint>Invoice numbers are given on approval, in the order invoices are approved.</Hint>}
    </Page>
  );
}

const Hint = styled.p`font-size: 12px; color: ${t.color.text3}; margin: 0;`;
