// Pure helpers behind every accounting view: money and quantity parsing and
// formatting, dates, document status, bank-statement CSV import, reconciliation
// suggestions and report export. No React, no client — so all of it is unit
// tested in books.test.ts.
//
// Units match the contract exactly: money is integer MINOR units (cents),
// quantities are integer THOUSANDTHS, tax rates are BASIS POINTS, and dates
// are `YYYY-MM-DD` strings. Floats appear only on the way in from a text box
// and on the way out to a screen.

import type {
  InvoiceView,
  LineInput,
  PaymentView,
  BankTransactionView,
  JournalView,
  StatementLineView,
} from '../generated/BooksClient';

// ── money ──────────────────────────────────────────────────────────────────

/** Currencies quoted without minor units. Everything else has two. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);

export function minorDigits(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** `123456` minor units → `1,234.56` (no symbol: ledgers align numbers, not symbols). */
export function formatAmount(minor: number, currency = 'USD'): string {
  const digits = minorDigits(currency);
  const value = minor / 10 ** digits;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** `1,234.56` with a currency code, or a symbol where Intl has one. */
export function formatMoney(minor: number, currency = 'USD'): string {
  const digits = minorDigits(currency);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return `${formatAmount(minor, currency)} ${currency}`;
  }
}

/** A report cell: negatives in brackets, zero as a dash. */
export function formatReport(minor: number, currency = 'USD'): string {
  if (minor === 0) return '–';
  const s = formatAmount(Math.abs(minor), currency);
  return minor < 0 ? `(${s})` : s;
}

/**
 * Parse what someone typed into an amount box into minor units, or `null`.
 * Accepts `1234.5`, `1,234.50`, `-12`, `(12.00)`, `$1,200`, `1.2k`.
 */
