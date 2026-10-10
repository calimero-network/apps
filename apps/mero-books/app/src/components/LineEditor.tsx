// The line-items table shared by invoices, bills and spend/receive money:
// description, quantity, price, account, tax rate, and the line amount, with
// the subtotal / tax / total underneath computed exactly as the contract
// computes them (utils/books lineAmounts mirrors logic/src/money.rs).
import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import type { AccountView, TaxRateView } from '../generated/BooksClient';
import {
  ACCOUNT_TYPE_LABEL, amountToInput, draftTotals, formatAmount, formatQuantity, formatRate,
  lineAmounts, parseAmount, parseQuantity, type LineDraft,
} from '../utils/books';
import { Input, NumInput, Select } from './ui';

/** Lines being edited keep the raw text of their number boxes, so typing
 *  `1.` or `12,5` is not rewritten under the cursor. */
export interface EditableLine extends LineDraft {
  key: string;
  qtyText: string;
  priceText: string;
}

let seq = 0;
export function blankLine(accountId = '', taxRateId = 'tax-none'): EditableLine {
  seq += 1;
  return {
    key: `l${seq}`, description: '', quantity: 1000, unitPrice: 0, accountId, taxRateId,
    qtyText: '1', priceText: '',
  };
}

export function editableFrom(
  lines: Array<{ description: string; quantity: number; unit_price: number; account_id: string; tax_rate_id: string }>,
  currency: string,
): EditableLine[] {
  return lines.map((l) => {
    seq += 1;
    return {
      key: `l${seq}`,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      accountId: l.account_id,
      taxRateId: l.tax_rate_id,
      qtyText: formatQuantity(l.quantity).replace(/,/g, ''),
      priceText: amountToInput(l.unit_price, currency),
    };
  });
}

/** Accounts a line may be coded to: active, and never the AR/AP control accounts. */
export function codeableAccounts(accounts: AccountView[], exclude: string[] = []): AccountView[] {
  return accounts.filter((a) => !a.archived && a.id !== 'acc-ar' && a.id !== 'acc-ap' && !exclude.includes(a.id));
}

