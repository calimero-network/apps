import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useAppCtx } from './appContext';
import { useQuery, type UseBooksReturn } from '../../hooks/useBooks';
import type {
  AgedReport, AgedRow, ReportSection,
} from '../../generated/BooksClient';
import {
  ACCOUNT_TYPE_LABEL, PERIOD_LABELS, amountToInput, downloadText, formatAmount, formatDay, formatRate,
  formatReport, isDate, naturalBalance, periodRange, toCsv, type PeriodPreset,
} from '../../utils/books';
import { describeError } from '../../utils/errors';
import { AccountSelect } from '../../components/LineEditor';
import {
  Button, Chip, Empty, ErrorText, Input, Label, Page, PageHead, Row, Select, Table, TableWrap, Tabs,
} from '../../components/ui';

/**
 * Reports: every statement the contract computes, one tab each, the tab and
 * (for the general ledger) the account kept in the URL so a report is
 * linkable. All figures come from the contract in minor units; this page only
 * lays them out and exports them.
 */

type ReportKey = 'pnl' | 'balance' | 'trial' | 'aged-receivables' | 'aged-payables' | 'tax' | 'ledger';
const REPORT_KEYS: ReportKey[] = ['pnl', 'balance', 'trial', 'aged-receivables', 'aged-payables', 'tax', 'ledger'];
const PERIOD_REPORTS: ReportKey[] = ['pnl', 'tax', 'ledger'];

type CsvRows = Array<Array<string | number>>;
type Register = (build: (() => CsvRows) | null) => void;

interface ReportProps {
  data: UseBooksReturn;
  cur: string;
  from: string;
  to: string;
  asAt: string;
  register: Register;
  openLedger: (accountId: string) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  payment: 'Payment',
  spend: 'Spend money',
  receive: 'Receive money',
  journal: 'Manual journal',
  transfer: 'Transfer',
};

function useExport(register: Register, build: (() => CsvRows) | null) {
  const buildRef = useRef(build);
  buildRef.current = build;
  const ready = build !== null;
  useEffect(() => {
    register(ready ? () => (buildRef.current ? buildRef.current() : []) : null);
  }, [register, ready]);
  useEffect(() => () => register(null), [register]);
}

