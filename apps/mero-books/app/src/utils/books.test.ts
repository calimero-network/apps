import { describe, expect, it } from 'vitest';
import {
  addDays,
  amountToInput,
  daysBetween,
  documentLabel,
  documentStatus,
  draftTotals,
  financialYear,
  formatAmount,
  formatQuantity,
  formatRate,
  formatReport,
  lineAmounts,
  matchCandidates,
  naturalBalance,
  normaliseDate,
  parseAmount,
  parseQuantity,
  parseRate,
  parseStatementCsv,
  periodRange,
  splitCsvLine,
  suggestMatch,
  toCsv,
  toLineInputs,
  today,
} from './books';
import type { BankTransactionView, InvoiceView, JournalView, PaymentView, StatementLineView } from '../generated/BooksClient';

describe('money', () => {
  it('parses what people type', () => {
    expect(parseAmount('1234.5')).toBe(123450);
    expect(parseAmount('$1,234.50')).toBe(123450);
    expect(parseAmount('(12.00)')).toBe(-1200);
    expect(parseAmount('-12')).toBe(-1200);
    expect(parseAmount('1.2k')).toBe(120000);
    expect(parseAmount('0.005')).toBe(1); // half away from zero
    expect(parseAmount('500', 'JPY')).toBe(500);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
  });

  it('formats for ledgers and reports', () => {
    expect(formatAmount(123456)).toBe('1,234.56');
    expect(formatAmount(500, 'JPY')).toBe('500');
    expect(formatReport(-123456)).toBe('(1,234.56)');
    expect(formatReport(0)).toBe('–');
    expect(amountToInput(123450)).toBe('1234.50');
  });

  it('round-trips quantities and rates', () => {
    expect(parseQuantity('1.5')).toBe(1500);
    expect(parseQuantity('0')).toBeNull();
    expect(formatQuantity(1500)).toBe('1.5');
    expect(parseRate('12.5%')).toBe(1250);
    expect(parseRate('101')).toBeNull();
    expect(formatRate(2000)).toBe('20%');
  });

  it('computes lines exactly as the contract does', () => {
    // Mirrors logic/src/money.rs tests.
    expect(lineAmounts(2500, 1000, 2000, 'exclusive')).toEqual({ net: 2500, tax: 500 });
    expect(lineAmounts(1000, 12000, 2000, 'inclusive')).toEqual({ net: 10000, tax: 2000 });
    expect(lineAmounts(1000, 12000, 2000, 'none')).toEqual({ net: 12000, tax: 0 });
    expect(lineAmounts(333, 100, 1500, 'exclusive')).toEqual({ net: 33, tax: 5 });
    expect(lineAmounts(1000, -1000, 1000, 'exclusive')).toEqual({ net: -1000, tax: -100 });
  });

  it('totals a draft and drops blank rows on save', () => {
    const lines = [
      { description: 'Work', quantity: 1000, unitPrice: 10000, accountId: 'a', taxRateId: 't20' },
      { description: '', quantity: 1000, unitPrice: 0, accountId: 'a', taxRateId: 't20' },
    ];
    expect(draftTotals(lines, 'exclusive', (id) => (id === 't20' ? 2000 : 0))).toEqual({ subtotal: 10000, tax: 2000, total: 12000 });
    expect(toLineInputs(lines)).toHaveLength(1);
    expect(toLineInputs(lines)[0]).toMatchObject({ unit_price: 10000, tax_rate_id: 't20' });
  });

  it('flips credit-natured balances', () => {
    expect(naturalBalance(-500, 'revenue')).toBe(500);
    expect(naturalBalance(500, 'asset')).toBe(500);
  });
});

describe('dates', () => {
  it('does calendar arithmetic in whole days', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(daysBetween('2024-01-01', '2024-03-01')).toBe(60);
    expect(today(new Date(2024, 2, 7))).toBe('2024-03-07');
  });

  it('finds financial years and report periods', () => {
    expect(financialYear('2024-05-10', 12)).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(financialYear('2024-05-10', 6)).toEqual({ from: '2023-07-01', to: '2024-06-30' });
    expect(financialYear('2025-03-31', 3)).toEqual({ from: '2024-04-01', to: '2025-03-31' });
    expect(periodRange('last_month', '2024-01-15', 12)).toEqual({ from: '2023-12-01', to: '2023-12-31' });
    expect(periodRange('this_quarter', '2024-05-15', 12)).toEqual({ from: '2024-04-01', to: '2024-06-30' });
    expect(periodRange('last_quarter', '2024-02-15', 12)).toEqual({ from: '2023-10-01', to: '2023-12-31' });
    expect(periodRange('last_year', '2024-05-10', 6)).toEqual({ from: '2022-07-01', to: '2023-06-30' });
  });

  it('reads the date formats banks export', () => {
    expect(normaliseDate('2024-03-07')).toBe('2024-03-07');
    expect(normaliseDate('07/03/2024')).toBe('2024-03-07');
    expect(normaliseDate('3/7/2024', true)).toBe('2024-03-07');
    expect(normaliseDate('07.03.24')).toBe('2024-03-07');
    expect(normaliseDate('31/02/2024')).toBeNull();
  });
});

