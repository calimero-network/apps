import React, { useEffect, useState } from 'react';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

const MAX_NAME = 128;

interface Props {
  onCreate: (name: string) => Promise<string | null>;
  onClose: () => void;
}

/** New-workspace (namespace) dialog. Name is required; delegates to
 *  useWorkspace.createNamespace, which creates + selects the namespace. */
export default function NamespaceCreateDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const nsId = await onCreate(trimmed);
      if (!nsId) { setError('Could not create the workspace. Try again.'); return; }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ns-create-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="ns-create-title">New workspace</h3>
        <p className="sub">Name your team workspace. You will add repositories to it next.</p>
        <Field>
          <label htmlFor="ns-create-name">Workspace name</label>
          <input
            id="ns-create-name"
            data-testid="ns-create-name"
            autoFocus
            maxLength={MAX_NAME}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. Platform team"
            disabled={busy}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="ns-create-submit" onClick={submit} disabled={!name.trim() || busy}>
            {busy ? <Spin /> : 'Create workspace'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
