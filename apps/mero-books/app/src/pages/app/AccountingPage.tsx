import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useAppCtx } from './appContext';
import type { AccountView, JournalLine, JournalView, TaxRateView } from '../../generated/BooksClient';
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, formatAmount, formatDay, formatRate, formatReport, isDate,
  matchesSearch, naturalBalance, parseAmount, parseRate,
} from '../../utils/books';
import { describeError } from '../../utils/errors';
import { AccountSelect, codeableAccounts } from '../../components/LineEditor';
import {
  Button, Chip, Empty, ErrorText, FieldGrid, Input, Label, Modal, NumInput, Page, PageHead, Row, Select,
  Table, TableWrap, Tabs, TextArea,
} from '../../components/ui';

/**
 * Accounting: the chart of accounts, manual journals and tax rates — the
 * three things an accountant sets up and adjusts. Every change goes through
 * the contract (`data.act`), which owns the rules (system accounts, balanced
 * journals, used accounts cannot be deleted); this page only collects input
 * and shows what the contract refuses.
 */

type TabKey = 'accounts' | 'journals' | 'tax';
const TABS: Array<[TabKey, string]> = [
  ['accounts', 'Chart of accounts'],
  ['journals', 'Manual journals'],
  ['tax', 'Tax rates'],
];

const CLASS_ORDER: Array<[string, string]> = [
  ['asset', 'Assets'],
  ['liability', 'Liabilities'],
  ['equity', 'Equity'],
  ['revenue', 'Revenue'],
  ['expense', 'Expenses'],
];

