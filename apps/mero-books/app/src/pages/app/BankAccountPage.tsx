import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useQuery, type UseBooksReturn } from '../../hooks/useBooks';
import type { StatementLineInput, StatementLineView } from '../../generated/BooksClient';
import {
  addDays, amountToInput, formatAmount, formatDay, formatMoney, matchCandidates, matchesSearch, parseStatementCsv,
  suggestMatch, type MatchCandidate,
} from '../../utils/books';
import { describeError } from '../../utils/errors';
import { AccountSelect, TaxSelect, codeableAccounts } from '../../components/LineEditor';
import BankTransactionModal from '../../components/BankTransactionModal';
import TransferModal from '../../components/TransferModal';
import {
  Button, Chip, Empty, ErrorText, Input, Label, Modal, Page, PageHead, Panel, Row, Select, Table, TableWrap,
  Tabs, TextArea,
} from '../../components/ui';
import { useAppCtx } from './appContext';

type Tab = 'reconcile' | 'statement' | 'transactions';
const TABS: Array<[Tab, string]> = [
  ['reconcile', 'Reconcile'],
  ['statement', 'Bank statement'],
  ['transactions', 'Account transactions'],
];
const IMPORT_CHUNK = 500;

/**
 * One bank account: reconcile imported statement lines against what the
 * books recorded (Xero's two-column screen), the statement itself, and the
 * account's ledger with a running balance.
 */
export default function BankAccountPage(): React.ReactElement {
  const { accountId = '' } = useParams();
  const { data, today } = useAppCtx();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'statement' || tabParam === 'transactions' ? tabParam : 'reconcile';
  const cur = data.settings.currency;
  const account = data.accounts.find((a) => a.id === accountId);

  const { data: dash } = useQuery(data, (c) => c.getDashboard({ today }), [today]);
  const summary = dash?.bank_accounts.find((b) => b.account_id === accountId);
  const { data: statement, error: stmtError } = useQuery(
    data, (c) => c.listStatementLines({ bank_account_id: accountId }), [accountId],
  );
  const lines = statement ?? [];

  const [importing, setImporting] = useState(false);
  const [modal, setModal] = useState<'spend' | 'receive' | 'transfer' | null>(null);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  if (data.loaded && (!account || account.account_type !== 'bank')) {
    return (
      <Page>
        <Empty>
          <strong>Bank account not found</strong>
          <Link to={`${APP_ROUTE}/bank`}>Back to bank accounts</Link>
        </Empty>
      </Page>
    );
  }

  const unreconciledCount = lines.filter((l) => !l.reconciled).length;

  return (
    <Page data-testid="bank-account-page">
      <BackLink to={`${APP_ROUTE}/bank`}>← Bank accounts</BackLink>
      <PageHead>
        <div>
          <h1>{account?.name ?? 'Bank account'}</h1>
          <div className="sub">{account?.code}</div>
        </div>
        <Balances>
          <div>
            <div className="k">Balance in Mero Books</div>
            <div className="v" data-testid="account-ledger-balance">{formatMoney(summary?.balance ?? account?.balance ?? 0, cur)}</div>
          </div>
          <div>
            <div className="k">Statement balance</div>
            <div className="v" data-testid="account-statement-balance">{formatMoney(summary?.statement_balance ?? 0, cur)}</div>
          </div>
        </Balances>
        <div className="actions">
          <Button $variant="primary" onClick={() => setImporting(true)} data-testid="statement-import-btn">Import a statement</Button>
          <Button onClick={() => setModal('spend')}>Spend money</Button>
          <Button onClick={() => setModal('receive')}>Receive money</Button>
          <Button onClick={() => setModal('transfer')}>Transfer</Button>
        </div>
      </PageHead>

      <Tabs role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} data-testid={`bank-tab-${id}`}>
            {label}
            {id === 'reconcile' && unreconciledCount > 0 && <span className="n">{unreconciledCount}</span>}
          </button>
        ))}
      </Tabs>

      {stmtError && <ErrorText>{describeError(stmtError)}</ErrorText>}
      {tab === 'reconcile' && <ReconcileTab data={data} accountId={accountId} lines={lines} loaded={statement !== null} />}
      {tab === 'statement' && <StatementTab data={data} lines={lines} />}
      {tab === 'transactions' && <TransactionsTab data={data} accountId={accountId} today={today} />}

      {importing && <ImportModal data={data} accountId={accountId} onClose={() => setImporting(false)} />}
      {(modal === 'spend' || modal === 'receive') && (
        <BankTransactionModal kind={modal} bankAccountId={accountId} onClose={() => setModal(null)} data={data} today={today} />
      )}
      {modal === 'transfer' && <TransferModal fromAccountId={accountId} onClose={() => setModal(null)} data={data} today={today} />}
    </Page>
  );
}

