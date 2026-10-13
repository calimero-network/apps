import React, { useEffect, useState } from 'react';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

const GITHUB_PREFIX = 'https://github.com/';

interface Props {
  onAdd: (name: string, repoUrl: string) => Promise<string | null>;
  onClose: () => void;
}

/** Add-repo dialog: a repo name plus its GitHub URL (required). Creates a
 *  context in the active namespace, names it, and saves the URL to shared state. */
export default function AddRepoDialog({ onAdd, onClose }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const trimmedUrl = url.trim();
  const urlValid = trimmedUrl.startsWith(GITHUB_PREFIX) && trimmedUrl.length > GITHUB_PREFIX.length;
  const canSubmit = !!name.trim() && urlValid && !busy;

  const submit = async () => {
    if (!canSubmit) {
      if (!urlValid) setError('Enter a GitHub URL, e.g. https://github.com/owner/repo');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ctxId = await onAdd(name.trim(), trimmedUrl);
      if (!ctxId) { setError('Could not add the repository. Try again.'); return; }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the repository.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="repo-add-title">
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <h3 id="repo-add-title">Add a repository</h3>
        <p className="sub">Repos are tracked separately. Give it a name and its GitHub URL.</p>
        <Field>
          <label htmlFor="repo-add-name">Repo name</label>
          <input
            id="repo-add-name"
            data-testid="repo-add-name"
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="e.g. core"
            disabled={busy}
          />
        </Field>
        <Field>
          <label htmlFor="repo-add-url">GitHub URL</label>
          <input
            id="repo-add-url"
            data-testid="repo-add-url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="https://github.com/owner/repo"
            disabled={busy}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={onClose} disabled={busy}>Cancel</SecondaryBtn>
          <PrimaryBtn data-testid="repo-add-submit" onClick={submit} disabled={!canSubmit}>
            {busy ? <Spin /> : 'Add repo'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}