export default function AccountingPage(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.some(([k]) => k === raw) ? raw : 'accounts';

  const [accountModal, setAccountModal] = useState<AccountView | 'new' | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [taxModal, setTaxModal] = useState<TaxRateView | 'new' | null>(null);

  // `?tab=journals&new=1` opens the new-journal form straight away (dashboard shortcut).
  useEffect(() => {
    if (tab === 'journals' && params.get('new') === '1') {
      setJournalOpen(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [tab, params, setParams]);

  const setTab = (k: TabKey) => {
    const next = new URLSearchParams();
    next.set('tab', k);
    setParams(next);
  };

  return (
    <Page>
      <PageHead>
        <h1>Accounting</h1>
        <div className="actions">
          {tab === 'accounts' && (
            <Button type="button" $variant="primary" data-testid="account-add" onClick={() => setAccountModal('new')}>
              Add account
            </Button>
          )}
          {tab === 'journals' && (
            <Button type="button" $variant="primary" data-testid="journal-new" onClick={() => setJournalOpen(true)}>
              New journal
            </Button>
          )}
          {tab === 'tax' && (
            <Button type="button" $variant="primary" data-testid="tax-add" onClick={() => setTaxModal('new')}>
              Add tax rate
            </Button>
          )}
        </div>
      </PageHead>
      <div>
        <Tabs role="tablist" aria-label="Accounting">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} data-testid={`accounting-tab-${k}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </Tabs>
      </div>

      {tab === 'accounts' && <ChartOfAccounts onOpen={(a) => setAccountModal(a)} />}
      {tab === 'journals' && <Journals />}
      {tab === 'tax' && <TaxRates onOpen={(r) => setTaxModal(r)} />}

      {accountModal && (
        <AccountModal account={accountModal === 'new' ? null : accountModal} onClose={() => setAccountModal(null)} />
      )}
      {journalOpen && <JournalModal onClose={() => setJournalOpen(false)} />}
      {taxModal && <TaxRateModal rate={taxModal === 'new' ? null : taxModal} onClose={() => setTaxModal(null)} />}
    </Page>
  );
}

// ── Chart of accounts ───────────────────────────────────────────────────────

function ChartOfAccounts({ onOpen }: { onOpen: (a: AccountView) => void }) {
  const { data, searchQuery } = useAppCtx();
  const cur = data.settings.currency;
  const [showArchived, setShowArchived] = useState(false);

  const taxName = useMemo(() => new Map(data.taxRates.map((r) => [r.id, r.name])), [data.taxRates]);
  const groups = useMemo(() => {
    const visible = data.accounts.filter(
      (a) => (showArchived || !a.archived) && matchesSearch([a.code, a.name], searchQuery),
    );
    return CLASS_ORDER.map(([cls, label]) => ({
      cls,
      label,
      rows: visible.filter((a) => a.class === cls).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    })).filter((g) => g.rows.length > 0);
  }, [data.accounts, showArchived, searchQuery]);
  const archivedCount = data.accounts.filter((a) => a.archived).length;

  return (
    <>
      <Row $gap={12}>
        <CheckLabel>
          <input
            type="checkbox"
            checked={showArchived}
            data-testid="account-show-archived"
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
        </CheckLabel>
      </Row>
      <TableWrap>
        {groups.length === 0 ? (
          <Empty>
            <strong>{searchQuery ? 'No matching accounts' : 'No accounts yet'}</strong>
            {searchQuery ? 'Try a different code or name.' : 'Add an account to start coding transactions.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Default tax</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.cls} data-testid={`account-group-${g.cls}`}>
                <GroupRow><td colSpan={5}>{g.label}</td></GroupRow>
                {g.rows.map((a) => {
                  const bal = naturalBalance(a.balance, a.class);
                  return (
                    <tr
                      key={a.id}
                      className="click"
                      data-testid="account-row"
                      data-account-id={a.id}
                      onClick={() => onOpen(a)}
                      style={a.archived ? { opacity: 0.55 } : undefined}
                    >
                      <td className="muted">{a.code}</td>
                      <td>
                        <Row $gap={8} $wrap>
                          <span className="strong">{a.name}</span>
                          {a.system && <Chip>System</Chip>}
                          {a.archived && <Chip $color={t.color.text3}>Archived</Chip>}
                        </Row>
                        {a.description && <Desc>{a.description}</Desc>}
                      </td>
                      <td className="muted">{ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type}</td>
                      <td className="muted">{a.default_tax_rate_id ? taxName.get(a.default_tax_rate_id) ?? '—' : '—'}</td>
                      <td className={`num${bal < 0 ? ' neg' : ''}`}>{formatReport(bal, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </Table>
        )}
      </TableWrap>
    </>
  );
}

function AccountModal({ account, onClose }: { account: AccountView | null; onClose: () => void }) {
  const { data } = useAppCtx();
  const cur = data.settings.currency;
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.account_type ?? 'expense');
  const [description, setDescription] = useState(account?.description ?? '');
  const [taxId, setTaxId] = useState(account?.default_tax_rate_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const system = account?.system ?? false;
  const canSave = code.trim() !== '' && name.trim() !== '' && !busy;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => data.act<unknown>((c) => {
    const fields = {
      code: code.trim(),
      name: name.trim(),
      account_type: type,
      description: description.trim(),
      default_tax_rate_id: taxId || null,
    };
    return account ? c.updateAccount({ account_id: account.id, ...fields }) : c.createAccount(fields);
  }));

  const toggleArchived = () => account && run(() =>
    data.act((c) => c.setAccountArchived({ account_id: account.id, archived: !account.archived })));

  const remove = () => {
    if (!account) return;
    if (!window.confirm(`Delete account ${account.code} · ${account.name}? This cannot be undone.`)) return;
    void run(() => data.act((c) => c.deleteAccount({ account_id: account.id })));
  };

  return (
    <Modal
      title={account ? `${account.code} · ${account.name}` : 'Add account'}
      sub={system ? 'A system account: the books post to it automatically, so its type is fixed and it cannot be archived or deleted.' : undefined}
      onClose={onClose}
      testId="account-modal"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); if (canSave) void save(); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <FieldGrid>
          <Label>
            Code
            <Input value={code} autoFocus={!account} data-testid="account-code" onChange={(e) => setCode(e.target.value)} />
          </Label>
          <Label>
            Type
            <Select value={type} disabled={system} data-testid="account-type" onChange={(e) => setType(e.target.value)}>
              {ACCOUNT_TYPES.map((k) => <option key={k} value={k}>{ACCOUNT_TYPE_LABEL[k]}</option>)}
            </Select>
          </Label>
        </FieldGrid>
        <Label>
          Name
          <Input value={name} data-testid="account-name" onChange={(e) => setName(e.target.value)} />
        </Label>
        <Label>
          Description
          <TextArea value={description} data-testid="account-description" onChange={(e) => setDescription(e.target.value)} />
        </Label>
        <Label>
          Default tax rate
          <Select value={taxId} data-testid="account-tax" onChange={(e) => setTaxId(e.target.value)}>
            <option value="">None</option>
            {data.taxRates.filter((r) => !r.archived || r.id === taxId).map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({formatRate(r.rate_bp)})</option>
            ))}
          </Select>
        </Label>

        {account && (
          <Row $gap={12} $wrap>
            <span style={{ fontSize: 12.5, color: t.color.text2 }}>
              Balance <strong>{formatReport(naturalBalance(account.balance, account.class), cur)}</strong>
            </span>
            <Link
              to={`${APP_ROUTE}/reports?report=ledger&account=${encodeURIComponent(account.id)}`}
              data-testid="account-transactions"
              style={{ fontSize: 12.5, color: t.color.accent, fontWeight: 600 }}
            >
              View transactions
            </Link>
          </Row>
        )}

        {error && <ErrorText role="alert" data-testid="account-error">{error}</ErrorText>}

        <div className="actions">
          {account && !system && (
            <Button type="button" $variant="danger" disabled={busy} data-testid="account-archive" onClick={() => void toggleArchived()}>
              {account.archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          {account && !system && account.balance === 0 && (
            <Button type="button" $variant="danger" disabled={busy} data-testid="account-delete" onClick={remove}>
              Delete
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" $variant="primary" disabled={!canSave} data-testid="account-save">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Manual journals ─────────────────────────────────────────────────────────

function Journals() {
  const { data, searchQuery, aliases } = useAppCtx();
  const toast = useToast();
  const cur = data.settings.currency;
  const [expanded, setExpanded] = useState<string | null>(null);
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);

  const journals = useMemo(
    () => data.journals.filter((j) => matchesSearch([j.narration, j.date], searchQuery)),
    [data.journals, searchQuery],
  );

  const voidJournal = async (j: JournalView) => {
    if (!window.confirm(`Void the journal "${j.narration || formatDay(j.date)}"? Its entries leave the ledger; the record stays for the audit trail.`)) return;
    const reason = window.prompt('Reason for voiding (optional)', '');
    if (reason === null) return;
    try {
      await data.act((c) => c.voidRecord({ record_id: j.id, reason: reason.trim() }));
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  };

  if (journals.length === 0) {
    return (
      <TableWrap>
        <Empty>
          <strong>{searchQuery ? 'No matching journals' : 'No manual journals yet'}</strong>
          {searchQuery ? 'Try a different search.' : 'Post a journal to adjust balances, accrue, or correct a coding mistake.'}
        </Empty>
      </TableWrap>
    );
  }

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Narration</th>
            <th className="num">Total</th>
            <th>Posted by</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {journals.map((j) => {
            const open = expanded === j.id;
            return (
              <React.Fragment key={j.id}>
                <tr
                  className={`click${j.voided ? ' voided' : ''}`}
                  data-testid="journal-row"
                  data-journal-id={j.id}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : j.id)}
                >
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDay(j.date)}</td>
                  <td>
                    <Row $gap={8} $wrap>
                      <span className="strong">{j.narration || '—'}</span>
                      {j.source === 'transfer' && <Chip $color={t.color.medium}>Transfer</Chip>}
                    </Row>
                  </td>
                  <td className="num">{formatAmount(j.total, cur)}</td>
                  <td className="muted">{aliases.resolve(j.posted_by)}</td>
                  <td>
                    {j.voided
                      ? <Chip $color={t.color.text3} data-testid="journal-status">Void</Chip>
                      : !j.balanced
                        ? <Chip $color={t.color.urgent} data-testid="journal-status">Unbalanced</Chip>
                        : <Chip $color={t.color.done} data-testid="journal-status">Posted</Chip>}
                  </td>
                  <td className="num">
                    {!j.voided && (
                      <Button
                        type="button"
                        $small
                        $variant="danger"
                        data-testid="journal-void"
                        onClick={(e) => { e.stopPropagation(); void voidJournal(j); }}
                      >
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
                {open && (
                  <tr data-testid="journal-lines">
                    <td colSpan={6} style={{ background: t.color.raised, padding: '6px 18px 14px' }}>
                      <Table>
                        <thead>
                          <tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr>
                        </thead>
                        <tbody>
                          {j.lines.map((l, i) => {
                            const a = accountById.get(l.account_id);
                            return (
                              <tr key={i}>
                                <td><span className="muted">{a?.code ?? ''}</span> {a?.name ?? l.account_id}</td>
                                <td className="muted">{l.description}</td>
                                <td className="num">{l.debit ? formatAmount(l.debit, cur) : ''}</td>
                                <td className="num">{l.credit ? formatAmount(l.credit, cur) : ''}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

interface DraftLine {
  key: string;
  accountId: string;
  description: string;
  debitText: string;
  creditText: string;
}

let lineSeq = 0;
function blankJournalLine(): DraftLine {
  lineSeq += 1;
  return { key: `j${lineSeq}`, accountId: '', description: '', debitText: '', creditText: '' };
}

function JournalModal({ onClose }: { onClose: () => void }) {
  const { data, today } = useAppCtx();
  const cur = data.settings.currency;
  const [date, setDate] = useState(today);
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankJournalLine(), blankJournalLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => codeableAccounts(data.accounts), [data.accounts]);

  const amount = (text: string): number | null => {
    if (!text.trim()) return 0;
    const v = parseAmount(text, cur);
    return v !== null && v >= 0 ? v : null;
  };

  const parsed = lines.map((l) => ({ ...l, debit: amount(l.debitText), credit: amount(l.creditText) }));
  const badAmount = parsed.some((l) => l.debit === null || l.credit === null);
  const totalDr = parsed.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCr = parsed.reduce((s, l) => s + (l.credit ?? 0), 0);
  const used = parsed.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  const missingAccount = used.some((l) => !l.accountId);
  const balanced = totalDr === totalCr;
  const canPost = !busy && !badAmount && !missingAccount && balanced && used.length >= 2 && totalDr > 0
    && isDate(date) && narration.trim() !== '';

  const set = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: JournalLine[] = used.map((l) => ({
        account_id: l.accountId,
        description: l.description.trim(),
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
      }));
      await data.act((c) => c.createJournal({ date, narration: narration.trim(), lines: payload }));
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New manual journal" sub="Debits must equal credits. Receivables and payables move through invoices and bills, not journals." onClose={onClose} wide testId="journal-modal">
      <FieldGrid $cols={3}>
        <Label>
          Date
          <Input type="date" value={date} data-testid="journal-date" onChange={(e) => setDate(e.target.value)} />
        </Label>
        <Label style={{ gridColumn: 'span 2' }}>
          Narration
          <Input
            value={narration}
            autoFocus
            placeholder="e.g. Depreciation for the quarter"
            data-testid="journal-narration"
            onChange={(e) => setNarration(e.target.value)}
          />
        </Label>
      </FieldGrid>

      <LinesTable>
        <thead>
          <tr>
            <th className="acct">Account</th>
            <th>Description</th>
            <th className="amt">Debit</th>
            <th className="amt">Credit</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {parsed.map((l, i) => (
            <tr key={l.key} data-testid="journal-line">
              <td className="acct">
                <AccountSelect accounts={options} value={l.accountId} testId="journal-line-account" onChange={(id) => set(l.key, { accountId: id })} />
              </td>
              <td>
                <Input
                  value={l.description}
                  aria-label={`Line ${i + 1} description`}
                  data-testid="journal-line-description"
                  onChange={(e) => set(l.key, { description: e.target.value })}
                />
              </td>
              <td className="amt">
                <NumInput
                  value={l.debitText}
                  placeholder="0.00"
                  aria-label={`Line ${i + 1} debit`}
                  aria-invalid={l.debit === null}
                  data-testid="journal-line-debit"
                  onChange={(e) => set(l.key, { debitText: e.target.value, creditText: e.target.value ? '' : l.creditText })}
                />
              </td>
              <td className="amt">
                <NumInput
                  value={l.creditText}
                  placeholder="0.00"
                  aria-label={`Line ${i + 1} credit`}
                  aria-invalid={l.credit === null}
                  data-testid="journal-line-credit"
                  onChange={(e) => set(l.key, { creditText: e.target.value, debitText: e.target.value ? '' : l.debitText })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="rm"
                  aria-label={`Remove line ${i + 1}`}
                  disabled={lines.length <= 2}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >×</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              <Button type="button" $small data-testid="journal-add-line" onClick={() => setLines((ls) => [...ls, blankJournalLine()])}>
                + Add line
              </Button>
            </td>
            <td className="amt" data-testid="journal-total-debit">{formatAmount(totalDr, cur)}</td>
            <td className="amt" data-testid="journal-total-credit">{formatAmount(totalCr, cur)}</td>
            <td />
          </tr>
        </tfoot>
      </LinesTable>

      {!balanced && (
        <ErrorText data-testid="journal-out-of-balance">Out of balance by {formatAmount(Math.abs(totalDr - totalCr), cur)}</ErrorText>
      )}
      {badAmount && <ErrorText>Amounts must be positive numbers.</ErrorText>}
      {missingAccount && <ErrorText>Every line with an amount needs an account.</ErrorText>}
      {error && <ErrorText role="alert" data-testid="journal-error">{error}</ErrorText>}

      <div className="actions">
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button type="button" $variant="primary" disabled={!canPost} data-testid="journal-post" onClick={() => void post()}>
          {busy ? 'Posting…' : 'Post journal'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Tax rates ───────────────────────────────────────────────────────────────

function TaxRates({ onOpen }: { onOpen: (r: TaxRateView) => void }) {
  const { data } = useAppCtx();
  const toast = useToast();

  const toggle = async (r: TaxRateView) => {
    try {
      await data.act((c) => c.setTaxRateArchived({ tax_rate_id: r.id, archived: !r.archived }));
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  };

  return (
    <>
      <TableWrap>
        {data.taxRates.length === 0 ? (
          <Empty><strong>No tax rates</strong>Add the rates you charge and pay.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><th>Name</th><th className="num">Rate</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {data.taxRates.map((r) => (
                <tr
                  key={r.id}
                  className="click"
                  data-testid="tax-row"
                  data-tax-id={r.id}
                  onClick={() => onOpen(r)}
                  style={r.archived ? { opacity: 0.55 } : undefined}
                >
                  <td className="strong">{r.name}</td>
                  <td className="num">{formatRate(r.rate_bp)}</td>
                  <td>{r.archived ? <Chip $color={t.color.text3}>Archived</Chip> : <Chip $color={t.color.done}>Active</Chip>}</td>
                  <td className="num">
                    <Row $gap={6} style={{ justifyContent: 'flex-end' }}>
                      <Button type="button" $small data-testid="tax-edit" onClick={(e) => { e.stopPropagation(); onOpen(r); }}>Edit</Button>
                      {r.id !== 'tax-none' && (
                        <Button
                          type="button"
                          $small
                          data-testid="tax-archive"
                          onClick={(e) => { e.stopPropagation(); void toggle(r); }}
                        >
                          {r.archived ? 'Restore' : 'Archive'}
                        </Button>
                      )}
                    </Row>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableWrap>
      <Note>Changing a rate never changes documents already saved — each line keeps the rate it was saved with.</Note>
    </>
  );
}

function TaxRateModal({ rate, onClose }: { rate: TaxRateView | null; onClose: () => void }) {
  const { data } = useAppCtx();
  const [name, setName] = useState(rate?.name ?? '');
  const [rateText, setRateText] = useState(rate ? String(rate.rate_bp / 100) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bp = parseRate(rateText);
  const canSave = name.trim() !== '' && bp !== null && !busy;

  const save = async () => {
    if (bp === null) return;
    setBusy(true);
    setError(null);
    try {
      await data.act<unknown>((c) => (rate
        ? c.updateTaxRate({ tax_rate_id: rate.id, name: name.trim(), rate_bp: bp })
        : c.createTaxRate({ name: name.trim(), rate_bp: bp })));
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={rate ? `Edit ${rate.name}` : 'Add tax rate'}
      sub="Changing a rate never changes documents already saved — each line keeps the rate it was saved with."
      onClose={onClose}
      testId="tax-modal"
    >
      <form onSubmit={(e) => { e.preventDefault(); if (canSave) void save(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FieldGrid>
          <Label>
            Name
            <Input value={name} autoFocus data-testid="tax-name" onChange={(e) => setName(e.target.value)} />
          </Label>
          <Label>
            Rate (%)
            <NumInput value={rateText} placeholder="20" data-testid="tax-rate" onChange={(e) => setRateText(e.target.value)} />
          </Label>
        </FieldGrid>
        {rateText.trim() !== '' && bp === null && <ErrorText>Enter a rate between 0 and 100.</ErrorText>}
        {error && <ErrorText role="alert" data-testid="tax-error">{error}</ErrorText>}
        <div className="actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" $variant="primary" disabled={!canSave} data-testid="tax-save">{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────

const GroupRow = styled.tr`
  td {
    background: ${t.color.raised}; font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em;
    text-transform: uppercase; color: ${t.color.text2}; padding: 8px 10px;
  }
`;

const Desc = styled.div`
  font-size: 12px; color: ${t.color.text3}; margin-top: 2px; line-height: 1.4;
`;

const CheckLabel = styled.label`
  display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: ${t.color.text2}; cursor: pointer;
  input { accent-color: ${t.color.accent}; }
`;

const Note = styled.p`
  margin: 0; font-size: 12.5px; color: ${t.color.text3}; line-height: 1.5;
`;

const LinesTable = styled.table`
  width: 100%; border-collapse: collapse; font-size: 13px;
  th {
    text-align: left; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: ${t.color.text3};
    font-weight: 700; padding: 6px 4px; border-bottom: 1px solid ${t.color.borderStrong};
  }
  td { padding: 5px 4px; vertical-align: middle; }
  th.acct, td.acct { width: 36%; }
  th.amt, td.amt { width: 17%; text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { border-top: 2px solid ${t.color.borderStrong}; font-weight: 700; padding-top: 8px; }
  tfoot td.amt { padding-right: 13px; }
  .rm {
    background: none; border: none; font-size: 18px; line-height: 1; color: ${t.color.text3}; cursor: pointer; padding: 2px 6px;
    &:hover:not(:disabled) { color: ${t.color.urgent}; }
    &:disabled { opacity: 0.3; cursor: default; }
  }
  @media (max-width: 720px) { th.acct, td.acct { width: auto; } }
`;
