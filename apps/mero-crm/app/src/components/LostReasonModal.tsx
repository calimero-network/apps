import React, { useEffect, useState } from 'react';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, Spin } from './modalKit';
import { Chip } from './ui';

const COMMON = ['Price', 'Chose a competitor', 'No budget', 'No decision', 'Timing', 'Bad fit', 'Went dark'];

/** Asks why a deal was lost. The answer feeds Insights' lost-reasons report,
 *  so a couple of one-click reasons keep it consistent enough to count. */
export default function LostReasonModal({
  dealTitle,
  onConfirm,
  onClose,
}: {
  dealTitle: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}): React.ReactElement {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="lost-title">
        <Close onClick={onClose} aria-label="Close">×</Close>
        <h3 id="lost-title">Mark as lost</h3>
        <p className="sub">Why was “{dealTitle}” lost? It helps the whole team see patterns.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
          {COMMON.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <Chip $color={reason === r ? '#E5695F' : undefined}>{r}</Chip>
            </button>
          ))}
        </div>
        <Field>
          <label htmlFor="lost-reason">Reason</label>
          <input
            id="lost-reason"
            data-testid="lost-reason-input"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="e.g. Price"
            disabled={busy}
          />
        </Field>
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="lost-confirm" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spin /> : 'Mark lost'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
