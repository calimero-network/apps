// New-workspace modal. Delegates the full create flow to
// useDriveWorkspace().createWorkspace — one call creates the
// namespace AND the Registry context atomically (see the hook's
// file header for the convention). Errors surface as a visible
// message; no silent no-ops.

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

interface Props {
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
}

export function NamespaceCreateDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    createWorkspace,
    createWorkspaceLoading: submitting,
    createWorkspaceError,
  } = useDriveWorkspace();

  const trimmed = name.trim();
  const canSubmit =
    !!trimmed && trimmed.length <= MAX_ALIAS_LENGTH && !submitting;

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
    setSubmitError(null);

    const nsId = await createWorkspace(alias);
    if (!nsId) {
      // createWorkspace sets createWorkspaceError internally via
      // setCreateError — a React state update that only lands on the
      // next render. Reading createWorkspaceError here would return
      // the stale (pre-render) value, so we don't try. Instead,
      // displayError (below) picks up createWorkspaceError?.message
      // once the re-render fires.
      return;
    }

    // Best-effort refetch on the caller side. Failure here is non-
    // fatal — the workspace is created and selected.
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
  // flight — on failure, setSubmitError targets an unmounted
  // component and the user gets no feedback.
  const safeClose = () => {
    if (!submitting) onClose();
  };

  const displayError = submitError ?? createWorkspaceError?.message ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && safeClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
        </DialogHeader>
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
            if (e.key === 'Enter' && canSubmit) onCreate();
          }}
        />
        {displayError && (
          <p className="mt-2 text-xs text-destructive break-words">{displayError}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={safeClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={onCreate} disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