export default function ReportsPage(): React.ReactElement {
  const { data, today } = useAppCtx();
  const { settings } = data;
  const cur = settings.currency;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const rawKey = params.get('report') as ReportKey | null;
  const report: ReportKey = rawKey && REPORT_KEYS.includes(rawKey) ? rawKey : 'pnl';
  const accountId = params.get('account') ?? '';

  const [preset, setPreset] = useState<PeriodPreset | 'custom'>('this_month');
  const initial = periodRange('this_month', today, settings.fy_end_month);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [asAt, setAsAt] = useState(today);

  // The financial year end arrives with the books; re-derive the preset once it does.
  useEffect(() => {
    if (preset === 'custom') return;
    const r = periodRange(preset, today, settings.fy_end_month);
    setFrom(r.from);
    setTo(r.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fy_end_month, today]);

  const choosePreset = (p: string) => {
    if (p === 'custom') { setPreset('custom'); return; }
    const r = periodRange(p as PeriodPreset, today, settings.fy_end_month);
    setPreset(p as PeriodPreset);
    setFrom(r.from);
    setTo(r.to);
  };

  const setTab = (key: ReportKey) => {
    const next = new URLSearchParams(params);
    next.set('report', key);
    if (key !== 'ledger') next.delete('account');
    setParams(next);
  };

  const setAccount = useCallback((id: string) => {
    const next = new URLSearchParams(params);
    next.set('report', 'ledger');
    if (id) next.set('account', id); else next.delete('account');
    setParams(next, { replace: report === 'ledger' });
  }, [params, setParams, report]);

  const exporterRef = useRef<(() => CsvRows) | null>(null);
  const [canExport, setCanExport] = useState(false);
  const register = useCallback<Register>((build) => {
    exporterRef.current = build;
    setCanExport(build !== null);
  }, []);

  const isPeriod = PERIOD_REPORTS.includes(report);
  const title = reportTitle(report, settings.tax_label);
  const periodText = isPeriod
    ? `For the period ${formatDay(from)} to ${formatDay(to)}`
    : `As at ${formatDay(asAt)}`;

  const onExport = () => {
    const build = exporterRef.current;
    if (!build) return;
    const head: CsvRows = [[title], [settings.organisation_name], [periodText], []];
    downloadText(`${report}-${isPeriod ? to : asAt}.csv`, toCsv([...head, ...build()]));
  };

  const props: ReportProps = { data, cur, from, to, asAt, register, openLedger: setAccount };

  return (
    <Page>
      <PageHead className="no-print">
        <h1>Reports</h1>
        <span className="sub">{settings.organisation_name}</span>
        <div className="actions">
          <Button type="button" data-testid="report-export" disabled={!canExport} onClick={onExport}>Export CSV</Button>
          <Button type="button" data-testid="report-print" onClick={() => window.print()}>Print</Button>
        </div>
      </PageHead>

      <Toolbar className="no-print">
        <Tabs role="tablist" aria-label="Report">
          {REPORT_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={report === k}
              data-testid={`report-tab-${k}`}
              onClick={() => setTab(k)}
            >
              {tabLabel(k, settings.tax_label)}
            </button>
          ))}
        </Tabs>
        <Row $gap={12} $wrap className="period">
          {report === 'ledger' && (
            <Label style={{ minWidth: 260 }}>
              Account
              <AccountSelect
                accounts={data.accounts}
                value={accountId}
                onChange={setAccount}
                testId="report-account"
              />
            </Label>
          )}
          {isPeriod ? (
            <>
              <Label>
                Period
                <Select value={preset} data-testid="report-preset" onChange={(e) => choosePreset(e.target.value)}>
                  {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
                    <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                  ))}
                  <option value="custom">Custom</option>
                </Select>
              </Label>
              <Label>
                From
                <Input
                  type="date"
                  value={from}
                  data-testid="report-from"
                  onChange={(e) => { if (isDate(e.target.value)) { setFrom(e.target.value); setPreset('custom'); } }}
                />
              </Label>
              <Label>
                To
                <Input
                  type="date"
                  value={to}
                  data-testid="report-to"
                  onChange={(e) => { if (isDate(e.target.value)) { setTo(e.target.value); setPreset('custom'); } }}
                />
              </Label>
            </>
          ) : (
            <Label>
              As at
              <Input
                type="date"
                value={asAt}
                data-testid="report-as-at"
                onChange={(e) => { if (isDate(e.target.value)) setAsAt(e.target.value); }}
              />
            </Label>
          )}
        </Row>
      </Toolbar>

      <Paper data-testid={`report-${report}`}>
        <header>
          <div className="org">{settings.organisation_name}</div>
          <h2>{title}</h2>
          <div className="period">{periodText}</div>
        </header>
        {report === 'pnl' && <ProfitAndLossReport {...props} />}
        {report === 'balance' && <BalanceSheetReport {...props} />}
        {report === 'trial' && <TrialBalanceReport {...props} />}
        {report === 'aged-receivables' && <AgedReportView {...props} kind="receivables" onContact={(id) => navigate(`${APP_ROUTE}/contacts/${id}`)} />}
        {report === 'aged-payables' && <AgedReportView {...props} kind="payables" onContact={(id) => navigate(`${APP_ROUTE}/contacts/${id}`)} />}
        {report === 'tax' && <TaxReportView {...props} taxLabel={settings.tax_label} />}
        {report === 'ledger' && (
          <LedgerReport
            {...props}
            accountId={accountId}
            onSource={(kind, id) => {
              if (kind === 'invoice') navigate(`${APP_ROUTE}/sales/${id}`);
              else if (kind === 'bill') navigate(`${APP_ROUTE}/purchases/${id}`);
            }}
          />
        )}
      </Paper>
    </Page>
  );
}

function tabLabel(k: ReportKey, taxLabel: string): string {
  switch (k) {
    case 'pnl': return 'Profit and Loss';
    case 'balance': return 'Balance Sheet';
    case 'trial': return 'Trial Balance';
    case 'aged-receivables': return 'Aged Receivables';
    case 'aged-payables': return 'Aged Payables';
    case 'tax': return `${taxLabel} Return`;
    case 'ledger': return 'Account Transactions';
  }
}