export function parseAmount(text: string, currency = 'USD'): number | null {
  let s = text.trim().replace(/[\s,]/g, '').replace(/^[^\d\-(.]+/, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  let scale = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (suffix === 'k' || suffix === 'm') {
    scale = suffix === 'k' ? 1_000 : 1_000_000;
    s = s.slice(0, -1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const digits = minorDigits(currency);
  const minor = Math.round(Number(s) * scale * 10 ** digits);
  if (!Number.isFinite(minor) || Math.abs(minor) > 1e15) return null;
  return negative ? -minor : minor;
}

/** Minor units → the plain decimal an input box shows (`1234.50`). */
export function amountToInput(minor: number, currency = 'USD'): string {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/** Quantity in thousandths ↔ text. `1500` ⇄ `1.5`. */
export function parseQuantity(text: string): number | null {
  const s = text.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const q = Math.round(Number(s) * 1000);
  return q > 0 && q <= 1e12 ? q : null;
}

export function formatQuantity(thousandths: number): string {
  return (thousandths / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** Basis points → `20%`, `12.5%`. */
export function formatRate(bp: number): string {
  return `${(bp / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function parseRate(text: string): number | null {
  const s = text.trim().replace(/%$/, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10_000 ? bp : null;
}

// ── line maths (mirrors logic/src/money.rs, for the live editor totals) ─────

/** Round half away from zero, as the contract does. */
function divRound(n: number, d: number): number {
  return n >= 0 ? Math.floor((n + Math.floor(d / 2)) / d) : -Math.floor((-n + Math.floor(d / 2)) / d);
}

export interface LineDraft {
  description: string;
  quantity: number;
  unitPrice: number;
  accountId: string;
  taxRateId: string;
}

export function lineAmounts(quantity: number, unitPrice: number, taxBp: number, mode: string): { net: number; tax: number } {
  const gross = divRound(quantity * unitPrice, 1000);
  const bp = Math.min(taxBp, 10_000);
  if (mode === 'inclusive') {
    const tax = divRound(gross * bp, 10_000 + bp);
    return { net: gross - tax, tax };
  }
  if (mode === 'none') return { net: gross, tax: 0 };
  return { net: gross, tax: divRound(gross * bp, 10_000) };
}

export function draftTotals(
  lines: LineDraft[],
  mode: string,
  rateOf: (taxRateId: string) => number,
): { subtotal: number; tax: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const a = lineAmounts(l.quantity, l.unitPrice, rateOf(l.taxRateId), mode);
    subtotal += a.net;
    tax += a.tax;
  }
  return { subtotal, tax, total: subtotal + tax };
}

export function toLineInputs(lines: LineDraft[]): LineInput[] {
  return lines
    .filter((l) => l.description.trim() || l.unitPrice !== 0)
    .map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity,
      unit_price: l.unitPrice,
      account_id: l.accountId,
      tax_rate_id: l.taxRateId,
    }));
}

// ── dates ──────────────────────────────────────────────────────────────────

/** Today in the browser's own calendar, as `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2024-03-07` → `7 Mar 2024`. */
export function formatDay(date: string): string {
  if (!isDate(date)) return date;
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `2024-03` → `Mar`. */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS[m - 1] ?? month;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The financial year containing `date`, for a year ending in `fyEndMonth`. */
export function financialYear(date: string, fyEndMonth: number): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const startMonth = (fyEndMonth % 12) + 1;
  const startYear = m >= startMonth ? y : y - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const from = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const to = `${endYear}-${String(fyEndMonth).padStart(2, '0')}-${lastDayOfMonth(endYear, fyEndMonth)}`;
  return { from, to };
}

export type PeriodPreset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_year: 'This financial year',
  last_year: 'Last financial year',
};

export function periodRange(preset: PeriodPreset, todayStr: string, fyEndMonth: number): { from: string; to: string } {
  const [y, m] = todayStr.split('-').map(Number);
  const month = (yy: number, mm: number) => {
    const d = new Date(Date.UTC(yy, mm - 1, 1));
    const Y = d.getUTCFullYear();
    const M = d.getUTCMonth() + 1;
    return {
      from: `${Y}-${String(M).padStart(2, '0')}-01`,
      to: `${Y}-${String(M).padStart(2, '0')}-${lastDayOfMonth(Y, M)}`,
    };
  };
  switch (preset) {
    case 'this_month':
      return month(y, m);
    case 'last_month':
      return month(y, m - 1);
    case 'this_quarter':
    case 'last_quarter': {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1 - (preset === 'last_quarter' ? 3 : 0);
      return { from: month(y, qStart).from, to: month(y, qStart + 2).to };
    }
    case 'this_year':
      return financialYear(todayStr, fyEndMonth);
    case 'last_year': {
      const cur = financialYear(todayStr, fyEndMonth);
      return financialYear(addDays(cur.from, -1), fyEndMonth);
    }
  }
}

// ── documents ──────────────────────────────────────────────────────────────

export type DocStatus = 'draft' | 'awaiting_payment' | 'overdue' | 'paid' | 'void';

/** The contract's status plus overdue, which depends on today. */
export function documentStatus(inv: Pick<InvoiceView, 'status' | 'due_date'>, todayStr: string): DocStatus {
  if (inv.status === 'awaiting_payment' && inv.due_date < todayStr) return 'overdue';
  return inv.status as DocStatus;
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'Draft',
  awaiting_payment: 'Awaiting payment',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
};

/** What a list row calls a document: its number, else the supplier's ref. */
export function documentLabel(inv: Pick<InvoiceView, 'kind' | 'number' | 'reference' | 'status'>): string {
  if (inv.number) return inv.number;
  if (inv.kind === 'bill' && inv.reference) return inv.reference;
  return inv.status === 'draft' ? 'Draft' : '—';
}

export function matchesSearch(haystack: Array<string | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => h?.toLowerCase().includes(q));
}

// ── bank statement CSV ─────────────────────────────────────────────────────

/** Split one CSV record, honouring quotes and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** `2024-03-07`, `07/03/2024` (day first) or `3/7/2024` with `monthFirst`. */
export function normaliseDate(text: string, monthFirst = false): string | null {
  const s = text.trim();
  if (isDate(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  let [, a, b, y] = m;
  if (y.length === 2) y = `20${y}`;
  const [d, mo] = monthFirst ? [b, a] : [a, b];
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isDate(iso) ? iso : null;
}

export interface ParsedStatement {
  lines: { date: string; description: string; amount: number }[];
  errors: string[];
}

/**
 * Parse a bank's CSV export. Finds the date, description and amount columns
 * by header name (`Date`, `Description`/`Payee`/`Narrative`/`Memo`,
 * `Amount`, or a `Debit`/`Credit` pair — `Paid out`/`Paid in` too).
 */
export function parseStatementCsv(text: string, currency = 'USD', monthFirst = false): ParsedStatement {
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  const errors: string[] = [];
  if (rows.length < 2) return { lines: [], errors: ['The file needs a header row and at least one line.'] };
  const header = splitCsvLine(rows[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const dateCol = find('date');
  const descCol = find('description', 'payee', 'narrative', 'details', 'memo', 'reference', 'name');
  const amountCol = header.findIndex((h) => h === 'amount' || h.startsWith('amount'));
  const debitCol = find('debit', 'paid out', 'withdrawal', 'money out');
  const creditCol = find('credit', 'paid in', 'deposit', 'money in');
  if (dateCol < 0) errors.push('No "Date" column found.');
  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) errors.push('No "Amount" column (or "Debit" and "Credit" columns) found.');
  if (errors.length) return { lines: [], errors };

  const lines: ParsedStatement['lines'] = [];
  rows.slice(1).forEach((row, i) => {
    const cells = splitCsvLine(row);
    const date = normaliseDate(cells[dateCol] ?? '', monthFirst);
    let amount: number | null;
    if (amountCol >= 0) {
      amount = parseAmount(cells[amountCol] ?? '', currency);
    } else {
      const out = parseAmount(cells[debitCol] ?? '', currency) ?? 0;
      const inn = parseAmount(cells[creditCol] ?? '', currency) ?? 0;
      amount = inn - Math.abs(out);
    }
    if (!date) { errors.push(`Row ${i + 2}: unreadable date "${cells[dateCol] ?? ''}".`); return; }
    if (amount === null || amount === 0) { errors.push(`Row ${i + 2}: no amount.`); return; }
    const description = (descCol >= 0 ? cells[descCol] : '')?.slice(0, 200) ?? '';
    lines.push({ date, description, amount });
  });
  return { lines, errors };
}

// ── reconciliation ─────────────────────────────────────────────────────────

/** Something a statement line could be matched to. */
export interface MatchCandidate {
  id: string;
  date: string;
  amount: number; // signed, as the bank sees it
  label: string;
  kind: 'payment' | 'spend' | 'receive' | 'transfer';
}

/**
 * Every live bank movement through `bankAccountId` not already reconciled to
 * a line, as statement-signed amounts.
 */
export function matchCandidates(
  bankAccountId: string,
  payments: PaymentView[],
  bankTxns: BankTransactionView[],
  journals: JournalView[],
  invoices: InvoiceView[],
  statement: StatementLineView[],
): MatchCandidate[] {
  const taken = new Set(statement.filter((l) => l.reconciled && l.matched).map((l) => l.matched as string));
  const inv = new Map(invoices.map((i) => [i.id, i]));
  const out: MatchCandidate[] = [];
  for (const p of payments) {
    if (p.voided || p.bank_account_id !== bankAccountId || taken.has(p.id)) continue;
    const doc = inv.get(p.invoice_id);
    const sign = p.invoice_kind === 'sales' ? 1 : -1;
    out.push({
      id: p.id, date: p.date, amount: sign * p.amount, kind: 'payment',
      label: `Payment · ${doc ? documentLabel(doc) : ''} · ${doc?.contact_name ?? ''}`,
    });
  }
  for (const t of bankTxns) {
    if (t.voided || t.bank_account_id !== bankAccountId || taken.has(t.id)) continue;
    out.push({
      id: t.id, date: t.date, amount: (t.kind === 'receive' ? 1 : -1) * t.total, kind: t.kind as 'spend' | 'receive',
      label: `${t.kind === 'receive' ? 'Receive' : 'Spend'} · ${t.contact_name || t.reference || t.lines[0]?.description || ''}`,
    });
  }
  for (const j of journals) {
    if (j.voided || !j.balanced || j.source !== 'transfer' || taken.has(j.id)) continue;
    const leg = j.lines.find((l) => l.account_id === bankAccountId);
    if (!leg) continue;
    out.push({ id: j.id, date: j.date, amount: leg.debit - leg.credit, kind: 'transfer', label: `Transfer · ${j.narration}` });
  }
  return out;
}

/**
 * The best match for a statement line: same amount, nearest date within two
 * weeks, ties broken by a shared word in the description.
 */
export function suggestMatch(
  line: Pick<StatementLineView, 'date' | 'amount' | 'description'>,
  candidates: MatchCandidate[],
): MatchCandidate | null {
  const words = new Set(line.description.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  let best: MatchCandidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.amount !== line.amount) continue;
    const gap = Math.abs(daysBetween(c.date, line.date));
    if (gap > 14) continue;
    const shared = c.label.toLowerCase().split(/\W+/).some((w) => words.has(w)) ? 1 : 0;
    const score = shared * 100 - gap;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// ── export ─────────────────────────────────────────────────────────────────

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Human names for the chart's account types. */
export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  bank: 'Bank',
  current_asset: 'Current asset',
  fixed_asset: 'Fixed asset',
  current_liability: 'Current liability',
  liability: 'Non-current liability',
  equity: 'Equity',
  revenue: 'Revenue',
  other_income: 'Other income',
  direct_costs: 'Direct costs',
  expense: 'Expense',
};

export const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL);

/** A balance as it reads naturally: credit-natured classes flip sign. */
export function naturalBalance(balance: number, accountClass: string): number {
  return accountClass === 'liability' || accountClass === 'equity' || accountClass === 'revenue' ? -balance : balance;
}
