// Namespace-admin settings surface. Currently exposes the
// Reconcile action — an idempotent diff+apply that brings the
// registry in line with admin-side groups.
//
// Reconcile is safe to run at any time (Phase 7's
// computeReconcileActions is a minimal-action diff), but it's
// intentionally admin-only so non-admin users can't accidentally
// mass-register / mass-unregister if the tree shape momentarily
// disagrees with the registry mid-sync.
//
// Panel returns null for non-admins — keeps the settings surface
// from advertising actions the caller can't take.

import React from 'react';
import { RefreshCw, Users2 } from 'lucide-react';
import { useSubgroups } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { useReconcile } from '@/hooks/useReconcile';
import { useInheritCascade } from '@/hooks/useInheritCascade';

export function WorkspaceSettingsPanel() {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  const { registryClient } = useDriveWorkspace();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const { subgroups } = useSubgroups(rootGroupId);
  const { run, running, last, error } = useReconcile(
    rootGroupId,
    registryClient,
    subgroups,
  );
  const cascade = useInheritCascade();

  if (!perms.canManageNamespace) return null;

  return (
    <section
      aria-labelledby="workspace-settings-heading"
      data-testid="workspace-settings"
      className="rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h3
          id="workspace-settings-heading"
          className="text-sm font-semibold text-foreground"
        >
          Admin actions
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Maintenance tasks for this workspace.
        </p>
      </header>

      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            Reconcile registry
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bring the folder registry in line with admin-side groups.
            Safe to run any time; acts only on drifted entries.
          </p>
          {last && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="reconcile-result"
            >
              Last run: registered {last.registered}, unregistered{' '}
              {last.unregistered}, moved {last.moved}
            </p>
          )}
          {error && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              Reconcile failed: {error.message}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={running}
          onClick={() => {
            void run();
          }}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`}
          />
          {running ? 'Running…' : 'Reconcile'}
        </Button>
      </div>

      <div className="flex items-start justify-between gap-3 border-t border-border/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            Cascade inherit access
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add every namespace member to every Inherit-mode folder.
            Run this after inviting someone to the workspace so they
            can actually open the open folders. Idempotent — safe to
            re-run; it only adds where membership is missing.
          </p>
          {cascade.last && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid="cascade-result"
            >
              Last run: added {cascade.last.added}, skipped{' '}
              {cascade.last.skipped}, failed {cascade.last.failures} across{' '}
              {cascade.last.folders} Inherit folder
              {cascade.last.folders === 1 ? '' : 's'} ×{' '}
              {cascade.last.members} member
              {cascade.last.members === 1 ? '' : 's'}
            </p>
          )}
          {cascade.error && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              Cascade failed: {cascade.error.message}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={cascade.running}
          onClick={() => {
            void cascade.run();
          }}
        >
          <Users2
            className={`h-3.5 w-3.5 ${cascade.running ? 'animate-pulse' : ''}`}
          />
          {cascade.running ? 'Running…' : 'Cascade'}
        </Button>
      </div>
    </section>
  );
}
