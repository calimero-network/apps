import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { lastUsedName } from '@calimero-apps/names';
import { WorkspaceReview, type ReviewRelease } from '@calimero-apps/passkey';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';
import { tokens as t } from '../theme';
import { useSignedIn } from '../sessionContext';
import { newWorkspaceRelease } from '../newWorkspaceRelease';
import type { CreateWorkspaceResult } from '../hooks/useWorkspace';

const MAX_NAME = 128;
const MAX_SELF_NAME = 64;

interface Props {
  onCreate: (name: string, selfName: string) => Promise<CreateWorkspaceResult>;
  onClose: () => void;
}

/** The release the new workspace's repositories will run, read when the dialog opens: `undefined` while asked, `null` when none is known. */
function useNewWorkspaceRelease(): ReviewRelease | null | undefined {
  const { client, source } = useSignedIn();
  const [release, setRelease] = useState<ReviewRelease | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void newWorkspaceRelease(client, source).then((found) => live && setRelease(found));
    return () => { live = false; };
  }, [client, source]);
  return release;
}

/** Step 2: the shared review of the release, or why there is none to review. */
function ReviewStep({ release, busy, onBack, onCreate }: {
  release: ReviewRelease | null | undefined;
  busy: boolean;
  onBack: () => void;
  onCreate: () => void;
}) {
  if (release) return <WorkspaceReview release={release} creating={busy} onBack={onBack} onCreate={onCreate} />;
  const loading = release === undefined;
  return (
    <>
      <h3>Review before creating</h3>
      <p className="sub">
        {loading
          ? 'Reading the app\'s release from this node...'
          : 'No signed release to review: this app runs a local bundle, or its release could not be read from this node.'}
      </p>
      <Actions>
        <SecondaryBtn onClick={onBack} disabled={busy}>Back</SecondaryBtn>
        {!loading && <PrimaryBtn onClick={onCreate} disabled={busy}>{busy ? <Spin /> : 'Create workspace'}</PrimaryBtn>}
      </Actions>
    </>
  );
}

/** New-workspace (namespace) dialog in two steps. Step 1: name is required, and
 *  so is your name in the workspace (asked here, once, for every pipeline in it;
 *  it starts on the name used for the last workspace). Step 2: the review of the
 *  app release, which is where it is created, through useWorkspace.createNamespace
 *  (creates + selects the namespace and writes your name to it).
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
  const [step, setStep] = useState<'name' | 'review'>('name');
  const release = useNewWorkspaceRelease();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const valid = !!name.trim() && !!selfName.trim();
  const next = () => { if (valid && !busy) setStep('review'); };
  const back = () => { setError(null); setStep('name'); };

  const create = async () => {
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

  const reviewing = step === 'review';
  return (
    <Overlay onClick={() => !busy && onClose()}>
      <Wide
        $wide={reviewing}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={reviewing ? undefined : 'ns-create-title'}
        aria-label={reviewing ? 'Review the new workspace' : undefined}
      >
        <Close onClick={() => !busy && onClose()} aria-label="Close">×</Close>
        <Stepper aria-label="Steps">
          <span aria-current={reviewing ? undefined : 'step'}>1 Name</span>
          <span aria-hidden="true">›</span>
          <span aria-current={reviewing ? 'step' : undefined}>2 Review</span>
        </Stepper>
        {reviewing ? (
          <>
            <ReviewStep release={release} busy={busy} onBack={back} onCreate={create} />
            {error && <ErrorLine>{error}</ErrorLine>}
          </>
        ) : (
          <>
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
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
                placeholder="e.g. Platform team"
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
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
                placeholder="e.g. ronit"
              />
            </Field>
            <Actions>
              <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
              <PrimaryBtn data-testid="ns-create-submit" onClick={next} disabled={!valid}>Continue</PrimaryBtn>
            </Actions>
          </>
        )}
      </Wide>
    </Overlay>
  );
}

const Wide = styled(Dialog)<{ $wide: boolean }>`
  max-width: ${({ $wide }) => ($wide ? '600px' : '420px')};
  --passkey-review-inset: 26px; /* the dialog's bottom padding, so the review's sticky row sits flush */
`;
const Stepper = styled.div`
  display: flex; gap: 6px; margin: 0 0 14px; font-size: 11.5px; color: ${t.color.text3};
  [aria-current='step'] { color: ${t.color.text}; font-weight: 600; }
`;
