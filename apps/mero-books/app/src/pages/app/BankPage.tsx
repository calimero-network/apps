import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useQuery } from '../../hooks/useBooks';
import { formatAmount, formatDay, formatMoney } from '../../utils/books';
import { describeError } from '../../utils/errors';
import BankTransactionModal from '../../components/BankTransactionModal';
import TransferModal from '../../components/TransferModal';
import {
  Button, Empty, ErrorText, Grid, Input, Label, Modal, Page, PageHead, Panel, Table, TableWrap,
} from '../../components/ui';
import { useAppCtx } from './appContext';

type ModalKind = 'spend' | 'receive' | 'transfer' | 'add' | null;

interface Movement {
  key: string;
  id: string;
  date: string;
  at: number;
  description: string;
  link: string | null;
  accountId: string;
  amount: number; // signed: positive = money in
  voided: boolean;
  voidable: boolean;
}

/**
 * Bank accounts: one card per account with the ledger balance, the statement
 * balance and what is left to reconcile, and the latest money in and out
 * across every account.
 */
export default function BankPage(): React.ReactElement {
  const { data, today } = useAppCtx();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { settings, accounts, payments, bankTransactions, journals, invoices } = data;
  const cur = settings.currency;
  const { data: dash, error: dashError } = useQuery(data, (c) => c.getDashboard({ today }), [today]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [error, setError] = useState<string | null>(null);

  // `?new=spend|receive|transfer` opens the matching modal once.
  const wanted = params.get('new');
  useEffect(() => {
    if (wanted === 'spend' || wanted === 'receive' || wanted === 'transfer') {
      setModal(wanted);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [wanted, params, setParams]);

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const bankIds = useMemo(() => new Set(accounts.filter((a) => a.account_type === 'bank').map((a) => a.id)), [accounts]);

  const movements = useMemo<Movement[]>(() => {
    const inv = new Map(invoices.map((i) => [i.id, i]));
    const out: Movement[] = [];
    for (const b of bankTransactions) {
      out.push({
        key: `b-${b.id}`, id: b.id, date: b.date, at: b.at,
        description: [b.contact_name, b.reference || b.lines[0]?.description].filter(Boolean).join(' · ') || (b.kind === 'spend' ? 'Spend money' : 'Receive money'),
        link: null, accountId: b.bank_account_id,
        amount: (b.kind === 'receive' ? 1 : -1) * b.total, voided: b.voided, voidable: !b.voided,
      });
    }
    for (const p of payments) {
      const doc = inv.get(p.invoice_id);
      const sales = p.invoice_kind === 'sales';
      const docLabel = doc ? (doc.number || doc.reference || (sales ? 'Invoice' : 'Bill')) : '';
      out.push({
        key: `p-${p.id}`, id: p.id, date: p.date, at: p.at,
        description: ['Payment', doc?.contact_name, docLabel, p.reference].filter(Boolean).join(' · '),
        link: `${APP_ROUTE}/${sales ? 'sales' : 'purchases'}/${p.invoice_id}`,
        accountId: p.bank_account_id,
        amount: (sales ? 1 : -1) * p.amount, voided: p.voided, voidable: false,
      });
    }
    for (const j of journals) {
      if (j.source !== 'transfer') continue;
      for (const leg of j.lines) {
        if (!bankIds.has(leg.account_id)) continue;
        out.push({
          key: `j-${j.id}-${leg.account_id}`, id: j.id, date: j.date, at: j.at,
          description: `Transfer · ${j.narration}`, link: null, accountId: leg.account_id,
          amount: leg.debit - leg.credit, voided: j.voided, voidable: false,
        });
      }
    }
    out.sort((a, b) => (a.date === b.date ? b.at - a.at : a.date < b.date ? 1 : -1));
    return out.slice(0, 50);
  }, [bankTransactions, payments, journals, invoices, bankIds]);

  const voidTxn = async (id: string) => {
    const reason = window.prompt('Why are you voiding this transaction?');
    if (reason === null) return;
    setError(null);
    try {
      await data.act((c) => c.voidRecord({ record_id: id, reason: reason.trim() || 'Voided' }));
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Page data-testid="bank-page">
      <PageHead>
        <div>
          <h1>Bank accounts</h1>
          <div className="sub">Balances, statements and reconciliation</div>
        </div>
        <div className="actions">
          <Button $variant="primary" onClick={() => setModal('spend')} data-testid="bank-spend">Spend money</Button>
          <Button $variant="primary" onClick={() => setModal('receive')} data-testid="bank-receive">Receive money</Button>
          <Button onClick={() => setModal('transfer')} data-testid="bank-transfer">Transfer</Button>
          <Button onClick={() => setModal('add')} data-testid="bank-add">Add bank account</Button>
        </div>
      </PageHead>

      {dashError && <ErrorText>{describeError(dashError)}</ErrorText>}
      {!dash ? (
        <Panel><Empty>Loading…</Empty></Panel>
      ) : dash.bank_accounts.length === 0 ? (
        <Panel><Empty><strong>No bank accounts yet</strong>Add one to start recording money in and out.</Empty></Panel>
      ) : (
        <Grid $min={280}>
          {dash.bank_accounts.map((b) => {
            const to = `${APP_ROUTE}/bank/${b.account_id}`;
            return (
              <Card
                key={b.account_id}
                data-testid="bank-card"
                role="link"
                tabIndex={0}
                onClick={() => navigate(to)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(to); }}
              >
                <div className="head">
                  <span className="name">{b.name}</span>
                  <span className="code">{b.code}</span>
                </div>
                <div className="figs">
                  <div>
                    <div className="k">Balance in Mero Books</div>
                    <div className="v" data-testid="bank-balance">{formatMoney(b.balance, cur)}</div>
                  </div>
                  <div>
                    <div className="k">Statement balance</div>
                    <div className="v small" data-testid="bank-statement-balance">{formatMoney(b.statement_balance, cur)}</div>
                  </div>
                </div>
                <div className="foot">
                  {b.unreconciled > 0 ? (
                    <>
                      <span className="todo">{b.unreconciled} item{b.unreconciled === 1 ? '' : 's'} to reconcile</span>
                      <Button
                        $variant="primary"
                        $small
                        data-testid="bank-reconcile"
                        onClick={(e) => { e.stopPropagation(); navigate(to); }}
                      >
                        Reconcile {b.unreconciled} item{b.unreconciled === 1 ? '' : 's'}
                      </Button>
                    </>
                  ) : (
                    <span className="ok">Reconciled</span>
                  )}
                </div>
              </Card>
            );
          })}
        </Grid>
      )}

      <Panel>
        <h3>Recent transactions</h3>
        {error && <ErrorText>{error}</ErrorText>}
        {movements.length === 0 ? (
          <Empty><strong>No transactions yet</strong>Spend or receive money, record a payment, or transfer between accounts.</Empty>
        ) : (
          <TableWrap>
            <Table data-testid="bank-recent">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th className="num">Spent</th>
                  <th className="num">Received</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.key} className={m.voided ? 'voided' : undefined} data-testid="bank-recent-row">
                    <td className="muted">{formatDay(m.date)}</td>
                    <td className="strong">{m.link ? <Link to={m.link}>{m.description}</Link> : m.description}</td>
                    <td>{accountName.get(m.accountId) ?? m.accountId}</td>
                    <td className="num">{m.amount < 0 ? formatAmount(-m.amount, cur) : ''}</td>
                    <td className="num">{m.amount > 0 ? formatAmount(m.amount, cur) : ''}</td>
                    <td className="num">
                      {m.voidable && (
                        <Button $small $variant="danger" onClick={() => void voidTxn(m.id)} data-testid="bank-txn-void">Void</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Panel>

      {(modal === 'spend' || modal === 'receive') && (
        <BankTransactionModal kind={modal} onClose={() => setModal(null)} data={data} today={today} />
      )}
      {modal === 'transfer' && <TransferModal onClose={() => setModal(null)} data={data} today={today} />}
      {modal === 'add' && <AddBankAccountModal onClose={() => setModal(null)} />}
    </Page>
  );
}

function AddBankAccountModal({ onClose }: { onClose: () => void }) {
  const { data } = useAppCtx();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!code.trim() || !name.trim()) { setError('A bank account needs a code and a name.'); return; }
    setBusy(true);
    setError(null);
    try {
      await data.act((c) => c.createAccount({
        code: code.trim(), name: name.trim(), account_type: 'bank', description: '', default_tax_rate_id: null,
      }));
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add bank account" onClose={onClose} testId="bank-add-modal">
      <Label>
        Code
        <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 091" data-testid="bank-add-code" />
      </Label>
      <Label>
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Business Savings" data-testid="bank-add-name" />
      </Label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="actions">
        <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" $variant="primary" onClick={save} disabled={busy} data-testid="bank-add-save">
          {busy ? 'Saving…' : 'Add account'}
        </Button>
      </div>
    </Modal>
  );
}

const Card = styled(Panel)`
  cursor: pointer; display: flex; flex-direction: column; gap: 14px;
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  &:hover, &:focus-visible { border-color: ${t.color.accentBorder}; box-shadow: 0 2px 8px rgba(15,23,42,0.06); outline: none; }
  .head { display: flex; align-items: baseline; gap: 8px; }
  .name { font-size: 15px; font-weight: 700; color: ${t.color.text}; }
  .code { font-size: 12px; color: ${t.color.text3}; }
  .figs { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .k { font-size: 11.5px; color: ${t.color.text2}; font-weight: 600; }
  .v { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .v.small { font-size: 15px; color: ${t.color.text2}; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; }
  .todo { font-size: 12.5px; color: ${t.color.high}; font-weight: 600; }
  .ok { font-size: 12.5px; color: ${t.color.done}; font-weight: 600; }
`;
