// The one way out of a workspace, and it depends on who you are:
//
//   - an Admin DELETES it (`deleteNamespace`, which cascades through every
//     folder and document) and is never offered Leave;
//   - anyone else LEAVES it (`leaveNamespace`) and is never offered Delete.
//
// Deleting a namespace is a node's own operation: mero-js's account admin
// refuses it by name (NotForAccountError), so on a delegated (account) session
// an Admin is offered neither rather than a button that fails.

import React, { useState } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { useMero } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberCaps } from '@/hooks/useMemberCaps';
import { namespaceLabel } from '@/lib/namespaceLabel';

export function WorkspaceExitPanel() {
  const { namespaceId, rootGroupId, namespaces, clearNamespace, refetch } =
    useDriveWorkspace();
  const { admin, isDelegated } = useMero();
  const { caps, isAdmin } = useMemberCaps(namespaceId ?? '', rootGroupId ?? '');
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unknown until the caller's role has loaded: offer nothing rather than guess.
  if (!namespaceId || caps === null) return null;
  if (isAdmin && isDelegated) return null;

  const name = namespaceLabel(
    namespaces.find((n) => n.namespaceId === namespaceId)?.name,
  );

  const run = async (action: 'delete' | 'leave') => {
    const ok = await confirm(
      action === 'delete'
        ? {
            title: 'Delete this workspace?',
            body: (
              <>
                <span className="font-medium">{name}</span>, every folder in it
                and all their documents will be deleted for everyone. This
                action can't be undone.
              </>
            ),
            confirmLabel: 'Delete workspace',
            destructive: true,
          }
        : {
            title: 'Leave this workspace?',
            body: 'You will lose access to this workspace and need a new invite to come back.',
            confirmLabel: 'Leave',
            destructive: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      if (!admin) throw new Error('Workspace not ready');
      if (action === 'delete') await admin.deleteNamespace(namespaceId);
      else await admin.leaveNamespace(namespaceId);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(
        `Couldn't ${action === 'delete' ? 'delete' : 'leave'} the workspace: ${err.message}`,
      );
      setBusy(false);
      return;
    }
    // Only once the node accepted it: the workspace is gone from this session.
    clearNamespace();
    await refetch().catch(() => undefined);
  };

  return (
    <section
      aria-labelledby="workspace-exit-heading"
      className="rounded-lg border border-destructive/30 bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h3
          id="workspace-exit-heading"
          className="text-sm font-semibold text-foreground"
        >
          {isAdmin ? 'Delete workspace' : 'Leave workspace'}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isAdmin
            ? 'Removes the workspace, its folders and documents for every member.'
            : 'Removes you from this workspace. Its folders and documents stay for everyone else.'}
        </p>
      </header>
      {error && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="px-4 py-3">
        {isAdmin ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void run('delete')}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete workspace
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run('leave')}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Leave workspace
          </Button>
        )}
      </div>
    </section>
  );
}
