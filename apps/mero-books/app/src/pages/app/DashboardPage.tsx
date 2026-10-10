import React from 'react';
import styled from 'styled-components';
import { Link, useNavigate } from 'react-router-dom';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useQuery } from '../../hooks/useBooks';
import { formatMoney, monthLabel, MONTH_NAMES } from '../../utils/books';
import { Button, Empty, Grid, Page, PageHead, Panel } from '../../components/ui';
import type { DocumentTotals } from '../../generated/BooksClient';
import { useAppCtx } from './appContext';

/**
 * The organisation's home: what is in the bank (and what is left to
 * reconcile), what customers owe and what is owed to suppliers, six months of
 * cash in and out, and profit for the year so far. Computed by the contract
 * (`get_dashboard`) from the live ledger.
 */
export default function DashboardPage(): React.ReactElement {
  const { data, today } = useAppCtx();
  const navigate = useNavigate();
  const { settings } = data;
  const cur = settings.currency;
  const { data: dash } = useQuery(data, (c) => c.getDashboard({ today }), [today]);

  const maxFlow = Math.max(1, ...(dash?.cash_flow ?? []).flatMap((m) => [m.money_in, m.money_out]));

  return (
    <Page data-testid="dashboard">
      <PageHead>
        <div>
          <h1>{settings.organisation_name || 'Dashboard'}</h1>
          <div className="sub">
            Financial year ends {MONTH_NAMES[settings.fy_end_month - 1]} · {cur}
            {settings.lock_date ? ` · locked through ${settings.lock_date}` : ''}
          </div>
        </div>
        <div className="actions">
          <Button $variant="primary" onClick={() => navigate(`${APP_ROUTE}/sales/new`)} data-testid="dash-new-invoice">New invoice</Button>
          <Button onClick={() => navigate(`${APP_ROUTE}/purchases/new`)}>New bill</Button>
        </div>
      </PageHead>

      <Panel>
        <h3>Bank accounts</h3>
        {!dash ? (
          <Empty>Loading…</Empty>
        ) : dash.bank_accounts.length === 0 ? (
          <Empty><strong>No bank accounts</strong>Add one under Bank.</Empty>
        ) : (
          <Grid $min={240}>
            {dash.bank_accounts.map((b) => (
              <BankCard key={b.account_id} to={`${APP_ROUTE}/bank/${b.account_id}`} data-testid="dash-bank">
                <div className="name">{b.name}</div>
                <div className="code">{b.code}</div>
                <div className="bal" data-testid="dash-bank-balance">{formatMoney(b.balance, cur)}</div>
                <div className="row"><span>Statement balance</span><span>{formatMoney(b.statement_balance, cur)}</span></div>
                {b.unreconciled > 0 ? (
                  <div className="todo">Reconcile {b.unreconciled} item{b.unreconciled === 1 ? '' : 's'}</div>
                ) : (
                  <div className="ok">Reconciled</div>
                )}
              </BankCard>
            ))}
          </Grid>
        )}
      </Panel>

      <Grid $min={320}>
        <OwedPanel
          title="Invoices owed to you"
          totals={dash?.receivables}
          currency={cur}
          to={`${APP_ROUTE}/sales`}
          testId="dash-receivables"
        />
        <OwedPanel
          title="Bills to pay"
          totals={dash?.payables}
          currency={cur}
          to={`${APP_ROUTE}/purchases`}
          testId="dash-payables"
        />
      </Grid>

      <Grid $min={320}>
        <Panel>
          <h3>Cash in and out</h3>
          <Chart role="img" aria-label="Money in and out over the last six months">
            {(dash?.cash_flow ?? []).map((m) => (
              <div className="month" key={m.month}>
                <div className="bars">
                  <span className="in" style={{ height: `${(m.money_in / maxFlow) * 100}%` }} title={`In ${formatMoney(m.money_in, cur)}`} />
                  <span className="out" style={{ height: `${(m.money_out / maxFlow) * 100}%` }} title={`Out ${formatMoney(m.money_out, cur)}`} />
                </div>
                <div className="label">{monthLabel(m.month)}</div>
              </div>
            ))}
          </Chart>
          <Legend><span className="in" /> Money in <span className="out" /> Money out</Legend>
        </Panel>
        <Panel>
          <h3>Profit this financial year</h3>
          <Profit>
            <div className="row"><span>Income</span><span>{formatMoney(dash?.income_ytd ?? 0, cur)}</span></div>
            <div className="row"><span>Expenses</span><span>{formatMoney(dash?.expenses_ytd ?? 0, cur)}</span></div>
            <div className={`row net${(dash?.profit_ytd ?? 0) < 0 ? ' loss' : ''}`}>
              <span>Net profit</span><span data-testid="dash-profit">{formatMoney(dash?.profit_ytd ?? 0, cur)}</span>
            </div>
            <Link to={`${APP_ROUTE}/reports?report=pnl`} className="more">Profit and Loss report →</Link>
          </Profit>
        </Panel>
      </Grid>
    </Page>
  );
}

