// New-workspace modal. Calls useCreateNamespace with the current
// applicationId and a user-supplied alias, then auto-switches the
// active workspace to the newly created namespace. CreateNamespaceRequest
// requires `upgradePolicy`; we default to "latest" which keeps apps
// on the newest published bundle — matches the default used by the
// e2e workflow's create_namespace step.

import React, { useState } from 'react';
import { useCreateNamespace } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { getApplicationId, MAX_ALIAS_LENGTH } from '@/constants/config';
import { useWorkspace } from '@/context/WorkspaceContext';

interface Props {
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
}

export function NamespaceCreateDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createNamespace } = useCreateNamespace();
  const { setNamespace } = useWorkspace();

  const trimmed = name.trim();
  const canSubmit =
    !!trimmed && trimmed.length <= MAX_ALIAS_LENGTH && !submitting;

  const onCreate = async () => {
    const alias = name.trim();
    if (!alias) {
      setError('Workspace name required');
      return;
    }
    if (alias.length > MAX_ALIAS_LENGTH) {
      setError(`Workspace name must be ${MAX_ALIAS_LENGTH} characters or fewer`);
      return;
    }
    setSubmitting(true);
    setError(null);

    // Scope the error-surfacing try/catch tightly to the namespace
    // creation itself. Post-create bookkeeping (refetch via
    // onCreated) runs outside this block — if it throws, the user
    // still gets their namespace created + switched, and we close
    // the dialog rather than surfacing a misleading "failed" error
    // that would tempt them to retry and create a duplicate.
    try {
      const res = await createNamespace({
        applicationId: getApplicationId(),
        upgradePolicy: 'latest',
        alias,
      });
      if (!res?.namespaceId) {
        throw new Error('createNamespace returned no namespaceId');
      }
      // namespaceId is also the root groupId at this layer — see
      // NamespaceSwitcher's file header.
      setNamespace(res.namespaceId, res.namespaceId);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err.message);
      setSubmitting(false);
      return;
    }

    // Best-effort refetch of the namespaces list. Failure here is
    // non-fatal — the workspace is created and switched; the list
    // will refresh on the next natural trigger (component remount,
    // explicit refetch, etc.).
    try {
      await onCreated?.();
    } catch (e) {
      console.warn('post-create refetch failed', e);
    }
    setSubmitting(false);
    onClose();
  };

  // Dismissal is gated on !submitting across all three paths
  // (Cancel / backdrop / Escape). Without this, dismissing mid-
  // request unmounts the dialog while createNamespace is still in
  // flight — on failure, setError targets an unmounted component
  // and the user gets no feedback.
  const safeClose = () => {
    if (!submitting) onClose();
  };

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
            setError(null);
          }}
          disabled={submitting}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onCreate();
            if (e.key === 'Escape') safeClose();
          }}
        />
        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
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