function reportTitle(k: ReportKey, taxLabel: string): string {
  return tabLabel(k, taxLabel);
}

// ── shared bits ─────────────────────────────────────────────────────────────

function Status({ loading, error, empty }: { loading: boolean; error: Error | null; empty: boolean }) {
  if (error) return <ErrorText role="alert">{describeError(error)}</ErrorText>;
  if (empty && loading) return <Empty>Loading report…</Empty>;
  return null;
}

function SectionRows({
  section, title, cur, openLedger,
}: { section: ReportSection; title?: string; cur: string; openLedger: (id: string) => void }) {
  if (section.rows.length === 0) return null;
  const label = title ?? section.title;
  return (
    <>
      <tr className="section"><td colSpan={2}>{label}</td></tr>
      {section.rows.map((r) => (
        <tr
          key={r.account_id || r.name}
          className={r.account_id ? 'click' : undefined}
          onClick={r.account_id ? () => openLedger(r.account_id) : undefined}
        >
          <td className="acct"><span className="code">{r.code}</span>{r.name}</td>
          <td className="num">{formatReport(r.amount, cur)}</td>
        </tr>
      ))}
      <tr className="total">
        <td>Total {label}</td>
        <td className="num">{formatReport(section.total, cur)}</td>
      </tr>
    </>
  );
}

function sectionCsv(section: ReportSection, cur: string, title = section.title): CsvRows {
  if (section.rows.length === 0) return [];
  return [
    [title],
    ...section.rows.map((r) => [r.code, r.name, amountToInput(r.amount, cur)]),
    ['', `Total ${title}`, amountToInput(section.total, cur)],
    [],
  ];
}

function amountCell(n: number, cur: string, testId?: string) {
  return <td className={`num${n < 0 ? ' neg' : ''}`} data-testid={testId}>{formatReport(n, cur)}</td>;
}

// ── Profit and Loss ─────────────────────────────────────────────────────────

function ProfitAndLossReport({ data, cur, from, to, register, openLedger }: ReportProps) {
  const q = useQuery(data, (c) => c.profitAndLoss({ from, to }), [from, to]);
  const p = q.data;
  useExport(register, p ? () => [
    ['Code', 'Account', 'Amount'],
    ...sectionCsv(p.income, cur, 'Income'),
    ...sectionCsv(p.cost_of_sales, cur, 'Cost of sales'),
    ['', 'Gross profit', amountToInput(p.gross_profit, cur)],
    [],
    ...sectionCsv(p.other_income, cur, 'Other income'),
    ...sectionCsv(p.expenses, cur, 'Operating expenses'),
    ['', 'Net profit', amountToInput(p.net_profit, cur)],
  ] : null);
  if (!p) return <Status loading={q.loading || !data.ready} error={q.error} empty />;
  const nothing = !p.income.rows.length && !p.cost_of_sales.rows.length && !p.other_income.rows.length && !p.expenses.rows.length;
  return (
    <>
      <Status loading={q.loading} error={q.error} empty={false} />
      <Statement>
        <thead><tr><th>Account</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {nothing && <tr><td colSpan={2} className="muted">No income or expenses in this period.</td></tr>}
          <SectionRows section={p.income} title="Income" cur={cur} openLedger={openLedger} />
          <SectionRows section={p.cost_of_sales} title="Cost of sales" cur={cur} openLedger={openLedger} />
          {(p.income.rows.length > 0 || p.cost_of_sales.rows.length > 0) && (
            <tr className="subtotal"><td>Gross profit</td>{amountCell(p.gross_profit, cur, 'pnl-gross-profit')}</tr>
          )}
          <SectionRows section={p.other_income} title="Other income" cur={cur} openLedger={openLedger} />
          <SectionRows section={p.expenses} title="Operating expenses" cur={cur} openLedger={openLedger} />
          <tr className="grand"><td>Net profit</td>{amountCell(p.net_profit, cur, 'pnl-net-profit')}</tr>
        </tbody>
      </Statement>
    </>
  );
}

// ── Balance Sheet ───────────────────────────────────────────────────────────