// ── import ─────────────────────────────────────────────────────────────────

function ImportModal({ data, accountId, onClose }: { data: UseBooksReturn; accountId: string; onClose: () => void }) {
  const toast = useToast();
  const cur = data.settings.currency;
  const [csv, setCsv] = useState('');
  const [monthFirst, setMonthFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => (csv.trim() ? parseStatementCsv(csv, cur, monthFirst) : null), [csv, cur, monthFirst]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then(setCsv).catch((err) => setError(describeError(err)));
  };

  const run = async () => {
    if (!parsed || parsed.lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let added = 0;
      for (let i = 0; i < parsed.lines.length; i += IMPORT_CHUNK) {
        const chunk: StatementLineInput[] = parsed.lines.slice(i, i + IMPORT_CHUNK);
        added += await data.act((c) => c.importStatementLines({ bank_account_id: accountId, lines: chunk }));
      }
      const already = parsed.lines.length - added;
      toast.show({ variant: 'success', description: `Imported ${added} new line${added === 1 ? '' : 's'} (${already} already there)` });
      onClose();
    } catch (err) {
      const description = describeError(err);
      setError(description);
      toast.show({ variant: 'error', description });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import a bank statement"
      sub="A CSV export from your bank with Date, Description and Amount (or Debit and Credit) columns. Lines already imported are skipped."
      onClose={onClose}
      wide
      testId="statement-import-modal"
    >
      <Label>
        CSV file
        <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} data-testid="statement-file" />
      </Label>
      <Label>
        Or paste the CSV
        <TextArea
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={'Date,Description,Amount\n2024-03-01,Coffee shop,-4.50'}
          data-testid="statement-csv"
          style={{ fontFamily: t.font.mono, fontSize: 12 }}
        />
      </Label>
      <CheckLabel>
        <input type="checkbox" checked={monthFirst} onChange={(e) => setMonthFirst(e.target.checked)} data-testid="statement-month-first" />
        Dates are month-first (US)
      </CheckLabel>
      {parsed && parsed.errors.length > 0 && (
        <ErrorList data-testid="statement-errors">
          {parsed.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}
          {parsed.errors.length > 20 && <li>…and {parsed.errors.length - 20} more</li>}
        </ErrorList>
      )}
      {parsed && parsed.lines.length > 0 && (
        <Preview>
          <Table data-testid="statement-preview">
            <thead>
              <tr><th>Date</th><th>Description</th><th className="num">Spent</th><th className="num">Received</th></tr>
            </thead>
            <tbody>
              {parsed.lines.slice(0, 200).map((l, i) => (
                <tr key={i}>
                  <td className="muted">{formatDay(l.date)}</td>
                  <td>{l.description}</td>
                  <td className="num">{l.amount < 0 ? formatAmount(-l.amount, cur) : ''}</td>
                  <td className="num">{l.amount > 0 ? formatAmount(l.amount, cur) : ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {parsed.lines.length > 200 && <div className="more">…and {parsed.lines.length - 200} more lines</div>}
        </Preview>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="actions">
        <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          type="button"
          $variant="primary"
          onClick={run}
          disabled={busy || !parsed || parsed.lines.length === 0}
          data-testid="statement-import"
        >
          {busy ? 'Importing…' : `Import${parsed && parsed.lines.length ? ` ${parsed.lines.length} lines` : ''}`}
        </Button>
      </div>
    </Modal>
  );
}

// ── reconcile ──────────────────────────────────────────────────────────────

function ReconcileTab({
  data, accountId, lines, loaded,
}: { data: UseBooksReturn; accountId: string; lines: StatementLineView[]; loaded: boolean }) {
  const open = useMemo(
    () => lines.filter((l) => !l.reconciled).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1)),
    [lines],
  );
  const candidates = useMemo(
    () => matchCandidates(accountId, data.payments, data.bankTransactions, data.journals, data.invoices, lines),
    [accountId, data.payments, data.bankTransactions, data.journals, data.invoices, lines],
  );

  if (!loaded) return <Panel><Empty>Loading…</Empty></Panel>;
  if (open.length === 0) {
    return (
      <Panel>
        <Empty data-testid="reconcile-done">
          <strong>All reconciled</strong>
          {lines.length === 0 ? 'Import a bank statement to start reconciling.' : 'Every statement line is matched to a transaction.'}
        </Empty>
      </Panel>
    );
  }
  return (
    <RecList>
      <div className="cols">
        <span>Review your bank statement lines…</span>
        <span>…then match them with your transactions in Mero Books</span>
      </div>
      {open.map((l) => (
        <ReconcileRow key={l.id} data={data} accountId={accountId} line={l} candidates={candidates} />
      ))}
    </RecList>
  );
}

function ReconcileRow({
  data, accountId, line, candidates,
}: { data: UseBooksReturn; accountId: string; line: StatementLineView; candidates: MatchCandidate[] }) {
  const cur = data.settings.currency;
  const suggestion = useMemo(() => suggestMatch(line, candidates), [line, candidates]);
  const [mode, setMode] = useState<'create' | 'match'>('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  const reconcile = (targetId: string) =>
    run(() => data.act((c) => c.reconcileStatementLine({ statement_line_id: line.id, target_id: targetId })));
  const remove = () => {
    if (!window.confirm('Remove this statement line? Re-importing the file brings it back.')) return;
    void run(() => data.act((c) => c.deleteStatementLine({ statement_line_id: line.id })));
  };

  return (
    <RecRow data-testid="reconcile-row" data-line-id={line.id}>
      <div className="stmt">
        <div className="date">{formatDay(line.date)}</div>
        <div className="desc">{line.description || '—'}</div>
        <div className="amts">
          <div><span className="k">Spent</span><span className="v">{line.amount < 0 ? formatAmount(-line.amount, cur) : ''}</span></div>
          <div><span className="k">Received</span><span className="v">{line.amount > 0 ? formatAmount(line.amount, cur) : ''}</span></div>
        </div>
        <button type="button" className="rm" onClick={remove} disabled={busy} data-testid="reconcile-remove">Remove</button>
      </div>
      <div className="mid">
        {suggestion ? (
          <Button $variant="success" onClick={() => void reconcile(suggestion.id)} disabled={busy} data-testid="reconcile-ok">OK</Button>
        ) : null}
      </div>
      <div className="side">
        {suggestion ? (
          <div className="suggest" data-testid="reconcile-suggestion">
            <div className="date">{formatDay(suggestion.date)}</div>
            <div className="desc">{suggestion.label}</div>
            <div className="amt">{formatAmount(Math.abs(suggestion.amount), cur)}</div>
          </div>
        ) : (
          <>
            <Tabs>
              <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')} data-testid="reconcile-tab-create">Create</button>
              <button type="button" aria-pressed={mode === 'match'} onClick={() => setMode('match')} data-testid="reconcile-tab-match">Match</button>
            </Tabs>
            {mode === 'create' ? (
              <CreateForm data={data} accountId={accountId} line={line} busy={busy} run={run} />
            ) : (
              <MatchList line={line} candidates={candidates} cur={cur} busy={busy} onMatch={(id) => void reconcile(id)} />
            )}
          </>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </RecRow>
  );
}

function CreateForm({
  data, accountId, line, busy, run,
}: {
  data: UseBooksReturn;
  accountId: string;
  line: StatementLineView;
  busy: boolean;
  run: (op: () => Promise<unknown>) => Promise<void>;
}) {
  const options = useMemo(() => codeableAccounts(data.accounts, [accountId]), [data.accounts, accountId]);
  const [contactId, setContactId] = useState('');
  const [account, setAccount] = useState('');
  const [taxRate, setTaxRate] = useState('tax-none');
  const [description, setDescription] = useState(line.description);

  const pickAccount = (id: string) => {
    setAccount(id);
    const def = data.accounts.find((a) => a.id === id)?.default_tax_rate_id;
    if (def) setTaxRate(def);
  };

  const save = () =>
    run(() => data.act((c) => c.codeStatementLine({
      statement_line_id: line.id, contact_id: contactId || null, account_id: account, tax_rate_id: taxRate,
      description: description.trim(),
    })));

  return (
    <div className="form">
      <Label>
        {line.amount < 0 ? 'Who' : 'From'}
        <Select value={contactId} onChange={(e) => setContactId(e.target.value)} data-testid="reconcile-contact">
          <option value="">No contact</option>
          {data.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Label>
      <Label>
        What
        <AccountSelect accounts={options} value={account} onChange={pickAccount} testId="reconcile-account" />
      </Label>
      <Label>
        {data.settings.tax_label} rate
        <TaxSelect rates={data.taxRates} value={taxRate} onChange={setTaxRate} testId="reconcile-tax" />
      </Label>
      <Label>
        Why
        <Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="reconcile-description" />
      </Label>
      <Row>
        <Button
          $variant="success"
          onClick={() => void save()}
          disabled={busy || !account}
          data-testid="reconcile-create"
        >OK</Button>
      </Row>
    </div>
  );
}

function MatchList({
  line, candidates, cur, busy, onMatch,
}: { line: StatementLineView; candidates: MatchCandidate[]; cur: string; busy: boolean; onMatch: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const list = candidates
    .filter((c) => Math.sign(c.amount) === Math.sign(line.amount))
    .filter((c) => matchesSearch([c.label, formatAmount(Math.abs(c.amount), cur), amountToInput(Math.abs(c.amount), cur)], search))
    .sort((a, b) => {
      const exact = Number(b.amount === line.amount) - Number(a.amount === line.amount);
      return exact || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    });
  return (
    <div className="match">
      <Input placeholder="Search by name, reference or amount" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="reconcile-search" />
      {list.length === 0 ? (
        <div className="none">No unreconciled {line.amount < 0 ? 'money out' : 'money in'} to match.</div>
      ) : (
        <ul>
          {list.slice(0, 25).map((c) => (
            <li key={c.id} data-testid="reconcile-candidate">
              <span className="date">{formatDay(c.date)}</span>
              <span className="desc">{c.label}</span>
              <span className={`amt${c.amount === line.amount ? ' exact' : ''}`}>{formatAmount(Math.abs(c.amount), cur)}</span>
              <Button $small onClick={() => onMatch(c.id)} disabled={busy || c.amount !== line.amount} data-testid="reconcile-match">Match</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── statement ──────────────────────────────────────────────────────────────

function StatementTab({ data, lines }: { data: UseBooksReturn; lines: StatementLineView[] }) {
  const cur = data.settings.currency;
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(() => [...lines].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1)), [lines]);

  const unreconcile = async (id: string) => {
    setError(null);
    try {
      await data.act((c) => c.unreconcileStatementLine({ statement_line_id: id }));
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (sorted.length === 0) {
    return <Panel><Empty><strong>No statement lines</strong>Import a bank statement to see it here.</Empty></Panel>;
  }
  return (
    <>
      {error && <ErrorText>{error}</ErrorText>}
      <TableWrap>
        <Table data-testid="statement-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th className="num">Spent</th><th className="num">Received</th><th>Status</th><th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.id} data-testid="statement-row">
                <td className="muted">{formatDay(l.date)}</td>
                <td>{l.description}</td>
                <td className="num">{l.amount < 0 ? formatAmount(-l.amount, cur) : ''}</td>
                <td className="num">{l.amount > 0 ? formatAmount(l.amount, cur) : ''}</td>
                <td>
                  {l.reconciled ? (
                    <Chip $color={t.color.done} data-testid="statement-status" data-status="reconciled">
                      Reconciled{l.match_label ? ` · ${l.match_label}` : ''}
                    </Chip>
                  ) : (
                    <Chip $color={t.color.high} data-testid="statement-status" data-status="unreconciled">Unreconciled</Chip>
                  )}
                </td>
                <td className="num">
                  {l.reconciled && (
                    <Button $small onClick={() => void unreconcile(l.id)} data-testid="statement-unreconcile">Unreconcile</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}

// ── account transactions ───────────────────────────────────────────────────

function TransactionsTab({ data, accountId, today }: { data: UseBooksReturn; accountId: string; today: string }) {
  const cur = data.settings.currency;
  const to = addDays(today, 3650);
  const { data: ledger, error } = useQuery(
    data, (c) => c.accountTransactions({ account_id: accountId, from: '1970-01-01', to }), [accountId, to],
  );
  if (error) return <ErrorText>{describeError(error)}</ErrorText>;
  if (!ledger) return <Panel><Empty>Loading…</Empty></Panel>;
  if (ledger.rows.length === 0) {
    return <Panel><Empty><strong>No transactions</strong>Nothing has moved through this account yet.</Empty></Panel>;
  }
  return (
    <TableWrap>
      <Table data-testid="account-ledger">
        <thead>
          <tr>
            <th>Date</th><th>Description</th><th>Reference</th>
            <th className="num">Received</th><th className="num">Spent</th><th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {ledger.rows.map((r, i) => (
            <tr key={`${r.source_id}-${i}`} data-testid="ledger-row">
              <td className="muted">{formatDay(r.date)}</td>
              <td className="strong">{[r.contact_name, r.description].filter(Boolean).join(' · ') || r.source_kind}</td>
              <td className="muted">{r.reference}</td>
              <td className="num">{r.debit ? formatAmount(r.debit, cur) : ''}</td>
              <td className="num">{r.credit ? formatAmount(r.credit, cur) : ''}</td>
              <td className={`num${r.balance < 0 ? ' neg' : ''}`}>{formatAmount(r.balance, cur)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Closing balance</td>
            <td className={`num${ledger.closing_balance < 0 ? ' neg' : ''}`} data-testid="ledger-closing">{formatAmount(ledger.closing_balance, cur)}</td>
          </tr>
        </tfoot>
      </Table>
    </TableWrap>
  );
}

// ── styles ─────────────────────────────────────────────────────────────────

const BackLink = styled(Link)`
  font-size: 12.5px; color: ${t.color.accent}; text-decoration: none; font-weight: 600; align-self: flex-start;
  &:hover { text-decoration: underline; }
`;

const Balances = styled.div`
  display: flex; gap: 24px; margin-left: 16px;
  .k { font-size: 11.5px; color: ${t.color.text2}; font-weight: 600; }
  .v { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
`;

const CheckLabel = styled.label`
  display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: ${t.color.text2}; cursor: pointer;
`;

const ErrorList = styled.ul`
  margin: 0; padding: 8px 12px 8px 28px; background: rgba(217,45,32,0.06); border-radius: ${t.radius};
  font-size: 12px; color: ${t.color.urgent}; max-height: 120px; overflow-y: auto;
`;

const Preview = styled.div`
  max-height: 280px; overflow-y: auto; border: 1px solid ${t.color.border}; border-radius: ${t.radius};
  .more { font-size: 12px; color: ${t.color.text3}; padding: 8px 10px; }
`;

const RecList = styled.div`
  display: flex; flex-direction: column; gap: 12px;
  .cols {
    display: grid; grid-template-columns: 1fr 80px 1fr; font-size: 12px; font-weight: 700; color: ${t.color.text2};
    span:last-child { grid-column: 3; }
    @media (max-width: 900px) { display: none; }
  }
`;

const RecRow = styled.div`
  display: grid; grid-template-columns: 1fr 80px 1fr; gap: 0; align-items: stretch;
  background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 10px; overflow: hidden;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
  .stmt { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; background: ${t.color.raised}; position: relative; }
  .date { font-size: 12px; color: ${t.color.text3}; }
  .desc { font-size: 13.5px; font-weight: 600; color: ${t.color.text}; word-break: break-word; }
  .amts { display: flex; gap: 24px; margin-top: 6px; }
  .amts > div { display: flex; flex-direction: column; }
  .amts .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: ${t.color.text3}; font-weight: 700; }
  .amts .v { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; min-height: 20px; }
  .rm {
    position: absolute; top: 10px; right: 12px; border: none; background: none; font: inherit; font-size: 11.5px;
    color: ${t.color.text3}; cursor: pointer; padding: 2px 4px;
    &:hover:not(:disabled) { color: ${t.color.danger}; text-decoration: underline; }
  }
  .mid { display: flex; align-items: center; justify-content: center; padding: 10px; border-left: 1px solid ${t.color.border}; border-right: 1px solid ${t.color.border}; }
  .side { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .suggest {
    border: 1px solid rgba(7,148,85,0.35); background: rgba(7,148,85,0.07); border-radius: ${t.radius};
    padding: 10px 12px; display: flex; flex-direction: column; gap: 3px;
    .amt { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: ${t.color.done}; }
  }
  .form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: end; }
  .match { display: flex; flex-direction: column; gap: 8px; }
  .match ul { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; }
  .match li {
    display: grid; grid-template-columns: 82px 1fr auto auto; gap: 8px; align-items: center;
    padding: 6px 2px; border-bottom: 1px solid ${t.color.border}; font-size: 12.5px;
  }
  .match li .desc { font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .match li .amt { font-variant-numeric: tabular-nums; }
  .match li .amt.exact { color: ${t.color.done}; font-weight: 700; }
  .none { font-size: 12.5px; color: ${t.color.text3}; padding: 6px 2px; }
`;
