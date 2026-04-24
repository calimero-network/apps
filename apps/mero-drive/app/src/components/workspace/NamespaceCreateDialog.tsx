// New-workspace modal. Delegates the full create flow to
// useDriveWorkspace().createWorkspace — one call creates the
// namespace AND the Registry context atomically (see the hook's
// file header for the convention). Errors surface as a visible
// message; no silent no-ops.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
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
      // createWorkspace sets createWorkspaceError internally; surface
      // its message. If absent, fall back to a generic line.
      setSubmitError(createWorkspaceError?.message ?? 'Workspace creation failed');
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
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={safeClose}
    >
      <div
        className="w-80 rounded-lg border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-3">New workspace</h2>
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
            if (e.key === 'Escape') safeClose();
          }}
        />
        {displayError && (
          <p className="mt-2 text-xs text-destructive break-words">{displayError}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={safeClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={onCreate} disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
