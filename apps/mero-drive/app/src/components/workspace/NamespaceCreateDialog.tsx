// New-workspace modal. Calls useCreateNamespace with the current
// applicationId and a user-supplied alias, then auto-switches the
// active workspace to the newly created namespace. CreateNamespaceRequest
// requires `upgradePolicy`; we default to "latest" which keeps apps
// on the newest published bundle — matches the default used by the
// e2e workflow's create_namespace step.

import React, { useState } from 'react';
import { useCreateNamespace } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { getApplicationId } from '@/constants/config';
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

  const canSubmit = !!name.trim() && !submitting;

  const onCreate = async () => {
    const alias = name.trim();
    if (!alias) {
      setError('Workspace name required');
      return;
    }
    setSubmitting(true);
    setError(null);
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
      await onCreated?.();
      onClose();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
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
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          disabled={submitting}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onCreate();
            if (e.key === 'Escape') onClose();
          }}
        />
        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
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
