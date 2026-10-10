import React, { useEffect, useState } from 'react';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

interface Props {
  onAdd: (name: string, currency: string) => Promise<string | null>;
  onClose: () => void;
}

/** Add-organisation dialog: a name plus the currency its books are kept in.
 *  Creates a context in the active namespace, names it, and saves the name and
 *  currency into the books' settings. */
export default function AddOrganisationDialog({ onAdd, onClose }: Props) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const code = currency.trim().toUpperCase();
  const codeValid = /^[A-Z]{3}$/.test(code);
  const canSubmit = !!name.trim() && codeValid && !busy;

  const submit = async () => {
    if (!canSubmit) {
      if (!codeValid) setError('Use a three-letter currency code, e.g. USD or EUR');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ctxId = await onAdd(name.trim(), code);
      if (!ctxId) { setError('Could not create the organisation. Try again.'); return; }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the organisation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="organisation-add-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="organisation-add-title">New organisation</h3>
        <p className="sub">
          An organisation is one set of books — a company, a side business, a client you keep
          the accounts for. It starts with a standard chart of accounts and tax rates you can
          change in Settings.
        </p>
        <Field>
          <label htmlFor="organisation-add-name">Organisation name</label>
          <input
            id="organisation-add-name"
            data-testid="organisation-add-name"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. Acme Ltd"
            disabled={busy}
          />
        </Field>
        <Field>
          <label htmlFor="organisation-add-currency">Currency</label>
          <input
            id="organisation-add-currency"
            data-testid="organisation-add-currency"
            value={currency}
            maxLength={3}
            onChange={(e) => { setCurrency(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="USD"
            disabled={busy}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="organisation-add-submit" onClick={submit} disabled={!canSubmit}>
            {busy ? <Spin /> : 'Create organisation'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