export function AccountSelect({
  accounts, value, onChange, testId, placeholder = 'Choose account',
}: {
  accounts: AccountView[];
  value: string;
  onChange: (id: string) => void;
  testId?: string;
  placeholder?: string;
}) {
  const groups = new Map<string, AccountView[]>();
  for (const a of accounts) {
    const g = ACCOUNT_TYPE_LABEL[a.account_type] ?? a.account_type;
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="">{placeholder}</option>
      {[...groups.entries()].map(([g, list]) => (
        <optgroup key={g} label={g}>
          {list.map((a) => (
            <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function TaxSelect({
  rates, value, onChange, testId, disabled,
}: { rates: TaxRateView[]; value: string; onChange: (id: string) => void; testId?: string; disabled?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} disabled={disabled}>
      {rates.filter((r) => !r.archived || r.id === value).map((r) => (
        <option key={r.id} value={r.id}>{r.name} ({formatRate(r.rate_bp)})</option>
      ))}
    </Select>
  );
}

export default function LineEditor({
  lines, onChange, accounts, taxRates, mode, currency, taxLabel, excludeAccounts = [],
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  accounts: AccountView[];
  taxRates: TaxRateView[];
  mode: string;
  currency: string;
  taxLabel: string;
  excludeAccounts?: string[];
}) {
  const options = codeableAccounts(accounts, excludeAccounts);
  const rateOf = (id: string) => taxRates.find((r) => r.id === id)?.rate_bp ?? 0;
  const set = (key: string, patch: Partial<EditableLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = draftTotals(lines, mode, rateOf);

  return (
    <Wrap>
      <table>
        <thead>
          <tr>
            <th className="desc">Description</th>
            <th className="qty">Qty</th>
            <th className="price">Price</th>
            <th className="acct">Account</th>
            {mode !== 'none' && <th className="tax">{taxLabel} rate</th>}
            <th className="amt">Amount</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const amt = lineAmounts(l.quantity, l.unitPrice, rateOf(l.taxRateId), mode);
            return (
              <tr key={l.key} data-testid="line-row">
                <td className="desc">
                  <Input
                    value={l.description}
                    placeholder="What is it for?"
                    aria-label={`Line ${i + 1} description`}
                    data-testid="line-description"
                    onChange={(e) => set(l.key, { description: e.target.value })}
                  />
                </td>
                <td className="qty">
                  <NumInput
                    value={l.qtyText}
                    aria-label={`Line ${i + 1} quantity`}
                    data-testid="line-quantity"
                    onChange={(e) => {
                      const q = parseQuantity(e.target.value);
                      set(l.key, { qtyText: e.target.value, quantity: q ?? l.quantity });
                    }}
                  />
                </td>
                <td className="price">
                  <NumInput
                    value={l.priceText}
                    placeholder="0.00"
                    aria-label={`Line ${i + 1} price`}
                    data-testid="line-price"
                    onChange={(e) => {
                      const p = parseAmount(e.target.value, currency);
                      set(l.key, { priceText: e.target.value, unitPrice: p ?? 0 });
                    }}
                  />
                </td>
                <td className="acct">
                  <AccountSelect
                    accounts={options}
                    value={l.accountId}
                    testId="line-account"
                    onChange={(id) => {
                      const def = accounts.find((a) => a.id === id)?.default_tax_rate_id;
                      set(l.key, { accountId: id, taxRateId: def ?? l.taxRateId });
                    }}
                  />
                </td>
                {mode !== 'none' && (
                  <td className="tax">
                    <TaxSelect rates={taxRates} value={l.taxRateId} testId="line-tax" onChange={(id) => set(l.key, { taxRateId: id })} />
                  </td>
                )}
                <td className="amt">{formatAmount(amt.net + (mode === 'inclusive' ? amt.tax : 0), currency)}</td>
                <td>
                  <button
                    type="button"
                    className="rm"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                  >×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="foot">
        <button
          type="button"
          className="add"
          data-testid="add-line"
          onClick={() => {
            const last = lines[lines.length - 1];
            onChange([...lines, blankLine(last?.accountId ?? '', last?.taxRateId ?? 'tax-none')]);
          }}
        >+ Add a line</button>
        <dl className="totals">
          <dt>Subtotal</dt><dd data-testid="draft-subtotal">{formatAmount(totals.subtotal, currency)}</dd>
          {mode !== 'none' && (<><dt>{mode === 'inclusive' ? `Includes ${taxLabel}` : `Total ${taxLabel}`}</dt><dd data-testid="draft-tax">{formatAmount(totals.tax, currency)}</dd></>)}
          <dt className="grand">Total</dt><dd className="grand" data-testid="draft-total">{formatAmount(totals.total, currency)}</dd>
        </dl>
      </div>
    </Wrap>
  );
}

const Wrap = styled.div`
  overflow-x: auto;
  table { width: 100%; border-collapse: collapse; min-width: 720px; }
  th {
    text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
    color: ${t.color.text3}; font-weight: 700; padding: 6px 4px; border-bottom: 1px solid ${t.color.borderStrong};
  }
  td { padding: 5px 4px; border-bottom: 1px solid ${t.color.border}; vertical-align: middle; }
  .desc { width: 32%; }
  .qty { width: 8%; }
  .price { width: 12%; }
  .acct { width: 22%; }
  .tax { width: 16%; }
  .amt { width: 10%; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding-right: 8px; }
  th.qty, th.price, th.amt { text-align: right; }
  .rm {
    border: none; background: none; cursor: pointer; color: ${t.color.text3}; font-size: 18px; line-height: 1; padding: 0 4px;
    &:hover:not(:disabled) { color: ${t.color.danger}; }
    &:disabled { opacity: 0.3; cursor: default; }
  }
  .foot { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-top: 10px; }
  .add {
    border: 1px dashed ${t.color.borderStrong}; background: none; border-radius: ${t.radius};
    padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 600; color: ${t.color.accent}; cursor: pointer;
    &:hover { background: ${t.color.accentDim}; }
  }
  .totals {
    display: grid; grid-template-columns: auto auto; gap: 6px 28px; margin: 0; font-size: 13px; min-width: 240px;
    dt { color: ${t.color.text2}; text-align: right; }
    dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .grand { font-weight: 700; font-size: 15px; color: ${t.color.text}; border-top: 2px solid ${t.color.borderStrong}; padding-top: 6px; }
  }
`;
