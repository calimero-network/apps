// Spend money / receive money: a bank movement coded straight to accounts,
// with no invoice in between (bank fees, a card purchase, a cash sale).
import React, { useMemo, useState } from 'react';
import type { UseBooksReturn } from '../hooks/useBooks';
import { draftTotals, toLineInputs } from '../utils/books';
import { describeError } from '../utils/errors';
import LineEditor, { blankLine, type EditableLine } from './LineEditor';
import ContactModal from './ContactModal';
import { Button, ErrorText, FieldGrid, Input, Label, Modal, Select } from './ui';

const NEW_CONTACT = '__new__';

export default function BankTransactionModal({
  kind, bankAccountId, onClose, data, today, onSaved,
}: {
  kind: 'spend' | 'receive';
  bankAccountId?: string;
  onClose: () => void;
  data: UseBooksReturn;
  today: string;
  onSaved?: (id: string) => void;
}) {
  const { settings, accounts, taxRates, contacts, act } = data;
  const cur = settings.currency;
  const banks = useMemo(() => accounts.filter((a) => !a.archived && a.account_type === 'bank'), [accounts]);
  const [bank, setBank] = useState(bankAccountId ?? banks[0]?.id ?? '');
  const [contactId, setContactId] = useState('');
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [mode, setMode] = useState('inclusive');
  const [lines, setLines] = useState<EditableLine[]>(() => [blankLine('', 'tax-none')]);
  const [newContact, setNewContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rateOf = (id: string) => taxRates.find((r) => r.id === id)?.rate_bp ?? 0;
  const total = draftTotals(lines, mode, rateOf).total;
  const coded = lines.filter((l) => l.accountId && l.unitPrice !== 0);
  const canSave = !!bank && coded.length > 0 && total !== 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    const inputs = toLineInputs(lines);
    if (inputs.some((l) => !l.account_id)) { setError('Every line needs an account.'); return; }
    setBusy(true);
    setError(null);
    try {
      const id = await act((c) =>
        c.createBankTransaction({
          kind, bank_account_id: bank, contact_id: contactId || null, date, reference: reference.trim(),
          amounts_are: mode, lines: inputs,
        }),
      );
      onSaved?.(id);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title={kind === 'spend' ? 'Spend money' : 'Receive money'}
        sub={kind === 'spend' ? 'Money paid out of a bank account, coded to what it was for.' : 'Money paid into a bank account, coded to what it was for.'}
        onClose={onClose}
        wide
        testId="bank-txn-modal"
      >
        <FieldGrid $cols={3}>
          <Label>
            Bank account
            <Select value={bank} onChange={(e) => setBank(e.target.value)} data-testid="bank-txn-account">
              <option value="">Choose bank account</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </Select>
          </Label>
          <Label>
            {kind === 'spend' ? 'Paid to' : 'Received from'}
            <Select
              value={contactId}
              data-testid="bank-txn-contact"
              onChange={(e) => {
                if (e.target.value === NEW_CONTACT) setNewContact(true);
                else setContactId(e.target.value);
              }}
            >
              <option value="">No contact</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW_CONTACT}>+ New contact</option>
            </Select>
          </Label>
          <Label>
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="bank-txn-date" />
          </Label>
          <Label>
            Reference
            <Input value={reference} onChange={(e) => setReference(e.target.value)} data-testid="bank-txn-reference" />
          </Label>
          <Label>
            Amounts are
            <Select value={mode} onChange={(e) => setMode(e.target.value)} data-testid="bank-txn-mode">
              <option value="exclusive">Tax exclusive</option>
              <option value="inclusive">Tax inclusive</option>
              <option value="none">No tax</option>
            </Select>
          </Label>
        </FieldGrid>
        <LineEditor
          lines={lines}
          onChange={setLines}
          accounts={accounts}
          taxRates={taxRates}
          mode={mode}
          currency={cur}
          taxLabel={settings.tax_label}
          excludeAccounts={bank ? [bank] : []}
        />
        {error && <ErrorText>{error}</ErrorText>}
        <div className="actions">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" $variant="primary" onClick={save} disabled={!canSave} data-testid="bank-txn-save">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
      {newContact && (
        <ContactModal
          act={act}
          onClose={() => setNewContact(false)}
          onSaved={(id) => setContactId(id)}
        />
      )}
    </>
  );
}