describe('documents', () => {
  it('derives overdue from today', () => {
    expect(documentStatus({ status: 'awaiting_payment', due_date: '2024-03-01' }, '2024-03-02')).toBe('overdue');
    expect(documentStatus({ status: 'awaiting_payment', due_date: '2024-03-01' }, '2024-03-01')).toBe('awaiting_payment');
    expect(documentStatus({ status: 'paid', due_date: '2024-03-01' }, '2024-04-01')).toBe('paid');
  });

  it('labels a document by number, then the supplier reference', () => {
    expect(documentLabel({ kind: 'sales', number: 'INV-0003', reference: 'PO', status: 'paid' })).toBe('INV-0003');
    expect(documentLabel({ kind: 'bill', number: '', reference: 'SUP-9', status: 'paid' })).toBe('SUP-9');
    expect(documentLabel({ kind: 'sales', number: '', reference: '', status: 'draft' })).toBe('Draft');
  });
});

describe('bank statements', () => {
  it('splits quoted CSV', () => {
    expect(splitCsvLine('2024-03-01,"Acme, Ltd ""UK""",-12.50')).toEqual(['2024-03-01', 'Acme, Ltd "UK"', '-12.50']);
  });

  it('reads a single-amount export', () => {
    const csv = 'Date,Description,Amount\n07/03/2024,Coffee,-3.50\n08/03/2024,"Acme, Ltd",1200\n';
    const r = parseStatementCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { date: '2024-03-07', description: 'Coffee', amount: -350 },
      { date: '2024-03-08', description: 'Acme, Ltd', amount: 120000 },
    ]);
  });

  it('reads a paid-in / paid-out export and reports bad rows', () => {
    const csv = 'Transaction Date,Payee,Paid out,Paid in\n2024-03-07,Fee,1.50,\nnot-a-date,X,,5\n2024-03-09,Client,,99\n';
    const r = parseStatementCsv(csv);
    expect(r.lines.map((l) => l.amount)).toEqual([-150, 9900]);
    expect(r.errors).toHaveLength(1);
  });

  it('refuses a file it cannot map', () => {
    expect(parseStatementCsv('Foo,Bar\n1,2').errors.length).toBeGreaterThan(0);
  });
});

describe('reconciliation', () => {
  const invoice = { id: 'inv-1', kind: 'sales', number: 'INV-0001', reference: '', status: 'paid', contact_name: 'Acme' } as InvoiceView;
  const payment = { id: 'pay-1', invoice_id: 'inv-1', invoice_kind: 'sales', bank_account_id: 'acc-bank', date: '2024-03-02', amount: 120000, voided: false } as PaymentView;
  const fee = { id: 'spend-1', kind: 'spend', bank_account_id: 'acc-bank', date: '2024-03-03', total: 150, voided: false, contact_name: '', reference: 'Fee', lines: [] } as unknown as BankTransactionView;
  const xfer = {
    id: 'xfer-1', source: 'transfer', balanced: true, voided: false, date: '2024-03-04', narration: 'To savings',
    lines: [{ account_id: 'acc-savings', debit: 500, credit: 0, description: '' }, { account_id: 'acc-bank', debit: 0, credit: 500, description: '' }],
  } as JournalView;

  it('lists signed, unmatched movements through one account', () => {
    const c = matchCandidates('acc-bank', [payment], [fee], [xfer], [invoice], []);
    expect(c.map((x) => [x.id, x.amount])).toEqual([['pay-1', 120000], ['spend-1', -150], ['xfer-1', -500]]);
    const reconciled = [{ matched: 'pay-1', reconciled: true } as StatementLineView];
    expect(matchCandidates('acc-bank', [payment], [], [], [invoice], reconciled)).toEqual([]);
  });

  it('suggests the same amount at the nearest date, preferring a shared word', () => {
    const c = matchCandidates('acc-bank', [payment], [fee], [], [invoice], []);
    expect(suggestMatch({ date: '2024-03-05', amount: 120000, description: 'ACME LTD' }, c)?.id).toBe('pay-1');
    expect(suggestMatch({ date: '2024-05-05', amount: 120000, description: 'ACME LTD' }, c)).toBeNull();
    expect(suggestMatch({ date: '2024-03-05', amount: 99, description: '' }, c)).toBeNull();
  });
});

describe('export', () => {
  it('quotes cells that need it', () => {
    expect(toCsv([['Account', 'Amount'], ['Rent, office', 1200], ['Say "hi"', -5]])).toBe(
      'Account,Amount\n"Rent, office",1200\n"Say ""hi""",-5',
    );
  });
});
