import { useEffect, useState } from 'react';
import { lastUsedName } from '@calimero-apps/names';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';
import type { CreateWorkspaceResult } from '../hooks/useWorkspace';

const MAX_NAME = 128;
const MAX_SELF_NAME = 64;

interface Props {
  onCreate: (name: string, selfName: string) => Promise<CreateWorkspaceResult>;
  onClose: () => void;
}

/** New-workspace (namespace) dialog. Name is required, and so is your name in
 *  the workspace (asked here, once, for every pipeline in it; it starts on the
 *  name used for the last workspace); delegates to useWorkspace.createNamespace,
 *  which creates + selects the namespace and writes your name to it.
 *
 *  When the workspace was created but its member defaults could not be set
 *  (the passkey prompt was cancelled), the dialog stays open to say so: the
 *  alternative is invitees who can open it and do nothing, with nothing
 *  pointing back at the cause. */
export default function NamespaceCreateDialog({ onCreate, onClose }: Props) {
  const [name, setName] = useState('');
  const [selfName, setSelfName] = useState(() => lastUsedName());
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
    const me = selfName.trim();
    if (!trimmed || !me || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { namespaceId, warning } = await onCreate(trimmed, me);
      if (!namespaceId) { setError('Could not create the workspace. Try again.'); return; }
      if (warning) { setHostingNotice(warning); return; }
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
            <strong>{name.trim()}</strong> is ready for you. {hostingNotice}
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
        <Field>
          <label htmlFor="ns-create-self-name">Your name in this workspace</label>
          <input
            id="ns-create-self-name"
            data-testid="ns-create-self-name"
            maxLength={MAX_SELF_NAME}
            value={selfName}
            onChange={(e) => { setSelfName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. ronit"
            disabled={busy}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="ns-create-submit" onClick={submit} disabled={!name.trim() || !selfName.trim() || busy}>
            {busy ? <Spin /> : 'Create workspace'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
