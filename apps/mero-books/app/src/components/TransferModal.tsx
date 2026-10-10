// Move money between two of the organisation's own bank accounts.
import React, { useMemo, useState } from 'react';
import type { UseBooksReturn } from '../hooks/useBooks';
import { parseAmount } from '../utils/books';
import { describeError } from '../utils/errors';
import { Button, ErrorText, FieldGrid, Input, Label, Modal, NumInput, Select } from './ui';

export default function TransferModal({
  fromAccountId, onClose, data, today,
}: {
  fromAccountId?: string;
  onClose: () => void;
  data: UseBooksReturn;
  today: string;
}) {
  const { settings, accounts, act } = data;
  const cur = settings.currency;
  const banks = useMemo(() => accounts.filter((a) => !a.archived && a.account_type === 'bank'), [accounts]);
  const [from, setFrom] = useState(fromAccountId ?? banks[0]?.id ?? '');
  const [to, setTo] = useState(() => banks.find((b) => b.id !== (fromAccountId ?? banks[0]?.id))?.id ?? '');
  const [date, setDate] = useState(today);
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = parseAmount(amountText, cur);
  const canSave = !!from && !!to && from !== to && amount !== null && amount > 0 && !busy;

  const save = async () => {
    if (!canSave || amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await act((c) => c.recordTransfer({ from_account_id: from, to_account_id: to, date, amount, reference: reference.trim() }));
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Transfer money" sub="Move money between two of your bank accounts." onClose={onClose} testId="transfer-modal">
      {banks.length < 2 && <ErrorText>You need two bank accounts to record a transfer.</ErrorText>}
      <FieldGrid>
        <Label>
          From
          <Select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="transfer-from">
            <option value="">Choose account</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        </Label>
        <Label>
          To
          <Select value={to} onChange={(e) => setTo(e.target.value)} data-testid="transfer-to">
            <option value="">Choose account</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        </Label>
        <Label>
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="transfer-date" />
        </Label>
        <Label>
          Amount
          <NumInput value={amountText} placeholder="0.00" onChange={(e) => setAmountText(e.target.value)} data-testid="transfer-amount" />
        </Label>
      </FieldGrid>
      <Label>
        Reference
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank transfer" data-testid="transfer-reference" />
      </Label>
      {from && from === to && <ErrorText>Choose two different accounts.</ErrorText>}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="actions">
        <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" $variant="primary" onClick={save} disabled={!canSave} data-testid="transfer-save">
          {busy ? 'Saving…' : 'Transfer'}
        </Button>
      </div>
    </Modal>
  );
}
