import { useEffect, useState } from 'react';
import { describeError } from '@calimero-apps/connect';
import { CHECKING_RELEASE } from '@calimero-apps/passkey';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

interface Props {
  onAdd: (name: string, currency: string) => Promise<string | null>;
  /** The release is still being read: nothing is created yet. */
  releasePending?: boolean;
  onClose: () => void;
}

/** Add-pipeline dialog: a name plus the currency its deals are valued in.
 *  Creates a context in the active namespace, names it, and saves the currency
 *  into shared state. */
export default function AddPipelineDialog({ onAdd, releasePending = false, onClose }: Props) {
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
  const canSubmit = !!name.trim() && codeValid && !busy && !releasePending;

  const submit = async () => {
    if (!canSubmit) {
      if (!codeValid) setError('Use a three-letter currency code, e.g. USD or EUR');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ctxId = await onAdd(name.trim(), code);
      if (!ctxId) { setError('Could not create the pipeline. Try again.'); return; }
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pipeline-add-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="pipeline-add-title">New pipeline</h3>
        <p className="sub">
          A pipeline is one sales process — say New business or Renewals. It starts with five
          stages you can rename, reorder and re-weight in Settings.
        </p>
        <Field>
          <label htmlFor="pipeline-add-name">Pipeline name</label>
          <input
            id="pipeline-add-name"
            data-testid="pipeline-add-name"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. New business"
            disabled={busy}
          />
        </Field>
        <Field>
          <label htmlFor="pipeline-add-currency">Currency</label>
          <input
            id="pipeline-add-currency"
            data-testid="pipeline-add-currency"
            value={currency}
            maxLength={3}
            onChange={(e) => { setCurrency(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="USD"
            disabled={busy}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        {releasePending && <p className="sub" data-testid="release-checking">{CHECKING_RELEASE}</p>}
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="pipeline-add-submit" onClick={submit} disabled={!canSubmit}>
            {busy ? <Spin /> : 'Create pipeline'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
