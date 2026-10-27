import React, { useEffect, useState } from 'react';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

interface Props {
  onAdd: (name: string) => Promise<string | null>;
  onClose: () => void;
}

/** Add-folder dialog: a folder name. Creates a context in the active
 *  namespace and names it (the folder holds its own boards). */
export default function AddFolderDialog({ onAdd, onClose }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const canSubmit = !!name.trim() && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const ctxId = await onAdd(name.trim());
      if (!ctxId) { setError('Could not add the folder. Try again.'); return; }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the folder.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="folder-add-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="folder-add-title">Add folder</h3>
        <p className="sub">A folder holds its own boards. Give it a name.</p>
        <Field>
          <label htmlFor="folder-add-name">Folder name</label>
          <input
            id="folder-add-name"
            data-testid="folder-add-name"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. Product"
            disabled={busy}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="folder-add-submit" onClick={submit} disabled={!canSubmit}>
            {busy ? <Spin /> : 'Add folder'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