function BalanceSheetReport({ data, cur, asAt, register, openLedger }: ReportProps) {
  const q = useQuery(data, (c) => c.balanceSheet({ as_at: asAt }), [asAt]);
  const b = q.data;
  useExport(register, b ? () => [
    ['Code', 'Account', 'Amount'],
    ['Assets'],
    ...b.assets.flatMap((s) => sectionCsv(s, cur)),
    ['', 'Total assets', amountToInput(b.total_assets, cur)],
    [],
    ['Liabilities'],
    ...b.liabilities.flatMap((s) => sectionCsv(s, cur)),
    ['', 'Total liabilities', amountToInput(b.total_liabilities, cur)],
    [],
    ['', 'Net assets', amountToInput(b.net_assets, cur)],
    [],
    ...sectionCsv(b.equity, cur, 'Equity'),
  ] : null);
  if (!b) return <Status loading={q.loading || !data.ready} error={q.error} empty />;
  const diff = b.net_assets - b.equity.total;
  return (
    <>
      <Status loading={q.loading} error={q.error} empty={false} />
      <Statement>
        <thead><tr><th>Account</th><th className="num">{formatDay(b.as_at)}</th></tr></thead>
        <tbody>
          <tr className="heading"><td colSpan={2}>Assets</td></tr>
          {b.assets.map((s) => <SectionRows key={s.title} section={s} cur={cur} openLedger={openLedger} />)}
          <tr className="subtotal"><td>Total assets</td>{amountCell(b.total_assets, cur, 'bs-total-assets')}</tr>

          <tr className="heading"><td colSpan={2}>Liabilities</td></tr>
          {b.liabilities.map((s) => <SectionRows key={s.title} section={s} cur={cur} openLedger={openLedger} />)}
          <tr className="subtotal"><td>Total liabilities</td>{amountCell(b.total_liabilities, cur, 'bs-total-liabilities')}</tr>

          <tr className="grand"><td>Net assets</td>{amountCell(b.net_assets, cur, 'bs-net-assets')}</tr>

          <tr className="heading"><td colSpan={2}>Equity</td></tr>
          {b.equity.rows.map((r) => (
            <tr
              key={r.account_id || r.name}
              className={r.account_id ? 'click' : undefined}
              onClick={r.account_id ? () => openLedger(r.account_id) : undefined}
            >
              <td className="acct"><span className="code">{r.code}</span>{r.name}</td>
              <td className="num">{formatReport(r.amount, cur)}</td>
            </tr>
          ))}
          <tr className="grand"><td>Total equity</td>{amountCell(b.equity.total, cur, 'bs-total-equity')}</tr>
        </tbody>
      </Statement>
      <Check data-testid="bs-check">
        {diff === 0
          ? <Chip $color={t.color.done}>Balanced</Chip>
          : <Chip $color={t.color.urgent}>Out of balance by {formatAmount(Math.abs(diff), cur)}</Chip>}
        <span>Net assets equal total equity.</span>
      </Check>
    </>
  );
}

// ── Trial Balance ───────────────────────────────────────────────────────────

