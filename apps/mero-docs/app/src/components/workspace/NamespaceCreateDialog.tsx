// New-workspace modal. Delegates the full create flow to
// useDriveWorkspace().createWorkspace - one call creates the
// namespace AND the Registry context atomically (see the hook's
// file header for the convention). Errors surface as a visible
// message; no silent no-ops. It also asks your name in the workspace,
// once, here: every folder and doc in it uses that name without asking.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MAX_ALIAS_LENGTH } from '@/constants/config';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useReleaseToCreate } from '@/hooks/useReleaseToCreate';
import { MAX_DISPLAY_NAME_LEN } from '@/hooks/useMemberDisplayName';
import { lastUsedName } from '@calimero-apps/names';
import { CHECKING_RELEASE, WorkspaceReview } from '@calimero-apps/passkey';

interface Props {
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
}

export function NamespaceCreateDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [selfName, setSelfName] = useState(() => lastUsedName());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const target = useReleaseToCreate();
  const {
    createWorkspace,
    createWorkspaceLoading: submitting,
    createWorkspaceError,
  } = useDriveWorkspace();

  const trimmed = name.trim();
  const trimmedSelf = selfName.trim();
  const canSubmit =
    !!trimmed &&
    trimmed.length <= MAX_ALIAS_LENGTH &&
    !!trimmedSelf &&
    trimmedSelf.length <= MAX_DISPLAY_NAME_LEN &&
    !submitting;
  const reviewable = target.status !== 'none';
  const canContinue = canSubmit && target.status === 'ready';

  const onCreate = async () => {
    const alias = name.trim();
    if (!alias) {
      setSubmitError('Workspace name required');
      return;
    }
    if (alias.length > MAX_ALIAS_LENGTH) {
      setSubmitError(`Workspace name must be ${MAX_ALIAS_LENGTH} characters or fewer`);
      return;
    }
    const me = selfName.trim();
    if (!me) {
      setSubmitError('Your name is required');
      return;
    }
    setSubmitError(null);

    const nsId = await createWorkspace(alias, me);
    if (!nsId) {
      // createWorkspace sets createWorkspaceError internally via
      // setCreateError - a React state update that only lands on the
      // next render. Reading createWorkspaceError here would return
      // the stale (pre-render) value, so we don't try. Instead,
      // displayError (below) picks up createWorkspaceError?.message
      // once the re-render fires.
      return;
    }

    // Best-effort refetch on the caller side. Failure here is non-
    // fatal - the workspace is created and selected.
    try {
      await onCreated?.();
    } catch (e) {
      console.warn('post-create refetch failed', e);
    }
    onClose();
  };

  // Dismissal is gated on !submitting across all three paths
  // (Cancel / backdrop / Escape). Without this, dismissing mid-
  // request unmounts the dialog while createWorkspace is still in
  // flight - on failure, setSubmitError targets an unmounted
  // component and the user gets no feedback.
  const safeClose = () => {
    if (!submitting) onClose();
  };

  const displayError = submitError ?? createWorkspaceError?.message ?? null;
  const onPrimary = () => (reviewable ? setReviewing(true) : onCreate());
  const primaryReady = reviewable ? canContinue : canSubmit;
  const review = reviewing && target.status === 'ready' ? target.release : null;

  return (
    <Dialog open onOpenChange={(open) => !open && safeClose()}>
      <DialogContent
        aria-describedby={undefined}
        className={
          review
            ? 'max-h-[90dvh] max-w-2xl overflow-y-auto [--passkey-review-inset:theme(spacing.5)]'
            : 'max-w-sm'
        }
      >
        <DialogHeader>
          <DialogTitle className={review ? 'sr-only' : undefined}>
            New workspace
          </DialogTitle>
        </DialogHeader>
        {review ? (
          <>
            <WorkspaceReview
              release={review}
              creating={submitting}
              onBack={() => {
                setReviewing(false);
                setSubmitError(null);
              }}
              onCreate={onCreate}
            />
            {displayError && (
              <p className="mt-2 text-xs text-destructive break-words">
                {displayError}
              </p>
            )}
          </>
        ) : (
          <>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Workspace name"
              value={name}
              maxLength={MAX_ALIAS_LENGTH}
              onChange={(e) => {
                setName(e.target.value);
                setSubmitError(null);
              }}
              disabled={submitting}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && primaryReady) onPrimary();
              }}
            />
            <input
              className="mt-3 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Your name in this workspace"
              aria-label="Your name in this workspace"
              value={selfName}
              maxLength={MAX_DISPLAY_NAME_LEN}
              onChange={(e) => {
                setSelfName(e.target.value);
                setSubmitError(null);
              }}
              disabled={submitting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && primaryReady) onPrimary();
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Members of this workspace see this name. You can change it later
              in settings.
            </p>
            {displayError && (
              <p className="mt-2 text-xs text-destructive break-words">
                {displayError}
              </p>
            )}
            {target.status === 'loading' && (
              <p className="mt-2 text-xs text-muted-foreground">{CHECKING_RELEASE}</p>
            )}
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={safeClose} disabled={submitting}>
                Cancel
              </Button>
              <Button size="sm" onClick={onPrimary} disabled={!primaryReady}>
                {reviewable ? 'Continue' : submitting ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
