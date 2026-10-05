import React, { useEffect, useState } from 'react';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';
import type { CreateWorkspaceResult } from '../hooks/useWorkspace';

const MAX_NAME = 128;

interface Props {
  onCreate: (name: string) => Promise<CreateWorkspaceResult>;
  onClose: () => void;
}

/** New-workspace (namespace) dialog. Name is required; delegates to
 *  useWorkspace.createNamespace, which creates + selects the namespace.
 *
 *  When the workspace was created but is not hosted for invitations yet
 *  (`haError` - an account not linked to its cloud user), the dialog stays
 *  open to say so: the alternative is a share link that fails for every
 *  invitee with nothing pointing back at the cause. */
export default function NamespaceCreateDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostingNotice, setHostingNotice] = useState<string | null>(null);

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
      const { namespaceId, haError } = await onCreate(trimmed);
      if (!namespaceId) { setError('Could not create the workspace. Try again.'); return; }
      if (haError) { setHostingNotice(haError); return; }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  };

  if (hostingNotice) {
    return (
      <Overlay onClick={onClose}>
        <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ns-create-title">
          <Close onClick={onClose} aria-label="Close">×</Close>
          <h3 id="ns-create-title">Workspace created</h3>
          <p className="sub" data-testid="ns-create-ha-notice">
            <strong>{name.trim()}</strong> is ready for you, but an invitation from it will not reach anyone yet: {hostingNotice}.
          </p>
          <Actions>
            <PrimaryBtn data-testid="ns-create-ha-done" onClick={onClose}>Got it</PrimaryBtn>
          </Actions>
        </Dialog>
      </Overlay>
    );
  }

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ns-create-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="ns-create-title">New workspace</h3>
        <p className="sub">Name your team workspace. You will add pipelines to it next.</p>
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