function OwedPanel({
  title, totals, currency, to, testId,
}: { title: string; totals?: DocumentTotals; currency: string; to: string; testId: string }) {
  const navigate = useNavigate();
  const rows: Array<[string, number, number, string]> = totals
    ? [
        ['Draft', totals.draft_count, totals.draft_total, '?status=draft'],
        ['Awaiting payment', totals.awaiting_count, totals.awaiting_total, '?status=awaiting_payment'],
        ['Overdue', totals.overdue_count, totals.overdue_total, '?status=overdue'],
      ]
    : [];
  return (
    <Panel data-testid={testId}>
      <h3>{title}</h3>
      <Owed>
        {rows.map(([label, n, amount, q]) => (
          <button key={label} type="button" className={label === 'Overdue' && n > 0 ? 'overdue' : ''} onClick={() => navigate(`${to}${q}`)}>
            <span className="l">{n} {label.toLowerCase()}</span>
            <span className="a" data-testid={`${testId}-${label.split(' ')[0].toLowerCase()}`}>{formatMoney(amount, currency)}</span>
          </button>
        ))}
      </Owed>
    </Panel>
  );
}

const BankCard = styled(Link)`
  display: block; border: 1px solid ${t.color.border}; border-radius: 10px; padding: 14px 16px;
  background: ${t.color.raised}; color: ${t.color.text};
  &:hover { border-color: ${t.color.accentBorder}; }
  .name { font-weight: 700; }
  .code { font-size: 12px; color: ${t.color.text3}; }
  .bal { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 8px 0; font-variant-numeric: tabular-nums; }
  .row { display: flex; justify-content: space-between; font-size: 12.5px; color: ${t.color.text2}; }
  .todo { margin-top: 10px; font-weight: 700; color: ${t.color.accent}; font-size: 13px; }
  .ok { margin-top: 10px; font-weight: 600; color: ${t.color.done}; font-size: 13px; }
`;
const Owed = styled.div`
  display: flex; flex-direction: column;
  button {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    background: none; border: none; border-bottom: 1px solid ${t.color.border}; padding: 10px 2px;
    font: inherit; color: ${t.color.text}; cursor: pointer; text-align: left;
    &:hover .l { color: ${t.color.accent}; }
    &:last-child { border-bottom: none; }
  }
  .l { color: ${t.color.text2}; }
  .a { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .overdue .a, .overdue .l { color: ${t.color.urgent}; }
`;
const Chart = styled.div`
  display: flex; align-items: flex-end; gap: 10px; height: 170px; padding-top: 6px;
  .month { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .bars { flex: 1; display: flex; align-items: flex-end; gap: 3px; width: 100%; justify-content: center; }
  .bars span { width: 38%; max-width: 22px; border-radius: 3px 3px 0 0; min-height: 1px; }
  .in { background: ${t.color.accent}; }
  .out { background: #F79009; }
  .label { font-size: 11.5px; color: ${t.color.text3}; margin-top: 6px; }
`;
const Legend = styled.div`
  display: flex; align-items: center; gap: 6px; font-size: 12px; color: ${t.color.text2}; margin-top: 10px;
  span { width: 10px; height: 10px; border-radius: 2px; display: inline-block; margin-left: 8px; }
  .in { background: ${t.color.accent}; margin-left: 0; }
  .out { background: #F79009; }
`;
const Profit = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  .row { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; font-size: 14px; }
  .row span:first-child { color: ${t.color.text2}; }
  .net { border-top: 2px solid ${t.color.borderStrong}; padding-top: 10px; font-weight: 700; font-size: 18px; }
  .net span:first-child { color: ${t.color.text}; }
  .loss span:last-child { color: ${t.color.urgent}; }
  .more { color: ${t.color.accent}; font-weight: 600; font-size: 13px; margin-top: 6px; }
`;