function TrialBalanceReport({ data, cur, asAt, register, openLedger }: ReportProps) {
  const q = useQuery(data, (c) => c.trialBalance({ as_at: asAt }), [asAt]);
  const tb = q.data;
  useExport(register, tb ? () => [
    ['Code', 'Account', 'Type', 'Debit', 'Credit'],
    ...tb.rows.map((r) => [
      r.code, r.name, ACCOUNT_TYPE_LABEL[r.account_type] ?? r.account_type,
      r.debit ? amountToInput(r.debit, cur) : '', r.credit ? amountToInput(r.credit, cur) : '',
    ]),
    ['', 'Total', '', amountToInput(tb.total_debit, cur), amountToInput(tb.total_credit, cur)],
  ] : null);
  if (!tb) return <Status loading={q.loading || !data.ready} error={q.error} empty />;
  return (
    <>
      <Status loading={q.loading} error={q.error} empty={false} />
      <TableWrap>
        <Table>
          <thead>
            <tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th></tr>
          </thead>
          <tbody>
            {tb.rows.length === 0 && <tr><td colSpan={5} className="muted">No balances at this date.</td></tr>}
            {tb.rows.map((r) => (
              <tr key={r.account_id} className="click" onClick={() => openLedger(r.account_id)}>
                <td className="muted">{r.code}</td>
                <td className="strong">{r.name}</td>
                <td className="muted">{ACCOUNT_TYPE_LABEL[r.account_type] ?? r.account_type}</td>
                <td className="num">{r.debit ? formatAmount(r.debit, cur) : ''}</td>
                <td className="num">{r.credit ? formatAmount(r.credit, cur) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total</td>
              <td className="num" data-testid="tb-total-debit">{formatAmount(tb.total_debit, cur)}</td>
              <td className="num" data-testid="tb-total-credit">{formatAmount(tb.total_credit, cur)}</td>
            </tr>
          </tfoot>
        </Table>
      </TableWrap>
    </>
  );
}

// ── Aged receivables / payables ─────────────────────────────────────────────

const AGED_COLS: Array<[keyof AgedRow, string]> = [
  ['current', 'Current'],
  ['days_1_30', '1–30 days'],
  ['days_31_60', '31–60 days'],
  ['days_61_90', '61–90 days'],
  ['over_90', '90+ days'],
  ['total', 'Total'],
];

function AgedReportView({
  data, cur, asAt, register, kind, onContact,
}: ReportProps & { kind: 'receivables' | 'payables'; onContact: (id: string) => void }) {
  const q = useQuery<AgedReport>(
    data,
    (c) => (kind === 'receivables' ? c.agedReceivables({ as_at: asAt }) : c.agedPayables({ as_at: asAt })),
    [asAt, kind],
  );
  const a = q.data;
  useExport(register, a ? () => [
    ['Contact', ...AGED_COLS.map(([, l]) => l)],
    ...a.rows.map((r) => [r.contact_name, ...AGED_COLS.map(([k]) => amountToInput(r[k] as number, cur))]),
    ['Total', ...AGED_COLS.map(([k]) => amountToInput(a.totals[k] as number, cur))],
  ] : null);
  if (!a) return <Status loading={q.loading || !data.ready} error={q.error} empty />;
  return (
    <>
      <Status loading={q.loading} error={q.error} empty={false} />
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <th>Contact</th>
              {AGED_COLS.map(([k, l]) => <th key={k} className="num">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {a.rows.length === 0 && (
              <tr><td colSpan={7} className="muted">
                {kind === 'receivables' ? 'Nobody owes you anything at this date.' : 'You owe nothing at this date.'}
              </td></tr>
            )}
            {a.rows.map((r) => (
              <tr key={r.contact_id} className="click" data-testid="aged-row" onClick={() => onContact(r.contact_id)}>
                <td className="strong">{r.contact_name}</td>
                {AGED_COLS.map(([k]) => (
                  <td key={k} className={`num${k === 'total' ? ' strong' : ''}${k === 'over_90' && r.over_90 > 0 ? ' neg' : ''}`}>
                    {formatReport(r[k] as number, cur)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {AGED_COLS.map(([k]) => (
                <td key={k} className="num" data-testid={k === 'total' ? 'aged-total' : undefined}>
                  {formatReport(a.totals[k] as number, cur)}
                </td>
              ))}
            </tr>
          </tfoot>
        </Table>
      </TableWrap>
    </>
  );
}

// ── Tax return ──────────────────────────────────────────────────────────────

function TaxReportView({ data, cur, from, to, register, taxLabel }: ReportProps & { taxLabel: string }) {
  const q = useQuery(data, (c) => c.taxReport({ from, to }), [from, to]);
  const tx = q.data;
  const netLabel = (n: number) => (n >= 0 ? `Net ${taxLabel} to pay` : `Net ${taxLabel} to reclaim`);
  useExport(register, tx ? () => [
    ['Rate', 'Rate %', 'Sales net', `Sales ${taxLabel}`, 'Purchases net', `Purchases ${taxLabel}`],
    ...tx.rows.map((r) => [
      r.name, formatRate(r.rate_bp),
      amountToInput(r.sales_net, cur), amountToInput(r.sales_tax, cur),
      amountToInput(r.purchases_net, cur), amountToInput(r.purchases_tax, cur),
    ]),
    [],
    [`${taxLabel} collected on sales`, amountToInput(tx.sales_tax, cur)],
    [`${taxLabel} paid on purchases`, amountToInput(tx.purchases_tax, cur)],
    [netLabel(tx.net_tax), amountToInput(Math.abs(tx.net_tax), cur)],
  ] : null);
  if (!tx) return <Status loading={q.loading || !data.ready} error={q.error} empty />;
  return (
    <>
      <Status loading={q.loading} error={q.error} empty={false} />
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <th>{taxLabel} rate</th>
              <th className="num">Rate</th>
              <th className="num">Sales net</th>
              <th className="num">Sales {taxLabel}</th>
              <th className="num">Purchases net</th>
              <th className="num">Purchases {taxLabel}</th>
            </tr>
          </thead>
          <tbody>
            {tx.rows.length === 0 && <tr><td colSpan={6} className="muted">No taxable activity in this period.</td></tr>}
            {tx.rows.map((r) => (
              <tr key={r.tax_rate_id}>
                <td className="strong">{r.name}</td>
                <td className="num muted">{formatRate(r.rate_bp)}</td>
                <td className="num">{formatReport(r.sales_net, cur)}</td>
                <td className="num">{formatReport(r.sales_tax, cur)}</td>
                <td className="num">{formatReport(r.purchases_net, cur)}</td>
                <td className="num">{formatReport(r.purchases_tax, cur)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Summary>
        <div><span>{taxLabel} collected on sales</span><span className="num" data-testid="tax-collected">{formatAmount(tx.sales_tax, cur)}</span></div>
        <div><span>{taxLabel} paid on purchases</span><span className="num" data-testid="tax-paid">{formatAmount(tx.purchases_tax, cur)}</span></div>
        <div className="grand">
          <span>{netLabel(tx.net_tax)}</span>
          <span className="num" data-testid="tax-net" data-sign={tx.net_tax < 0 ? 'reclaim' : 'pay'}>
            {formatAmount(Math.abs(tx.net_tax), cur)}
          </span>
        </div>
      </Summary>
    </>
  );
}

// ── Account transactions (general ledger) ───────────────────────────────────

function LedgerReport({
  data, cur, from, to, register, accountId, onSource,
}: ReportProps & { accountId: string; onSource: (kind: string, id: string) => void }) {
  const account = useMemo(() => data.accounts.find((a) => a.id === accountId), [data.accounts, accountId]);
  const q = useQuery(
    data,
    (c) => (accountId ? c.accountTransactions({ account_id: accountId, from, to }) : Promise.resolve(null)),
    [accountId, from, to],
  );
  const l = q.data && q.data.account_id === accountId ? q.data : null;
  const cls = account?.class ?? 'asset';
  const bal = (n: number) => formatReport(naturalBalance(n, cls), cur);
  useExport(register, l ? () => [
    [account ? `${account.code} ${account.name}` : accountId],
    ['Date', 'Source', 'Reference', 'Contact', 'Description', 'Debit', 'Credit', 'Balance'],
    [from, 'Opening balance', '', '', '', '', '', amountToInput(naturalBalance(l.opening_balance, cls), cur)],
    ...l.rows.map((r) => [
      r.date, SOURCE_LABEL[r.source_kind] ?? r.source_kind, r.reference, r.contact_name, r.description,
      r.debit ? amountToInput(r.debit, cur) : '', r.credit ? amountToInput(r.credit, cur) : '',
      amountToInput(naturalBalance(r.balance, cls), cur),
    ]),
    [to, 'Closing balance', '', '', '', '', '', amountToInput(naturalBalance(l.closing_balance, cls), cur)],
  ] : null);

  if (!accountId) return <Empty><strong>Choose an account</strong>Pick an account above to see every entry posted to it.</Empty>;
  if (!l) return <Status loading={q.loading || !data.ready} error={q.error} empty />;
  const totalDr = l.rows.reduce((s, r) => s + r.debit, 0);
  const totalCr = l.rows.reduce((s, r) => s + r.credit, 0);
  return (
    <>
      <Status loading={q.loading} error={q.error} empty={false} />
      {account && (
        <Row $gap={8} className="acct-head">
          <strong>{account.code} · {account.name}</strong>
          <Chip>{ACCOUNT_TYPE_LABEL[account.account_type] ?? account.account_type}</Chip>
          {account.archived && <Chip $color={t.color.text3}>Archived</Chip>}
        </Row>
      )}
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <th>Date</th><th>Source</th><th>Reference</th><th>Contact</th><th>Description</th>
              <th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="opening">
              <td className="muted">{formatDay(l.from)}</td>
              <td colSpan={6} className="strong">Opening balance</td>
              <td className="num strong" data-testid="ledger-opening">{bal(l.opening_balance)}</td>
            </tr>
            {l.rows.length === 0 && <tr><td colSpan={8} className="muted">No transactions in this period.</td></tr>}
            {l.rows.map((r, i) => {
              const linked = r.source_kind === 'invoice' || r.source_kind === 'bill';
              return (
                <tr
                  key={`${r.source_id}-${i}`}
                  className={linked ? 'click' : undefined}
                  data-testid="ledger-row"
                  onClick={linked ? () => onSource(r.source_kind, r.source_id) : undefined}
                >
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDay(r.date)}</td>
                  <td className="muted">{SOURCE_LABEL[r.source_kind] ?? r.source_kind}</td>
                  <td>{r.reference}</td>
                  <td>{r.contact_name}</td>
                  <td className="muted">{r.description}</td>
                  <td className="num">{r.debit ? formatAmount(r.debit, cur) : ''}</td>
                  <td className="num">{r.credit ? formatAmount(r.credit, cur) : ''}</td>
                  <td className="num">{bal(r.balance)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>{formatDay(l.to)}</td>
              <td colSpan={4}>Closing balance</td>
              <td className="num">{formatAmount(totalDr, cur)}</td>
              <td className="num">{formatAmount(totalCr, cur)}</td>
              <td className="num" data-testid="ledger-closing">{bal(l.closing_balance)}</td>
            </tr>
          </tfoot>
        </Table>
      </TableWrap>
      <p className="note">Balances read in the account&apos;s natural direction; bracketed figures run against it.</p>
    </>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const Toolbar = styled.div`
  display: flex; flex-direction: column; gap: 14px;
  .period { align-items: flex-end; }
  .period label { min-width: 150px; }
  @media print { display: none; }
`;

const Paper = styled.section`
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px;
  padding: 28px 32px 32px; display: flex; flex-direction: column; gap: 16px;
  > header { text-align: center; margin-bottom: 8px; }
  > header .org { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text2}; }
  > header h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 6px 0 4px; color: ${t.color.text}; }
  > header .period { font-size: 13px; color: ${t.color.text3}; }
  .acct-head { font-size: 14px; }
  .note { margin: 0; font-size: 12px; color: ${t.color.text3}; }
  @media (max-width: 720px) { padding: 18px 14px 22px; }
  @media print { border: none; padding: 0; }
`;

const Statement = styled(Table)`
  max-width: 760px; margin: 0 auto;
  td { border-bottom: none; padding: 7px 10px; }
  th:last-child, td:last-child { width: 180px; }
  tr.heading td {
    font-size: 15px; font-weight: 700; color: ${t.color.text}; padding-top: 22px; padding-bottom: 4px;
  }
  tr.section td {
    font-weight: 700; color: ${t.color.text}; padding-top: 16px; border-bottom: 1px solid ${t.color.border};
  }
  td.acct { padding-left: 18px; color: ${t.color.text}; }
  td.acct .code { display: inline-block; min-width: 46px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; border-top: 1px solid ${t.color.borderStrong}; }
  tr.subtotal td { font-weight: 700; border-top: 1px solid ${t.color.borderStrong}; padding-top: 10px; padding-bottom: 10px; }
  tr.grand td {
    font-weight: 800; font-size: 14px; border-top: 2px solid ${t.color.text}; border-bottom: 3px double ${t.color.text};
    padding-top: 10px; padding-bottom: 10px;
  }
`;

const Check = styled.div`
  display: flex; align-items: center; gap: 10px; justify-content: center;
  font-size: 12.5px; color: ${t.color.text3};
`;

const Summary = styled.div`
  align-self: flex-end; width: 100%; max-width: 420px; display: flex; flex-direction: column;
  > div { display: flex; justify-content: space-between; gap: 16px; padding: 8px 4px; font-size: 13px; border-bottom: 1px solid ${t.color.border}; }
  .num { font-variant-numeric: tabular-nums; }
  > div.grand { font-weight: 800; font-size: 14px; border-top: 2px solid ${t.color.text}; border-bottom: 3px double ${t.color.text}; }
`;
